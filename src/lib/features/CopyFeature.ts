import type { Feature } from 'geojson';
import * as turf from '@turf/turf';
import type { CopyOptions } from '../core/types';
import { COPY_DEFAULTS } from '../core/constants';
import { generateFeatureId } from '../utils/geometryUtils';

/**
 * Handles copy/paste operations for features
 */
export class CopyFeature {
  private options: Required<CopyOptions>;

  constructor(options: CopyOptions = {}) {
    this.options = {
      offset: options.offset ?? COPY_DEFAULTS.offset,
      generateNewIds: options.generateNewIds ?? COPY_DEFAULTS.generateNewIds,
    };
  }

  /**
   * Copy a single feature with optional offset
   */
  copy(feature: Feature, offset?: [number, number]): Feature {
    const cloned = turf.clone(feature);
    const actualOffset = offset ?? this.options.offset;

    // Generate new ID if required
    if (this.options.generateNewIds) {
      cloned.id = generateFeatureId();
      if (cloned.properties) {
        cloned.properties = { ...cloned.properties, id: cloned.id };
      }
    }

    // Apply offset if provided
    if (actualOffset[0] !== 0 || actualOffset[1] !== 0) {
      // Calculate distance and bearing from offset
      const distance =
        Math.sqrt(actualOffset[0] ** 2 + actualOffset[1] ** 2) * 111; // Approximate km per degree
      const bearing =
        (Math.atan2(actualOffset[0], actualOffset[1]) * 180) / Math.PI;

      return turf.transformTranslate(cloned, distance, bearing, {
        units: 'kilometers',
      });
    }

    return cloned;
  }

  /**
   * Copy multiple features maintaining relative positions
   */
  copyMultiple(features: Feature[], offset?: [number, number]): Feature[] {
    return features.map((f) => this.copy(f, offset));
  }

  /**
   * Copy features to a specific location (centered on the location)
   */
  copyToLocation(features: Feature[], targetCenter: [number, number]): Feature[] {
    if (features.length === 0) return [];

    // Calculate current center of all features
    const collection = turf.featureCollection(features);
    const currentCenter = turf.centroid(collection);
    const currentCoords = currentCenter.geometry.coordinates;

    // Calculate offset needed
    const offsetLng = targetCenter[0] - currentCoords[0];
    const offsetLat = targetCenter[1] - currentCoords[1];

    return features.map((feature) => {
      const cloned = turf.clone(feature);

      if (this.options.generateNewIds) {
        cloned.id = generateFeatureId();
        if (cloned.properties) {
          cloned.properties = { ...cloned.properties, id: cloned.id };
        }
      }

      // Translate to new location
      const distance = Math.sqrt(offsetLng ** 2 + offsetLat ** 2) * 111;
      const bearing = (Math.atan2(offsetLng, offsetLat) * 180) / Math.PI;

      return turf.transformTranslate(cloned, distance, bearing, {
        units: 'kilometers',
      });
    });
  }

  /**
   * Update the default offset
   */
  setOffset(offset: [number, number]): void {
    this.options.offset = offset;
  }

  /**
   * Get the current offset
   */
  getOffset(): [number, number] {
    return this.options.offset;
  }
}
