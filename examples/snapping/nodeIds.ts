import type { Feature } from "geojson";
import type { MarkerData } from "@geoman-io/maplibre-geoman-free";

/** Keep the demo's ordered IDs aligned with an explicit Geoman vertex edit. */
export function editedNodeIds(
  feature: Feature,
  marker: MarkerData | null,
  createLocalId: () => string,
): string[] | null {
  const ids = feature.properties?.node_ids;
  if (
    feature.geometry.type !== "LineString" ||
    !Array.isArray(ids) ||
    !ids.every((id) => typeof id === "string") ||
    !marker
  )
    return null;
  const count = feature.geometry.coordinates.length;
  const updated = [...ids];
  if (count === ids.length + 1 && marker.type === "edge") {
    // Geoman mutates segment.end.path while inserting; the start path stays intact.
    const path = marker.segment.start.path;
    const start = path.at(-1);
    if (
      path.length !== 3 ||
      path[0] !== "geometry" ||
      path[1] !== "coordinates" ||
      typeof start !== "number" ||
      !Number.isInteger(start) ||
      start < 0 ||
      start >= ids.length - 1
    )
      return null;
    updated.splice(start + 1, 0, createLocalId());
  } else if (count === ids.length - 1 && marker.type === "vertex") {
    const path = marker.position.path;
    const index = path.at(-1);
    if (
      path.length !== 3 ||
      path[0] !== "geometry" ||
      path[1] !== "coordinates" ||
      typeof index !== "number" ||
      !Number.isInteger(index) ||
      index < 0 ||
      index >= ids.length
    )
      return null;
    updated.splice(index, 1);
  } else {
    // Moving a vertex retains its ID. Unknown structural changes aren't guessed.
    return null;
  }
  return updated;
}
