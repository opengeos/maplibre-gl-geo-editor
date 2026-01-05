import type { Feature, Polygon, MultiPolygon } from 'geojson';
import * as turf from '@turf/turf';
import type { DifferenceOptions, DifferenceResult } from '../core/types';
import { generateFeatureId } from '../utils/geometryUtils';

/**
 * Handles polygon difference/subtraction operations
 */
export class DifferenceFeature {
  /**
   * Subtract one or more polygons from a base polygon
   */
  difference(
    base: Feature<Polygon | MultiPolygon>,
    subtract: Feature<Polygon | MultiPolygon>[],
    options?: DifferenceOptions
  ): DifferenceResult {
    if (subtract.length === 0) {
      const cloned = turf.clone(base);
      cloned.id = generateFeatureId();
      return {
        result: cloned,
        base,
        subtracted: [],
        success: true,
      };
    }

    try {
      let result: Feature<Polygon | MultiPolygon> | null = turf.clone(base);

      for (const poly of subtract) {
        if (!result) break;

        const collection = turf.featureCollection([result, poly]);
        result = turf.difference(collection) as Feature<
          Polygon | MultiPolygon
        > | null;
      }

      if (result) {
        result.id = generateFeatureId();
        if (options?.properties) {
          result.properties = { ...result.properties, ...options.properties };
        }
      }

      return {
        result,
        base,
        subtracted: subtract,
        success: true,
      };
    } catch (error) {
      return {
        result: null,
        base,
        subtracted: subtract,
        success: false,
        error: `Difference operation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  /**
   * Check if subtraction can be performed
   */
  canSubtract(
    base: Feature<Polygon | MultiPolygon>,
    subtract: Feature<Polygon | MultiPolygon>
  ): {
    canSubtract: boolean;
    overlap: boolean;
    reason?: string;
  } {
    // Check types
    if (
      base.geometry.type !== 'Polygon' &&
      base.geometry.type !== 'MultiPolygon'
    ) {
      return {
        canSubtract: false,
        overlap: false,
        reason: 'Base must be a polygon',
      };
    }

    if (
      subtract.geometry.type !== 'Polygon' &&
      subtract.geometry.type !== 'MultiPolygon'
    ) {
      return {
        canSubtract: false,
        overlap: false,
        reason: 'Subtract feature must be a polygon',
      };
    }

    // Check for overlap
    try {
      const hasOverlap =
        turf.booleanOverlap(base, subtract) ||
        turf.booleanContains(base, subtract) ||
        turf.booleanIntersects(base, subtract);

      if (!hasOverlap) {
        return {
          canSubtract: false,
          overlap: false,
          reason: 'Polygons do not overlap',
        };
      }

      return {
        canSubtract: true,
        overlap: true,
      };
    } catch {
      return {
        canSubtract: false,
        overlap: false,
        reason: 'Could not determine overlap',
      };
    }
  }

  /**
   * Get the area that would be removed
   */
  getSubtractedArea(
    base: Feature<Polygon | MultiPolygon>,
    subtract: Feature<Polygon | MultiPolygon>
  ): number | null {
    try {
      // Get intersection area
      const collection = turf.featureCollection([base, subtract]);
      const intersection = turf.intersect(collection);

      if (intersection) {
        return turf.area(intersection);
      }
      return 0;
    } catch {
      return null;
    }
  }

  /**
   * Preview the result without applying
   */
  preview(
    base: Feature<Polygon | MultiPolygon>,
    subtract: Feature<Polygon | MultiPolygon>[]
  ): Feature<Polygon | MultiPolygon> | null {
    const result = this.difference(base, subtract);
    return result.result;
  }

  /**
   * Create a hole in a polygon at a specific location
   */
  createHole(
    polygon: Feature<Polygon>,
    hole: Feature<Polygon>
  ): Feature<Polygon | MultiPolygon> | null {
    // Check if hole is completely inside polygon
    try {
      if (!turf.booleanContains(polygon, hole)) {
        console.warn('Hole must be completely inside the polygon');
        return null;
      }

      const result = this.difference(polygon, [hole]);
      return result.result;
    } catch {
      return null;
    }
  }
}
