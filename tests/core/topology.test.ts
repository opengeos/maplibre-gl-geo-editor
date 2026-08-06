import { describe, expect, it } from "vitest";
import type { Feature, Polygon } from "geojson";
import {
  propagateSharedVertexMoves,
  removePolygonOverlaps,
} from "../../src/lib/core/topology";

const polygon = (
  coordinates: number[][],
  id: string,
): Feature<Polygon> => ({
  type: "Feature",
  id,
  properties: { name: id },
  geometry: {
    type: "Polygon",
    coordinates: [coordinates],
  },
});

describe("topological polygon helpers", () => {
  it("removes existing coverage and reuses the shared boundary", () => {
    const existing = polygon(
      [
        [0, 0],
        [2, 0],
        [2, 2],
        [0, 2],
        [0, 0],
      ],
      "existing",
    );
    const drawn = polygon(
      [
        [1, 0],
        [3, 0],
        [3, 2],
        [1, 2],
        [1, 0],
      ],
      "drawn",
    );

    const result = removePolygonOverlaps(drawn, [existing]);

    expect(result?.id).toBe("drawn");
    expect(result?.properties).toEqual({ name: "drawn" });
    expect(result?.geometry.coordinates).toEqual([
      [
        [2, 0],
        [3, 0],
        [3, 2],
        [2, 2],
        [2, 0],
      ],
    ]);
  });

  it("returns null when an existing polygon fully covers the new polygon", () => {
    const existing = polygon(
      [
        [0, 0],
        [3, 0],
        [3, 3],
        [0, 3],
        [0, 0],
      ],
      "existing",
    );
    const drawn = polygon(
      [
        [1, 1],
        [2, 1],
        [2, 2],
        [1, 2],
        [1, 1],
      ],
      "drawn",
    );

    expect(removePolygonOverlaps(drawn, [existing])).toBeNull();
  });

  it("moves matching vertices in adjacent polygons", () => {
    const before = polygon(
      [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
        [0, 0],
      ],
      "left",
    );
    const after = polygon(
      [
        [0, 0],
        [1.25, 0],
        [1, 1],
        [0, 1],
        [0, 0],
      ],
      "left",
    );
    const adjacent = polygon(
      [
        [1, 0],
        [2, 0],
        [2, 1],
        [1, 1],
        [1, 0],
      ],
      "right",
    );

    const [updated] = propagateSharedVertexMoves(before, after, [adjacent]);

    expect(updated.id).toBe("right");
    expect(updated.geometry.coordinates[0][0]).toEqual([1.25, 0]);
    expect(updated.geometry.coordinates[0][4]).toEqual([1.25, 0]);
    expect(updated.geometry.coordinates[0][3]).toEqual([1, 1]);
  });

  it("ignores edits that change the polygon vertex structure", () => {
    const before = polygon(
      [
        [0, 0],
        [1, 0],
        [0, 1],
        [0, 0],
      ],
      "before",
    );
    const after = polygon(
      [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
        [0, 0],
      ],
      "after",
    );

    expect(propagateSharedVertexMoves(before, after, [before])).toEqual([]);
  });
});
