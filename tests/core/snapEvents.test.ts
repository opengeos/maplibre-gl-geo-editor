import { describe, expect, it, vi } from "vitest";
import {
  BaseMapAdapter,
  helperClassMap,
} from "@geoman-io/maplibre-geoman-free";
import type { Feature, Geometry } from "geojson";
import { observeSnapping } from "../../src/lib/core/snapEvents";
import { GeoEditor } from "../../src/lib/core/GeoEditor";
import type { SnapEvent } from "../../src/lib/core/types";

function feature(id: string, geometry: Geometry, temporary = false) {
  const geoJson: Feature = {
    type: "Feature",
    id,
    geometry,
    properties: { osm_id: id, version: 7 },
  };
  return {
    id,
    temporary,
    shape: geometry.type.includes("Polygon") ? "polygon" : "line",
    getGeoJson: () => structuredClone(geoJson),
    delete: vi.fn(),
  };
}

// Use the real installed Geoman helper and nearest-segment implementation.
// Only projection/rendering and feature lookup are stubbed.
function fixture(features: ReturnType<typeof feature>[]) {
  const adapter = Object.assign(Object.create(BaseMapAdapter.prototype), {
    project: (p: number[]) => [...p],
    unproject: (p: number[]) => [...p],
  });
  const gm: any = {
    options: { settings: { snapDistance: 2 } },
    mapAdapter: adapter,
    features: { getFeaturesByScreenBounds: () => features },
  };
  const Helper = helperClassMap.snapping!;
  const helper = new Helper(gm) as any;
  const events: Array<SnapEvent | null> = [];
  const detach = observeSnapping(helper, (event) => events.push(event))!;
  return { helper, events, detach };
}

const line = (y = 0): Geometry => ({
  type: "LineString",
  coordinates: [
    [0, y],
    [20, y],
  ],
});

describe("Geoman snap observation", () => {
  it("preserves coordinates and reports the selected feature, including coincident IDs", () => {
    const first = feature("way/1", line());
    const second = feature("way/2", line());
    const { helper, events } = fixture([second, first]);
    expect(helper.getSnappedLngLat([0.5, 0], [0.5, 0])).toEqual([0, 0]);
    expect(events.at(-1)?.target).toMatchObject({
      kind: "vertex",
      featureId: "way/2",
      coordinatePath: ["geometry", "coordinates", 0],
      feature: { properties: { version: 7 } },
    });
  });

  it("selects by distance and respects Geoman's vertex-before-segment priority", () => {
    const { helper, events } = fixture([
      feature("far", line(1)),
      feature("near", line()),
    ]);
    helper.getSnappedLngLat([0.5, 0], [0.5, 0]);
    expect(events.at(-1)?.target).toMatchObject({
      kind: "vertex",
      featureId: "near",
    });
  });

  it("reports the actual nearest segment and leaves the result unchanged", () => {
    const { helper, events } = fixture([feature("way/3", line())]);
    expect(helper.getSnappedLngLat([10, 1], [10, 1])).toEqual([10, 0]);
    expect(events.at(-1)?.target).toMatchObject({
      kind: "segment",
      featureId: "way/3",
      segmentPaths: [
        ["geometry", "coordinates", 0],
        ["geometry", "coordinates", 1],
      ],
    });
  });

  it("handles multipart geometry without connecting parts", () => {
    const geometry: Geometry = {
      type: "MultiLineString",
      coordinates: [
        [
          [0, 0],
          [20, 0],
        ],
        [
          [0, 10],
          [20, 10],
        ],
      ],
    };
    const { helper, events } = fixture([feature("multi", geometry)]);
    helper.getSnappedLngLat([10, 9], [10, 9]);
    expect(events.at(-1)?.target).toMatchObject({
      kind: "segment",
      segmentPaths: [
        ["geometry", "coordinates", 1, 0],
        ["geometry", "coordinates", 1, 1],
      ],
    });
  });

  it("reports polygon closing segments and canonical first vertices", () => {
    const geometry: Geometry = {
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [20, 0],
          [20, 20],
          [0, 20],
          [0, 0],
        ],
      ],
    };
    const { helper, events } = fixture([feature("polygon", geometry)]);
    helper.getSnappedLngLat([1, 10], [1, 10]);
    expect(events.at(-1)?.target).toMatchObject({
      kind: "segment",
      segmentPaths: [
        ["geometry", "coordinates", 0, 3],
        ["geometry", "coordinates", 0, 4],
      ],
    });
    helper.getSnappedLngLat([0.5, 0.5], [0.5, 0.5]);
    expect(events.at(-1)?.target).toMatchObject({
      kind: "vertex",
      coordinatePath: ["geometry", "coordinates", 0, 0],
    });
  });

  it("keeps custom-coordinate snaps separate from feature identity", () => {
    const { helper, events } = fixture([feature("way/3", line())]);
    helper.setCustomSnappingCoordinates("draw", [[0, 0]]);
    helper.getSnappedLngLat([0.5, 0], [0.5, 0]);
    expect(events.at(-1)?.target).toEqual({ kind: "custom" });
  });

  it("honors exclusions, temporary-feature eligibility, and tolerance", () => {
    const excluded = feature("excluded", line());
    const temporary = feature("temporary", line(), true);
    const { helper, events } = fixture([excluded, temporary]);
    helper.addExcludedFeature(excluded);
    helper.getSnappedLngLat([0.5, 0], [0.5, 0]);
    expect(events.at(-1)).toBeNull();
    helper.addCustomSnappingFeature(temporary);
    helper.getSnappedLngLat([0.5, 0], [0.5, 0]);
    expect(events.at(-1)?.target).toMatchObject({
      featureId: "temporary",
      temporary: true,
    });
    helper.getSnappedLngLat([10, 2], [10, 2]);
    expect(events.at(-1)).toBeNull();
  });

  it("restores methods and stops reporting on detach", () => {
    const { helper, events, detach } = fixture([feature("way/3", line())]);
    helper.getSnappedLngLat([0, 0], [0, 0]);
    detach();
    helper.getSnappedLngLat([0, 0], [0, 0]);
    expect(events).toHaveLength(1);
    expect(Object.hasOwn(helper, "getSnappedLngLat")).toBe(false);
  });

  it("rejects incompatible helper shapes", () => {
    expect(observeSnapping({}, vi.fn())).toBeNull();
  });
});

describe("GeoEditor snap events", () => {
  it("does not enable snapping twice when React supplies the same Geoman instance", () => {
    const editor = new GeoEditor({ hideGeomanControl: false });
    const gm = { enableMode: vi.fn(), setGlobalEventsListener: vi.fn() };
    editor.setGeoman(gm);
    editor.setGeoman(gm);
    expect(gm.enableMode).toHaveBeenCalledTimes(1);
    expect(gm.setGlobalEventsListener).toHaveBeenCalledTimes(1);
  });

  it("emits DOM events, clears stale targets, and reattaches after helper recreation", () => {
    const onSnap = vi.fn();
    const onUnsnap = vi.fn();
    const editor = new GeoEditor({ snapEventsEnabled: true, onSnap, onUnsnap });
    const container = document.createElement("div");
    const domSnap = vi.fn();
    container.addEventListener("gm:snap", domSnap);
    const internal = editor as any;
    internal.map = { getContainer: () => container };
    const first = fixture([feature("first", line())]);
    first.detach();
    const gm = { actionInstances: { helper__snapping: first.helper } };
    internal.geoman = gm;
    internal.refreshSnapObserver();
    expect(editor.isSnapTrackingAvailable()).toBe(true);
    first.helper.getSnappedLngLat([0.5, 0], [0.5, 0]);
    expect(onSnap).toHaveBeenCalledOnce();
    expect(domSnap).toHaveBeenCalledOnce();
    const snapshot = editor.getSnapTarget()!;
    snapshot.coordinate[0] = 123;
    expect(editor.getSnapTarget()?.coordinate).toEqual([0, 0]);
    const next = fixture([feature("next", line())]);
    next.detach();
    gm.actionInstances.helper__snapping = next.helper;
    internal.refreshSnapObserver();
    expect(editor.getSnapTarget()).toBeNull();
    expect(onUnsnap).toHaveBeenCalledOnce();
    next.helper.getSnappedLngLat([0.5, 0], [0.5, 0]);
    expect(editor.getSnapTarget()?.target).toMatchObject({ featureId: "next" });
    internal.snapObserverRemoved = true;
    internal.clearSnapObserver();
    internal.refreshSnapObserver();
    expect(editor.isSnapTrackingAvailable()).toBe(false);
  });

  it("does not patch Geoman unless explicitly enabled", () => {
    const editor = new GeoEditor() as any;
    const { helper, detach } = fixture([]);
    detach();
    editor.map = {};
    editor.geoman = { actionInstances: { helper__snapping: helper } };
    editor.refreshSnapObserver();
    expect(editor.isSnapTrackingAvailable()).toBe(false);
    expect(Object.hasOwn(helper, "getSnappedLngLat")).toBe(false);
  });
});
