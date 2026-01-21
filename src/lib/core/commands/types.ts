import type { Feature } from 'geojson';
import type { GeomanFeaturesAPI } from '../types';

/**
 * Context needed for command execution.
 * Provides access to Geoman features API for manipulating features.
 */
export interface CommandContext {
  /** The Geoman features API for adding/removing features */
  featuresApi: GeomanFeaturesAPI;
  /** Callback when a feature is created (for triggering onFeatureCreate) */
  onFeatureCreate?: (feature: Feature) => void;
  /** Callback when a feature is deleted (for triggering onFeatureDelete) */
  onFeatureDelete?: (featureId: string) => void;
  /** Callback when a feature is edited (for triggering onFeatureEdit) */
  onFeatureEdit?: (feature: Feature, oldFeature: Feature) => void;
}
