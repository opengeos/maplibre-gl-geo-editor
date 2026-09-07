import { describe, it, expect, vi } from "vitest";
import type { Feature, LineString } from "geojson";
import type { MarkerData } from "@geoman-io/maplibre-geoman-free";
import { editedNodeIds } from "../../examples/snapping/nodeIds";

const feature = (count: number): Feature<LineString> => ({
  type: "Feature",
  properties: { node_ids: ["node/101", "node/102", "node/103"] },
  // Coincident coordinates must not influence identity assignment.
  geometry: {
    type: "LineString",
    coordinates: Array.from({ length: count }, () => [0, 0]),
  },
});
const edge = (index: number) =>
  ({
    type: "edge",
    segment: {
      start: { path: ["geometry", "coordinates", index] },
      end: { path: ["geometry", "coordinates"] }, // Geoman already popped this index.
    },
  }) as unknown as MarkerData;
const vertex = (index: number) =>
  ({
    type: "vertex",
    position: {
      path: ["geometry", "coordinates", index],
    },
  }) as unknown as MarkerData;

describe("demo node identity during vertex editing", () => {
  it("inserts a local ID without renumbering the existing nodes", () => {
    const input = feature(4);
    expect(editedNodeIds(input, edge(0), () => "local/node-1")).toEqual([
      "node/101",
      "local/node-1",
      "node/102",
      "node/103",
    ]);
    expect(input.properties?.node_ids).toEqual([
      "node/101",
      "node/102",
      "node/103",
    ]);
  });
  it("removes only the deleted vertex's ID", () => {
    expect(editedNodeIds(feature(2), vertex(1), () => "unused")).toEqual([
      "node/101",
      "node/103",
    ]);
  });
  it("preserves IDs when vertices move", () => {
    const allocate = vi.fn();
    expect(editedNodeIds(feature(3), vertex(1), allocate)).toBeNull();
    expect(allocate).not.toHaveBeenCalled();
  });
  it("does not guess identities for unsupported structural changes", () => {
    expect(editedNodeIds(feature(5), edge(0), () => "unused")).toBeNull();
    expect(editedNodeIds(feature(4), edge(3), () => "unused")).toBeNull();
    expect(editedNodeIds(feature(4), null, () => "unused")).toBeNull();
  });
});
