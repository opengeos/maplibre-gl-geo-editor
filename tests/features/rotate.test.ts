import { describe, it, expect } from "vitest";
import * as turf from "@turf/turf";
import type { Feature, Polygon, Position } from "geojson";
import { RotateFeature } from "../../src/lib/features/RotateFeature";

const square = (): Feature<Polygon> =>
  turf.polygon([
    [
      [0, 0],
      [0, 2],
      [2, 2],
      [2, 0],
      [0, 0],
    ],
  ]);

describe("RotateFeature", () => {
  const rotateFeature = new RotateFeature();

  describe("rotate", () => {
    it("rotates a polygon around its centroid by default", () => {
      const original = square();
      const rotated = rotateFeature.rotate(original, 90);

      // A 90 degree rotation around the centroid maps the bbox back onto itself
      // for a square, but the vertices move.
      const originalCoords = turf.coordAll(original);
      const rotatedCoords = turf.coordAll(rotated);
      const moved = rotatedCoords.some(
        (c, i) =>
          Math.abs(c[0] - originalCoords[i][0]) > 1e-6 ||
          Math.abs(c[1] - originalCoords[i][1]) > 1e-6,
      );
      expect(moved).toBe(true);

      // Centroid is preserved when rotating around the centroid.
      const oc = turf.centroid(original).geometry.coordinates;
      const rc = turf.centroid(rotated).geometry.coordinates;
      expect(rc[0]).toBeCloseTo(oc[0], 6);
      expect(rc[1]).toBeCloseTo(oc[1], 6);
    });

    it("does not mutate the input feature", () => {
      const original = square();
      const snapshot = JSON.stringify(original.geometry);
      rotateFeature.rotate(original, 45);
      expect(JSON.stringify(original.geometry)).toBe(snapshot);
    });

    it("returns to the original geometry after a 360 degree rotation", () => {
      const original = square();
      const rotated = rotateFeature.rotate(original, 360);
      const oc = turf.coordAll(original);
      const rc = turf.coordAll(rotated);
      rc.forEach((c, i) => {
        expect(c[0]).toBeCloseTo(oc[i][0], 6);
        expect(c[1]).toBeCloseTo(oc[i][1], 6);
      });
    });

    it("keeps the pivot vertex fixed when rotating around it", () => {
      const original = square();
      const pivot: Position = [0, 0];
      const rotated = rotateFeature.rotate(original, 45, pivot);

      const rotatedCoords = turf.coordAll(rotated);
      const pivotStillPresent = rotatedCoords.some(
        (c) =>
          Math.abs(c[0] - pivot[0]) < 1e-6 && Math.abs(c[1] - pivot[1]) < 1e-6,
      );
      expect(pivotStillPresent).toBe(true);
    });

    it("preserves feature id and properties", () => {
      const original = square();
      original.id = "abc";
      original.properties = { name: "test" };
      const rotated = rotateFeature.rotate(original, 30);
      expect(rotated.id).toBe("abc");
      expect(rotated.properties).toEqual({ name: "test" });
    });
  });

  describe("getPivotOptions", () => {
    it("lists the centroid first, then unique vertices", () => {
      const options = rotateFeature.getPivotOptions(square());
      expect(options[0].id).toBe("centroid");
      expect(options[0].label).toBe("Center");
      // Square has 4 unique vertices (the closing vertex is deduped).
      const vertexOptions = options.filter((o) => o.id.startsWith("vertex-"));
      expect(vertexOptions.length).toBe(4);
    });

    it("caps the number of vertex options", () => {
      const limited = new RotateFeature({ maxPivotVertices: 2 });
      const options = limited.getPivotOptions(square());
      const vertexOptions = options.filter((o) => o.id.startsWith("vertex-"));
      expect(vertexOptions.length).toBe(2);
    });
  });
});
