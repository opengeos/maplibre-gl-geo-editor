import type {
  Feature,
  MultiPolygon,
  Polygon,
  Position,
} from "geojson";
import * as turf from "@turf/turf";

export type PolygonFeature = Feature<Polygon | MultiPolygon>;

const isPolygonFeature = (feature: Feature): feature is PolygonFeature =>
  feature.geometry?.type === "Polygon" ||
  feature.geometry?.type === "MultiPolygon";

const positions = (feature: PolygonFeature): Position[] => {
  const polygons =
    feature.geometry.type === "Polygon"
      ? [feature.geometry.coordinates]
      : feature.geometry.coordinates;
  return polygons.flatMap((polygon) => polygon.flatMap((ring) => ring));
};

const samePosition = (
  left: Position,
  right: Position,
  tolerance: number,
): boolean =>
  Math.abs(left[0] - right[0]) <= tolerance &&
  Math.abs(left[1] - right[1]) <= tolerance;

/**
 * Remove areas already covered by existing polygons from a newly drawn polygon.
 * Turf's polygon-clipping engine reuses the existing edge coordinates in the
 * result, so the surviving polygon has an exact shared boundary and no overlap.
 */
export function removePolygonOverlaps(
  feature: Feature,
  existingFeatures: Feature[],
): PolygonFeature | null {
  if (!isPolygonFeature(feature)) return null;

  const masks = existingFeatures.filter(isPolygonFeature);
  if (masks.length === 0) return feature;

  const result = turf.difference(
    turf.featureCollection([feature, ...masks]),
  ) as PolygonFeature | null;
  if (!result) return null;

  result.id = feature.id;
  result.properties = feature.properties;
  return result;
}

/**
 * Apply vertex moves from one edited polygon to other polygons that shared the
 * original vertex. Rings must retain their vertex order, which is how ordinary
 * vertex editing behaves. Structural operations such as split and union are
 * deliberately ignored because they do not describe unambiguous node moves.
 */
export function propagateSharedVertexMoves(
  oldFeature: Feature,
  newFeature: Feature,
  targetFeatures: Feature[],
  tolerance = 1e-10,
): PolygonFeature[] {
  if (!isPolygonFeature(oldFeature) || !isPolygonFeature(newFeature)) return [];

  const before = positions(oldFeature);
  const after = positions(newFeature);
  if (before.length !== after.length) return [];

  const moves = before.flatMap((from, index) =>
    samePosition(from, after[index], tolerance)
      ? []
      : [{ from, to: after[index] }],
  );
  if (moves.length === 0) return [];

  const changed: PolygonFeature[] = [];
  for (const target of targetFeatures) {
    if (!isPolygonFeature(target)) continue;

    let didChange = false;
    const replace = (position: Position): Position => {
      const move = moves.find(({ from }) =>
        samePosition(position, from, tolerance),
      );
      if (!move) return position;
      didChange = true;
      return [...move.to];
    };

    const geometry =
      target.geometry.type === "Polygon"
        ? {
            ...target.geometry,
            coordinates: target.geometry.coordinates.map((ring) =>
              ring.map(replace),
            ),
          }
        : {
            ...target.geometry,
            coordinates: target.geometry.coordinates.map((polygon) =>
              polygon.map((ring) => ring.map(replace)),
            ),
          };

    if (didChange) changed.push({ ...target, geometry } as PolygonFeature);
  }

  return changed;
}

export { isPolygonFeature };
