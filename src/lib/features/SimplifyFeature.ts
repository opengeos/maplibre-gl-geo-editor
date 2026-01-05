import type { Feature } from 'geojson';
import * as turf from '@turf/turf';
import type { SimplifyOptions, SimplifyResult } from '../core/types';
import { SIMPLIFY_DEFAULTS } from '../core/constants';
import { getVertexCount } from '../utils/geometryUtils';

/**
 * Handles line/polygon simplification using Douglas-Peucker algorithm
 */
export class SimplifyFeature {
  private defaultOptions: Required<SimplifyOptions>;

  constructor(options?: Partial<SimplifyOptions>) {
    this.defaultOptions = {
      tolerance: options?.tolerance ?? SIMPLIFY_DEFAULTS.tolerance,
      highQuality: options?.highQuality ?? SIMPLIFY_DEFAULTS.highQuality,
      mutate: options?.mutate ?? SIMPLIFY_DEFAULTS.mutate,
    };
  }

  /**
   * Simplify a geometry using Douglas-Peucker algorithm
   */
  simplify<T extends Feature>(
    feature: T,
    options?: Partial<SimplifyOptions>
  ): T {
    const opts = {
      ...this.defaultOptions,
      ...options,
    };

    return turf.simplify(feature, opts) as T;
  }

  /**
   * Simplify and return detailed result with statistics
   */
  simplifyWithStats(
    feature: Feature,
    options?: Partial<SimplifyOptions>
  ): SimplifyResult {
    const opts = {
      ...this.defaultOptions,
      ...options,
    };

    const verticesBefore = getVertexCount(feature);
    const result = turf.simplify(feature, opts);
    const verticesAfter = getVertexCount(result);

    const reductionPercent =
      verticesBefore > 0
        ? ((verticesBefore - verticesAfter) / verticesBefore) * 100
        : 0;

    return {
      result,
      original: feature,
      verticesBefore,
      verticesAfter,
      reductionPercent,
    };
  }

  /**
   * Get simplification statistics without applying
   */
  getSimplificationStats(
    feature: Feature,
    tolerance: number
  ): {
    before: number;
    after: number;
    reduction: number;
  } {
    const before = getVertexCount(feature);
    const simplified = this.simplify(feature, { tolerance });
    const after = getVertexCount(simplified);

    return {
      before,
      after,
      reduction: before > 0 ? ((before - after) / before) * 100 : 0,
    };
  }

  /**
   * Preview simplification at different tolerance levels
   */
  previewTolerances(
    feature: Feature,
    tolerances: number[]
  ): Map<number, SimplifyResult> {
    const results = new Map<number, SimplifyResult>();

    for (const tolerance of tolerances) {
      results.set(tolerance, this.simplifyWithStats(feature, { tolerance }));
    }

    return results;
  }

  /**
   * Get suggested tolerance values based on feature complexity
   */
  getSuggestedTolerances(feature: Feature): number[] {
    const vertexCount = getVertexCount(feature);

    // Base tolerances
    const baseTolerances = [0.0001, 0.0005, 0.001, 0.005, 0.01];

    // Adjust based on complexity
    if (vertexCount > 1000) {
      return [0.001, 0.005, 0.01, 0.05, 0.1];
    } else if (vertexCount > 100) {
      return [0.0005, 0.001, 0.005, 0.01, 0.05];
    }

    return baseTolerances;
  }

  /**
   * Find optimal tolerance for a target vertex reduction
   */
  findOptimalTolerance(
    feature: Feature,
    targetReduction: number
  ): { tolerance: number; result: SimplifyResult } {
    const tolerances = [
      0.00001, 0.00005, 0.0001, 0.0005, 0.001, 0.005, 0.01, 0.05, 0.1,
    ];

    let bestTolerance = tolerances[0];
    let bestResult = this.simplifyWithStats(feature, {
      tolerance: bestTolerance,
    });
    let bestDiff = Math.abs(bestResult.reductionPercent - targetReduction);

    for (const tolerance of tolerances.slice(1)) {
      const result = this.simplifyWithStats(feature, { tolerance });
      const diff = Math.abs(result.reductionPercent - targetReduction);

      if (diff < bestDiff) {
        bestDiff = diff;
        bestTolerance = tolerance;
        bestResult = result;
      }
    }

    return { tolerance: bestTolerance, result: bestResult };
  }

  /**
   * Set default tolerance
   */
  setDefaultTolerance(tolerance: number): void {
    this.defaultOptions.tolerance = tolerance;
  }

  /**
   * Get default tolerance
   */
  getDefaultTolerance(): number {
    return this.defaultOptions.tolerance;
  }
}
