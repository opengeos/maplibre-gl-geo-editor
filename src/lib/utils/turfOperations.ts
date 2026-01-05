import * as turf from '@turf/turf';
import type {
  Feature,
  Polygon,
  MultiPolygon,
  LineString,
  Point,
  FeatureCollection,
  Position,
} from 'geojson';

/**
 * Safe wrapper for turf.union that handles edge cases
 */
export function safeUnion(
  features: Feature<Polygon | MultiPolygon>[]
): Feature<Polygon | MultiPolygon> | null {
  try {
    if (features.length === 0) return null;
    if (features.length === 1) return turf.clone(features[0]);

    const collection = turf.featureCollection(features);
    return turf.union(collection) as Feature<Polygon | MultiPolygon> | null;
  } catch (error) {
    console.error('Union operation failed:', error);
    return null;
  }
}

/**
 * Safe wrapper for turf.difference
 */
export function safeDifference(
  polygon1: Feature<Polygon | MultiPolygon>,
  polygon2: Feature<Polygon | MultiPolygon>
): Feature<Polygon | MultiPolygon> | null {
  try {
    const collection = turf.featureCollection([polygon1, polygon2]);
    return turf.difference(collection) as Feature<Polygon | MultiPolygon> | null;
  } catch (error) {
    console.error('Difference operation failed:', error);
    return null;
  }
}

/**
 * Safe wrapper for turf.simplify
 */
export function safeSimplify<T extends Feature>(
  feature: T,
  options: { tolerance: number; highQuality?: boolean }
): T {
  try {
    return turf.simplify(feature, options) as T;
  } catch (error) {
    console.error('Simplify operation failed:', error);
    return turf.clone(feature) as T;
  }
}

/**
 * Safe wrapper for turf.transformScale
 */
export function safeScale(
  feature: Feature,
  factor: number,
  origin?: Position
): Feature {
  try {
    const options = origin ? { origin: origin as [number, number] } : {};
    return turf.transformScale(feature, factor, options);
  } catch (error) {
    console.error('Scale operation failed:', error);
    return turf.clone(feature);
  }
}

/**
 * Get centroid with fallback for invalid geometries
 */
export function safeCentroid(feature: Feature): Feature<Point> {
  try {
    return turf.centroid(feature);
  } catch {
    // Fallback to center of bounding box
    const bbox = turf.bbox(feature);
    return turf.point([(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2]);
  }
}

/**
 * Safe wrapper for turf.clone
 */
export function safeClone<T extends Feature>(feature: T): T {
  try {
    return turf.clone(feature) as T;
  } catch (error) {
    console.error('Clone operation failed:', error);
    return JSON.parse(JSON.stringify(feature)) as T;
  }
}

/**
 * Safe wrapper for turf.transformTranslate
 */
export function safeTranslate(
  feature: Feature,
  distance: number,
  direction: number
): Feature {
  try {
    return turf.transformTranslate(feature, distance, direction);
  } catch (error) {
    console.error('Translate operation failed:', error);
    return turf.clone(feature);
  }
}

/**
 * Safe wrapper for turf.lineSplit
 */
export function safeLineSplit(
  line: Feature<LineString>,
  splitter: Feature<LineString>
): FeatureCollection<LineString> {
  try {
    return turf.lineSplit(line, splitter as Parameters<typeof turf.lineSplit>[1]) as FeatureCollection<LineString>;
  } catch (error) {
    console.error('Line split operation failed:', error);
    return turf.featureCollection([line]);
  }
}

/**
 * Safe wrapper for turf.lineIntersect
 */
export function safeLineIntersect(
  line1: Feature<LineString>,
  line2: Feature<LineString>
): FeatureCollection<Point> {
  try {
    return turf.lineIntersect(line1, line2);
  } catch (error) {
    console.error('Line intersect operation failed:', error);
    return turf.featureCollection([]);
  }
}

/**
 * Check if a feature is within another feature
 */
export function isWithin(feature: Feature, container: Feature): boolean {
  try {
    return turf.booleanWithin(feature, container);
  } catch {
    return false;
  }
}

/**
 * Check if two features intersect
 */
export function intersects(feature1: Feature, feature2: Feature): boolean {
  try {
    return turf.booleanIntersects(feature1, feature2);
  } catch {
    return false;
  }
}

/**
 * Check if two polygons overlap
 */
export function overlaps(
  feature1: Feature<Polygon | MultiPolygon>,
  feature2: Feature<Polygon | MultiPolygon>
): boolean {
  try {
    return turf.booleanOverlap(feature1, feature2);
  } catch {
    return false;
  }
}

/**
 * Check if polygon1 contains polygon2
 */
export function contains(
  container: Feature<Polygon | MultiPolygon>,
  contained: Feature<Polygon | MultiPolygon>
): boolean {
  try {
    return turf.booleanContains(container, contained);
  } catch {
    return false;
  }
}

/**
 * Get bounding box of a feature
 */
export function getBBox(feature: Feature): [number, number, number, number] {
  return turf.bbox(feature) as [number, number, number, number];
}

/**
 * Get all coordinates from a feature
 */
export function getCoordAll(feature: Feature): Position[] {
  return turf.coordAll(feature);
}

/**
 * Convert polygon to line
 */
export function polygonToLine(
  polygon: Feature<Polygon | MultiPolygon>
): ReturnType<typeof turf.polygonToLine> {
  return turf.polygonToLine(polygon);
}

/**
 * Create a polygon from coordinates
 */
export function createPolygon(
  coordinates: Position[][],
  properties?: Record<string, unknown>
): Feature<Polygon> {
  return turf.polygon(coordinates, properties);
}

/**
 * Create a line from coordinates
 */
export function createLine(
  coordinates: Position[],
  properties?: Record<string, unknown>
): Feature<LineString> {
  return turf.lineString(coordinates, properties);
}

/**
 * Create a point from coordinates
 */
export function createPoint(
  coordinates: Position,
  properties?: Record<string, unknown>
): Feature<Point> {
  return turf.point(coordinates, properties);
}

/**
 * Create a feature collection
 */
export function createFeatureCollection<T extends Feature>(
  features: T[]
): FeatureCollection {
  return turf.featureCollection(features);
}

/**
 * Calculate the area of a polygon in square meters
 */
export function calculateArea(feature: Feature<Polygon | MultiPolygon>): number {
  try {
    return turf.area(feature);
  } catch {
    return 0;
  }
}

/**
 * Calculate the length of a line in kilometers
 */
export function calculateLength(feature: Feature<LineString>): number {
  try {
    return turf.length(feature, { units: 'kilometers' });
  } catch {
    return 0;
  }
}

/**
 * Get the bounding box corners as coordinates
 */
export function getBBoxCorners(feature: Feature): Position[] {
  const bbox = turf.bbox(feature);
  return [
    [bbox[0], bbox[3]], // NW
    [bbox[2], bbox[3]], // NE
    [bbox[2], bbox[1]], // SE
    [bbox[0], bbox[1]], // SW
  ];
}

/**
 * Get the midpoints of the bounding box edges
 */
export function getBBoxMidpoints(feature: Feature): Position[] {
  const bbox = turf.bbox(feature);
  const midX = (bbox[0] + bbox[2]) / 2;
  const midY = (bbox[1] + bbox[3]) / 2;
  return [
    [midX, bbox[3]], // N
    [bbox[2], midY], // E
    [midX, bbox[1]], // S
    [bbox[0], midY], // W
  ];
}
