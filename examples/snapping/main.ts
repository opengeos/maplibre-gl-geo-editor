import { Map, Marker, setWorkerUrl, type Evented } from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import {
  Geoman,
  type GmEditFeatureUpdatedEvent,
  type FeatureData,
} from "@geoman-io/maplibre-geoman-free";
import { editedNodeIds } from "./nodeIds";
import { GeoEditor } from "../../src/lib/core/GeoEditor";
import type { SnapEvent } from "../../src/lib/core/types";
import type { Feature, LineString } from "geojson";
import "maplibre-gl/dist/maplibre-gl.css";
import "@geoman-io/maplibre-geoman-free/dist/maplibre-geoman.css";
import "../../src/lib/styles/geo-editor.css";
import "./style.css";

setWorkerUrl(workerUrl);
const element = (id: string) => document.getElementById(id)!;
const buttons = ["draw", "edit", "reset"].map(
  (id) => element(id) as HTMLButtonElement,
);
const map = new Map({
  container: "map",
  center: [0, 0],
  zoom: 16,
  style: {
    version: 8,
    sources: {},
    layers: [
      {
        id: "background",
        type: "background",
        paint: { "background-color": "#edf2f8" },
      },
    ],
  },
});
const samples: Feature<LineString, Record<string, unknown>>[] = [
  {
    type: "Feature",
    id: "sample-way-a",
    properties: {
      name: "West path",
      osm_id: "way/201",
      osm_version: 7,
      node_ids: ["node/101", "node/102", "node/103"],
    },
    geometry: {
      type: "LineString",
      coordinates: [
        [-0.0025, 0.0012],
        [0, 0.0012],
        [0.0025, 0.0012],
      ],
    },
  },
  {
    type: "Feature",
    id: "sample-way-b",
    properties: {
      name: "South path",
      osm_id: "way/202",
      osm_version: 4,
      node_ids: ["node/104", "node/105", "node/106"],
    },
    geometry: {
      type: "LineString",
      coordinates: [
        [-0.0018, -0.0014],
        [0.0006, -0.0014],
        [0.0022, -0.0002],
      ],
    },
  },
];
let lastTarget = "";
let activity: string[] = [];
function log(message: string) {
  activity = [message, ...activity].slice(0, 5);
  element("activity").replaceChildren(
    ...activity.map((text) => {
      const item = document.createElement("li");
      item.textContent = text;
      return item;
    }),
  );
}
function clearTarget() {
  lastTarget = "";
  element("status").textContent = "No snap";
  element("status").removeAttribute("data-kind");
  element("target-details").hidden = true;
  element("empty").hidden = false;
  element("empty").textContent = "Move near a labeled node or a line segment.";
}
function showTarget(event: SnapEvent) {
  const { target, coordinate } = event;
  element("payload").textContent = JSON.stringify(event, null, 2);
  element("status").textContent =
    target.kind === "vertex"
      ? "Vertex"
      : target.kind === "segment"
        ? "Segment"
        : "Custom";
  element("status").dataset.kind = target.kind;
  if (target.kind === "custom") {
    element("target-details").hidden = true;
    element("empty").hidden = false;
    element("empty").textContent =
      "A drawing helper coordinate with no feature identity.";
    return;
  }
  const properties = target.feature.properties ?? {};
  element("empty").hidden = true;
  element("target-details").hidden = false;
  element("feature-id").textContent = String(target.featureId);
  element("way-id").textContent = String(
    properties.osm_id ?? "New local feature",
  );
  element("way-version").textContent = String(
    properties.osm_version ?? "Not uploaded",
  );
  const paths =
    target.kind === "vertex" ? [target.coordinatePath] : target.segmentPaths;
  const mappedNodes =
    target.feature.geometry.type === "LineString" &&
    properties.node_ids?.length === target.feature.geometry.coordinates.length
      ? properties.node_ids
      : undefined;
  const nodeIds = paths.map(
    (path) => mappedNodes?.[Number(path.at(-1))] ?? "Unmapped local vertex",
  );
  element("node-label").textContent =
    target.kind === "vertex" ? "Node" : "Segment endpoints";
  element("node-id").textContent = nodeIds.join(" → ");
  element("coordinate").textContent = coordinate
    .map((value) => value.toFixed(7))
    .join(", ");
  const key = JSON.stringify([target.featureId, paths]);
  if (key !== lastTarget)
    log(
      `${target.kind === "vertex" ? "Vertex" : "Segment"} snap · ${properties.osm_id ?? target.featureId}`,
    );
  lastTarget = key;
}
map.once("load", () => {
  const gm = new Geoman(map, {});
  (map as Evented).once("gm:loaded", async () => {
    const editor = new GeoEditor({
      snapEventsEnabled: true,
      drawModes: ["line", "marker"],
      editModes: ["change", "delete"],
      helperModes: ["snapping"],
      fileModes: [],
      showFeatureProperties: false,
      onSnap: showTarget,
      onUnsnap: clearTarget,
      onFeatureCreate: (feature) =>
        log(
          `Created ${feature.geometry.type} · ${feature.id ?? "local feature"}`,
        ),
      onHistoryChange: () => requestAnimationFrame(updateLabels),
    });
    editor.setGeoman(gm);
    map.addControl(editor, "top-left");
    let markers: Marker[] = [];
    let nextLocalNode = 1;
    (map as Evented).on("_gm:edit", (event) => {
      const edit = event as unknown as GmEditFeatureUpdatedEvent;
      if (edit.action !== "feature_updated" || edit.mode !== "change") return;
      for (const featureData of edit.targetFeatures) {
        const nodeIds = editedNodeIds(
          featureData.getGeoJson(),
          edit.markerData,
          () => `local/node-${nextLocalNode++}`,
        );
        if (nodeIds) {
          // updateProperties updates the in-memory feature immediately, before
          // subsequent snap events and history snapshots read its properties.
          void featureData.updateProperties({ node_ids: nodeIds });
        }
      }
      requestAnimationFrame(updateLabels);
    });
    function updateLabels() {
      markers.forEach((marker) => marker.remove());
      markers = [];
      const addLabels = (featureData: FeatureData) => {
        const feature = featureData.getGeoJson();
        const nodeIds = feature.properties?.node_ids;
        if (feature.geometry.type !== "LineString" || !Array.isArray(nodeIds))
          return;
        // Unsupported geometry changes must not silently reassign existing IDs.
        if (feature.geometry.coordinates.length !== nodeIds.length) return;
        feature.geometry.coordinates.forEach((coordinate, index) => {
          const label = document.createElement("div");
          label.className = "node-label";
          const dot = document.createElement("div");
          dot.className = "node-dot";
          const text = document.createElement("span");
          text.textContent = String(nodeIds[index]);
          label.append(dot, text);
          markers.push(
            new Marker({ element: label, anchor: "center" })
              .setLngLat([coordinate[0], coordinate[1]])
              .addTo(map),
          );
        });
      };
      gm.features.forEach(addLabels);
      gm.features.tmpForEach(addLabels);
    }
    (map as Evented).on("gm:editend", () => {
      updateLabels();
      log("Vertex edit finished");
    });
    (map as Evented).on("gm:remove", updateLabels);
    async function loadSamples() {
      buttons.forEach((button) => {
        button.disabled = true;
      });
      for (const feature of samples)
        await gm.features.importGeoJsonFeature(structuredClone(feature));
      editor.clearHistory();
      map.fitBounds(
        [
          [-0.003, -0.002],
          [0.003, 0.002],
        ],
        { padding: { left: 105, right: 65, top: 90, bottom: 70 }, duration: 0 },
      );
      updateLabels();
      activity = [];
      clearTarget();
      element("payload").textContent = "No snap event yet.";
      log("Two sample ways loaded · draw a line to begin");
      buttons.forEach((button) => {
        button.disabled = false;
      });
    }
    element("draw").addEventListener("click", () =>
      editor.enableDrawMode("line"),
    );
    element("edit").addEventListener("click", () =>
      editor.enableEditMode("change"),
    );
    element("reset").addEventListener("click", () => {
      window.location.reload();
    });
    await loadSamples();
  });
});
