import type { Feature, Polygon } from 'geojson';
import * as turf from '@turf/turf';
import type { SelectedFeature } from '../core/types';
import { isPolygon } from './geometryUtils';

/**
 * Filter features that are within a lasso polygon
 */
export function selectFeaturesWithinLasso(
  features: Feature[],
  lasso: Feature<Polygon>,
  mode: 'contains' | 'intersects' = 'intersects'
): Feature[] {
  return features.filter((feature) => {
    try {
      if (mode === 'contains') {
        return turf.booleanWithin(feature, lasso);
      } else {
        return turf.booleanIntersects(feature, lasso);
      }
    } catch {
      return false;
    }
  });
}

/**
 * Filter features by geometry type
 */
export function filterByGeometryType(
  features: Feature[],
  types: string[]
): Feature[] {
  return features.filter((feature) =>
    types.includes(feature.geometry.type)
  );
}

/**
 * Get only polygon features from a collection
 */
export function getPolygonFeatures(
  features: Feature[]
): Feature<Polygon>[] {
  return features.filter(isPolygon) as Feature<Polygon>[];
}

/**
 * Check if selection contains only polygons
 */
export function isPolygonOnlySelection(features: Feature[]): boolean {
  return features.every(isPolygon);
}

/**
 * Check if features can be merged (union)
 * At least 2 polygons that overlap or touch
 */
export function canMergeFeatures(features: Feature[]): {
  canMerge: boolean;
  reason?: string;
} {
  if (features.length < 2) {
    return { canMerge: false, reason: 'Select at least 2 features to merge' };
  }

  const polygons = getPolygonFeatures(features);
  if (polygons.length < 2) {
    return { canMerge: false, reason: 'Select at least 2 polygons to merge' };
  }

  // Check if any polygons overlap or touch
  for (let i = 0; i < polygons.length; i++) {
    for (let j = i + 1; j < polygons.length; j++) {
      try {
        if (
          turf.booleanOverlap(polygons[i], polygons[j]) ||
          turf.booleanIntersects(polygons[i], polygons[j])
        ) {
          return { canMerge: true };
        }
      } catch {
        // Continue checking
      }
    }
  }

  // Allow merge even if not overlapping (will result in MultiPolygon)
  return { canMerge: true };
}

/**
 * Check if features can be used for difference operation
 */
export function canSubtractFeatures(features: Feature[]): {
  canSubtract: boolean;
  reason?: string;
} {
  if (features.length < 2) {
    return {
      canSubtract: false,
      reason: 'Select a base polygon and at least one polygon to subtract',
    };
  }

  const polygons = getPolygonFeatures(features);
  if (polygons.length < 2) {
    return { canSubtract: false, reason: 'All features must be polygons' };
  }

  return { canSubtract: true };
}

/**
 * Convert Feature array to SelectedFeature array
 */
export function toSelectedFeatures(
  features: Feature[],
  layerId: string = 'default'
): SelectedFeature[] {
  return features.map((feature) => ({
    id: String(feature.id || `temp_${Date.now()}_${Math.random()}`),
    feature,
    layerId,
  }));
}

/**
 * Convert SelectedFeature array to Feature array
 */
export function fromSelectedFeatures(selected: SelectedFeature[]): Feature[] {
  return selected.map((s) => s.feature);
}

/**
 * Check if a feature is in the selection
 */
export function isFeatureSelected(
  feature: Feature,
  selection: SelectedFeature[]
): boolean {
  const featureId = String(feature.id);
  return selection.some((s) => s.id === featureId);
}

/**
 * Add feature to selection
 */
export function addToSelection(
  selection: SelectedFeature[],
  feature: Feature,
  layerId: string = 'default'
): SelectedFeature[] {
  if (isFeatureSelected(feature, selection)) {
    return selection;
  }

  return [
    ...selection,
    {
      id: String(feature.id || generateTempId()),
      feature,
      layerId,
    },
  ];
}

/**
 * Remove feature from selection
 */
export function removeFromSelection(
  selection: SelectedFeature[],
  featureId: string
): SelectedFeature[] {
  return selection.filter((s) => s.id !== featureId);
}

/**
 * Toggle feature in selection
 */
export function toggleInSelection(
  selection: SelectedFeature[],
  feature: Feature,
  layerId: string = 'default'
): SelectedFeature[] {
  const featureId = String(feature.id);
  if (isFeatureSelected(feature, selection)) {
    return removeFromSelection(selection, featureId);
  }
  return addToSelection(selection, feature, layerId);
}

/**
 * Generate a temporary ID
 */
function generateTempId(): string {
  return `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}
