import type { Feature, Polygon, LineString, Point, Position } from 'geojson';
import * as turf from '@turf/turf';

/**
 * Generate a unique ID for a feature
 */
export function generateFeatureId(): string {
  return `feature_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * Check if a feature has a valid geometry
 */
export function isValidGeometry(feature: Feature): boolean {
  if (!feature || !feature.geometry) return false;
  if (!('coordinates' in feature.geometry)) return false;

  try {
    // Try to get bbox - this will fail for invalid geometries
    turf.bbox(feature);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a feature is a polygon
 */
export function isPolygon(
  feature: Feature
): feature is Feature<Polygon> {
  return (
    feature.geometry.type === 'Polygon' ||
    feature.geometry.type === 'MultiPolygon'
  );
}

/**
 * Check if a feature is a line
 */
export function isLine(
  feature: Feature
): feature is Feature<LineString> {
  return (
    feature.geometry.type === 'LineString' ||
    feature.geometry.type === 'MultiLineString'
  );
}

/**
 * Check if a feature is a point
 */
export function isPoint(feature: Feature): feature is Feature<Point> {
  return feature.geometry.type === 'Point';
}

/**
 * Get the feature ID, generating one if it doesn't exist
 */
export function getFeatureId(feature: Feature): string {
  if (feature.id !== undefined) {
    return String(feature.id);
  }
  if (feature.properties?.id !== undefined) {
    return String(feature.properties.id);
  }
  return generateFeatureId();
}

/**
 * Ensure a feature has an ID
 */
export function ensureFeatureId(feature: Feature): Feature {
  if (feature.id === undefined) {
    return {
      ...feature,
      id: generateFeatureId(),
    };
  }
  return feature;
}

/**
 * Calculate the distance between two points in kilometers
 */
export function distanceBetweenPoints(
  point1: Position,
  point2: Position
): number {
  const from = turf.point(point1);
  const to = turf.point(point2);
  return turf.distance(from, to, { units: 'kilometers' });
}

/**
 * Calculate the bearing between two points in degrees
 */
export function bearingBetweenPoints(
  point1: Position,
  point2: Position
): number {
  const from = turf.point(point1);
  const to = turf.point(point2);
  return turf.bearing(from, to);
}

/**
 * Get the center point of a feature
 */
export function getCenter(feature: Feature): Position {
  const centroid = turf.centroid(feature);
  return centroid.geometry.coordinates;
}

/**
 * Get the bounding box center of a feature
 */
export function getBBoxCenter(feature: Feature): Position {
  const bbox = turf.bbox(feature);
  return [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2];
}

/**
 * Calculate the scale factor between two bounding boxes
 */
export function calculateScaleFactor(
  originalBBox: [number, number, number, number],
  newBBox: [number, number, number, number]
): number {
  const originalWidth = originalBBox[2] - originalBBox[0];
  const originalHeight = originalBBox[3] - originalBBox[1];
  const newWidth = newBBox[2] - newBBox[0];
  const newHeight = newBBox[3] - newBBox[1];

  const widthRatio = newWidth / originalWidth;
  const heightRatio = newHeight / originalHeight;

  return (widthRatio + heightRatio) / 2;
}

/**
 * Clamp a value between min and max
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Convert degrees to radians
 */
export function degreesToRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/**
 * Convert radians to degrees
 */
export function radiansToDegrees(radians: number): number {
  return (radians * 180) / Math.PI;
}

/**
 * Round coordinates to a specified precision
 */
export function roundCoordinates(
  coordinates: Position,
  precision: number = 6
): Position {
  return [
    Number(coordinates[0].toFixed(precision)),
    Number(coordinates[1].toFixed(precision)),
  ];
}

/**
 * Check if two positions are approximately equal
 */
export function positionsEqual(
  pos1: Position,
  pos2: Position,
  tolerance: number = 1e-9
): boolean {
  return (
    Math.abs(pos1[0] - pos2[0]) < tolerance &&
    Math.abs(pos1[1] - pos2[1]) < tolerance
  );
}

/**
 * Get vertex count of a feature
 */
export function getVertexCount(feature: Feature): number {
  return turf.coordAll(feature).length;
}

/**
 * Deep clone a feature
 */
export function cloneFeature<T extends Feature>(feature: T): T {
  return JSON.parse(JSON.stringify(feature)) as T;
}
