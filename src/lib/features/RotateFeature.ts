import type { Feature, Position } from "geojson";
import * as turf from "@turf/turf";
import type { RotateOptions, RotatePivotOption } from "../core/types";
import { generateFeatureId } from "../utils/geometryUtils";

/**
 * Handles precise, numerical rotation of features.
 *
 * Unlike Geoman's drag-based rotate mode, this applies an exact angle in
 * degrees around a chosen pivot (the centroid by default, or a specific
 * vertex), so the same rotation can be repeated identically across features.
 */
export class RotateFeature {
  private options: Required<RotateOptions>;

  constructor(options: RotateOptions = {}) {
    this.options = {
      maxPivotVertices: options.maxPivotVertices ?? 60,
    };
  }

  /**
   * Rotate a feature by an exact angle in degrees.
   *
   * @param feature - The feature to rotate.
   * @param angle - Rotation angle in degrees. Positive values rotate
   *   clockwise; negative values rotate counter-clockwise.
   * @param pivot - Optional pivot coordinate. Defaults to the feature centroid.
   * @returns A new rotated feature; the input feature is left unchanged.
   */
  rotate(feature: Feature, angle: number, pivot?: Position): Feature {
    const center =
      pivot || (turf.centroid(feature).geometry.coordinates as Position);

    // turf.transformRotate clones by default (mutate is false), so the input
    // feature is not modified.
    const rotated = turf.transformRotate(feature, angle, {
      pivot: center as [number, number],
    }) as Feature;

    rotated.id = feature.id ?? generateFeatureId();
    rotated.properties = { ...feature.properties };

    return rotated;
  }

  /**
   * Build the list of pivot choices offered in the rotate popup: the feature
   * centroid plus each unique vertex (capped at `maxPivotVertices`).
   *
   * @param feature - The feature whose pivots are listed.
   * @returns Pivot options, with the centroid first.
   */
  getPivotOptions(feature: Feature): RotatePivotOption[] {
    const options: RotatePivotOption[] = [
      {
        id: "centroid",
        label: "Center",
        coordinates: turf.centroid(feature).geometry.coordinates as Position,
      },
    ];

    const seen = new Set<string>();
    let index = 0;
    for (const coord of turf.coordAll(feature)) {
      const key = `${coord[0]},${coord[1]}`;
      if (seen.has(key)) continue;
      seen.add(key);
      index += 1;
      options.push({
        id: `vertex-${index}`,
        label: `Vertex ${index}`,
        coordinates: [coord[0], coord[1]],
      });
      if (index >= this.options.maxPivotVertices) break;
    }

    return options;
  }
}
