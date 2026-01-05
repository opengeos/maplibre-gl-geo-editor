import type { Feature, Polygon, MultiPolygon } from 'geojson';
import * as turf from '@turf/turf';
import type { UnionOptions, UnionResult } from '../core/types';
import { generateFeatureId } from '../utils/geometryUtils';

/**
 * Handles polygon union/merge operations
 */
export class UnionFeature {
  /**
   * Merge multiple polygons into one
   */
  union(
    features: Feature<Polygon | MultiPolygon>[],
    options?: UnionOptions
  ): UnionResult {
    if (features.length === 0) {
      return {
        result: null,
        originals: [],
        success: false,
        error: 'No features provided',
      };
    }

    if (features.length === 1) {
      const cloned = turf.clone(features[0]);
      cloned.id = generateFeatureId();
      if (options?.properties) {
        cloned.properties = { ...cloned.properties, ...options.properties };
      }
      return {
        result: cloned,
        originals: features,
        success: true,
      };
    }

    try {
      const collection = turf.featureCollection(features);
      const result = turf.union(collection) as Feature<
        Polygon | MultiPolygon
      > | null;

      if (result) {
        result.id = generateFeatureId();
        if (options?.properties) {
          result.properties = { ...result.properties, ...options.properties };
        }
      }

      return {
        result,
        originals: features,
        success: result !== null,
        error: result === null ? 'Union operation returned null' : undefined,
      };
    } catch (error) {
      return {
        result: null,
        originals: features,
        success: false,
        error: `Union operation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  /**
   * Check if polygons can be merged
   */
  canMerge(features: Feature<Polygon | MultiPolygon>[]): {
    canMerge: boolean;
    reason?: string;
  } {
    if (features.length < 2) {
      return {
        canMerge: false,
        reason: 'Need at least 2 polygons to merge',
      };
    }

    // Check for valid polygons
    for (const feature of features) {
      if (
        feature.geometry.type !== 'Polygon' &&
        feature.geometry.type !== 'MultiPolygon'
      ) {
        return {
          canMerge: false,
          reason: 'All features must be polygons',
        };
      }
    }

    return { canMerge: true };
  }

  /**
   * Check if any polygons overlap
   */
  hasOverlap(features: Feature<Polygon | MultiPolygon>[]): boolean {
    for (let i = 0; i < features.length; i++) {
      for (let j = i + 1; j < features.length; j++) {
        try {
          if (
            turf.booleanOverlap(features[i], features[j]) ||
            turf.booleanIntersects(features[i], features[j])
          ) {
            return true;
          }
        } catch {
          // Continue checking
        }
      }
    }
    return false;
  }

  /**
   * Get the combined area of all polygons
   */
  getCombinedArea(features: Feature<Polygon | MultiPolygon>[]): number {
    return features.reduce((total, feature) => {
      try {
        return total + turf.area(feature);
      } catch {
        return total;
      }
    }, 0);
  }

  /**
   * Get the area of the union result
   */
  getUnionArea(features: Feature<Polygon | MultiPolygon>[]): number | null {
    const result = this.union(features);
    if (result.success && result.result) {
      try {
        return turf.area(result.result);
      } catch {
        return null;
      }
    }
    return null;
  }
}
