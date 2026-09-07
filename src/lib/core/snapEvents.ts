import type { Feature, Geometry, Position } from "geojson";
import type { GeomanFeatureData, SnapEvent } from "./types";

type Coordinate = [number, number];
type Candidate = { lngLat: Coordinate; distance: number };
type Handler = (
  feature: GeomanFeatureData,
  lngLat: Coordinate,
  point: Coordinate,
) => Candidate;

/** The small, version-sensitive boundary to Geoman Free's snapping helper. */
interface Helper {
  tolerance: number;
  getSnappedLngLat(lngLat: Coordinate, point: Coordinate): Coordinate;
  getPointsSnapping: Handler;
  getCustomLngLatsSnapping(point: Coordinate): Coordinate | null;
  shapeSnappingHandlers: Record<string, Handler | undefined>;
  gm: { mapAdapter: { project(coordinate: Coordinate): Coordinate } };
}

type Capture = {
  result: Candidate;
  feature?: GeomanFeatureData;
  kind: SnapEvent["target"]["kind"];
};

type LocatedCoordinate = {
  coordinate: Coordinate;
  path: Array<string | number>;
};

/** Walk coordinates within each part/ring; never create edges between parts. */
function visitGeometry(
  geometry: Geometry,
  vertex: (point: LocatedCoordinate) => void,
  segment: (start: LocatedCoordinate, end: LocatedCoordinate) => void,
  path: Array<string | number> = ["geometry"],
): void {
  if (geometry.type === "GeometryCollection") {
    geometry.geometries.forEach((part, index) =>
      visitGeometry(part, vertex, segment, [...path, "geometries", index]),
    );
    return;
  }
  const isPosition = (value: unknown): value is Position =>
    Array.isArray(value) && typeof value[0] === "number";
  function walk(value: unknown, currentPath: Array<string | number>): void {
    if (isPosition(value)) {
      vertex({ coordinate: [value[0], value[1]], path: currentPath });
    } else if (Array.isArray(value)) {
      value.forEach((item, index) => {
        walk(item, [...currentPath, index]);
        const next = value[index + 1];
        if (
          geometry.type !== "MultiPoint" &&
          isPosition(item) &&
          isPosition(next)
        ) {
          segment(
            { coordinate: [item[0], item[1]], path: [...currentPath, index] },
            {
              coordinate: [next[0], next[1]],
              path: [...currentPath, index + 1],
            },
          );
        }
      });
    }
  }
  walk(geometry.coordinates, [...path, "coordinates"]);
}

/**
 * Observe the actual winning return value, without choosing a second snap target.
 * Geoman 0.9.1 passes the winning coordinate array through by reference. Keep this
 * assumption covered by tests against the installed peer dependency.
 */
export function observeSnapping(
  value: unknown,
  notify: (event: SnapEvent | null) => void,
): (() => void) | null {
  const helper = value as Helper | undefined;
  if (
    !helper ||
    typeof helper.getSnappedLngLat !== "function" ||
    typeof helper.getPointsSnapping !== "function" ||
    typeof helper.getCustomLngLatsSnapping !== "function" ||
    !helper.shapeSnappingHandlers ||
    typeof helper.gm?.mapAdapter?.project !== "function"
  )
    return null;

  let captures: Capture[] | null = null;
  const restorers: Array<() => void> = [];
  function wrap<T extends object, K extends keyof T>(
    object: T,
    key: K,
    replacement: T[K],
  ) {
    const original = object[key];
    const own = Object.prototype.hasOwnProperty.call(object, key);
    object[key] = replacement;
    restorers.push(() => {
      if (object[key] !== replacement) return;
      if (own) object[key] = original;
      else delete object[key];
    });
  }

  function capture(handler: Handler, kind: Capture["kind"]): Handler {
    return function (feature, lngLat, point) {
      const result = handler.call(helper, feature, lngLat, point);
      captures?.push({ result, feature, kind });
      return result;
    };
  }

  wrap(
    helper,
    "getPointsSnapping",
    capture(helper.getPointsSnapping, "vertex"),
  );
  // These handlers are bound at construction, so wrapping getLineSnapping alone
  // would miss the line/segment branch.
  for (const [shape, handler] of Object.entries(helper.shapeSnappingHandlers)) {
    if (handler)
      wrap(helper.shapeSnappingHandlers, shape, capture(handler, "segment"));
  }
  const custom = helper.getCustomLngLatsSnapping;
  wrap(helper, "getCustomLngLatsSnapping", function (point) {
    const lngLat = custom.call(helper, point);
    if (lngLat)
      captures?.push({ result: { lngLat, distance: 0 }, kind: "custom" });
    return lngLat;
  });

  const original = helper.getSnappedLngLat;
  wrap(helper, "getSnappedLngLat", function (lngLat, point) {
    const previous = captures;
    const observed: Capture[] = [];
    captures = observed;
    let coordinate: Coordinate;
    try {
      coordinate = original.call(helper, lngLat, point);
    } finally {
      captures = previous;
    }
    const winner = observed.find(
      ({ result, kind }) =>
        result.lngLat === coordinate &&
        (kind === "custom" || result.distance < helper.tolerance),
    );
    const target = winner ? describeTarget(helper, winner, lngLat) : null;
    notify(
      target
        ? {
            coordinate: [...coordinate],
            pointerCoordinate: [...lngLat],
            target,
          }
        : null,
    );
    return coordinate;
  });

  return () => {
    restorers.reverse().forEach((restore) => restore());
  };
}

function describeTarget(
  helper: Helper,
  winner: Capture,
  pointer: Coordinate,
): SnapEvent["target"] | null {
  if (!winner.feature) return { kind: "custom" };
  const feature = winner.feature.getGeoJson?.() ?? winner.feature.geoJson;
  if (!feature) return null;
  // Snapshot properties/geometry so future edits cannot change an emitted target.
  const snapshot = structuredClone(feature) as Feature;
  const base = {
    featureId: winner.feature.id,
    feature: snapshot,
    temporary: !!winner.feature.temporary,
  };
  if (winner.kind === "vertex") {
    let coordinatePath: Array<string | number> | undefined;
    visitGeometry(
      feature.geometry,
      (position) => {
        if (
          !coordinatePath &&
          position.coordinate[0] === winner.result.lngLat[0] &&
          position.coordinate[1] === winner.result.lngLat[1]
        )
          coordinatePath = [...position.path];
      },
      () => {},
    );
    return coordinatePath ? { ...base, kind: "vertex", coordinatePath } : null;
  }

  // Replay only the winning feature's segment traversal, using the same planar
  // projection and strict first-minimum rule as Geoman 0.9.1's map adapter.
  const screen = helper.gm.mapAdapter.project(pointer);
  let distance = Infinity;
  let segmentPaths:
    | [Array<string | number>, Array<string | number>]
    | undefined;
  visitGeometry(
    feature.geometry,
    () => {},
    (start, end) => {
      const a = helper.gm.mapAdapter.project(start.coordinate);
      const b = helper.gm.mapAdapter.project(end.coordinate);
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const lengthSquared = dx * dx + dy * dy;
      const fraction =
        lengthSquared === 0
          ? 0
          : Math.max(
              0,
              Math.min(
                1,
                ((screen[0] - a[0]) * dx + (screen[1] - a[1]) * dy) /
                  lengthSquared,
              ),
            );
      const nearest = [a[0] + fraction * dx, a[1] + fraction * dy];
      const candidateDistance = Math.sqrt(
        (screen[0] - nearest[0]) ** 2 + (screen[1] - nearest[1]) ** 2,
      );
      if (candidateDistance < distance) {
        distance = candidateDistance;
        segmentPaths = [[...start.path], [...end.path]];
      }
    },
  );
  return segmentPaths ? { ...base, kind: "segment", segmentPaths } : null;
}
