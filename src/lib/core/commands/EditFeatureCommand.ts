import type { Feature } from 'geojson';
import * as turf from '@turf/turf';
import type { Command, HistoryOperationType, GeomanFeatureData } from '../types';
import type { CommandContext } from './types';

/**
 * Command for editing a feature.
 * Stores both old and new feature states.
 * Undo: updates geometry to old state.
 * Execute/Redo: updates geometry to new state.
 */
export class EditFeatureCommand implements Command {
  readonly description: string;
  readonly type: HistoryOperationType = 'edit';

  private oldFeature: Feature;
  private newFeature: Feature;
  private featureId: string | null;
  private context: CommandContext;

  /**
   * Create a new EditFeatureCommand.
   * @param oldFeature - The feature state before editing
   * @param newFeature - The feature state after editing
   * @param context - The command context with Geoman API access
   */
  constructor(oldFeature: Feature, newFeature: Feature, context: CommandContext) {
    // Deep clone both features to preserve their states
    this.oldFeature = turf.clone(oldFeature);
    this.newFeature = turf.clone(newFeature);
    this.context = context;
    this.featureId = this.extractFeatureId(newFeature) || this.extractFeatureId(oldFeature);

    const geomType = newFeature.geometry?.type || 'feature';
    this.description = `Edit ${geomType}`;
  }

  /**
   * Execute/redo the edit operation by updating to the new geometry.
   */
  execute(): void {
    this.updateFeatureGeometry(this.newFeature);
  }

  /**
   * Undo the edit operation by reverting to the old geometry.
   */
  undo(): void {
    this.updateFeatureGeometry(this.oldFeature);
  }

  /**
   * Update the feature geometry in Geoman.
   */
  private updateFeatureGeometry(targetFeature: Feature): void {
    if (!this.featureId) {
      return;
    }

    try {
      this.context.featuresApi.forEach((fd) => {
        const fdId = String(fd.id);
        const geoJson = this.getGeomanFeature(fd);
        const geoJsonId = geoJson ? this.extractFeatureId(geoJson) : null;

        if (fdId === this.featureId || geoJsonId === this.featureId) {
          // Update the geometry
          if (fd.updateGeometry) {
            fd.updateGeometry(targetFeature.geometry);
          } else if (fd.updateGeoJsonGeometry) {
            fd.updateGeoJsonGeometry(targetFeature.geometry);
          }
        }
      });
    } catch {
      // If forEach fails, try delete and reimport
      this.deleteAndReimport(targetFeature);
    }
  }

  /**
   * Fallback: delete the old feature and reimport the target feature.
   */
  private deleteAndReimport(targetFeature: Feature): void {
    if (!this.featureId) {
      return;
    }

    // First delete the existing feature
    const toDelete: GeomanFeatureData[] = [];
    try {
      this.context.featuresApi.forEach((fd) => {
        const fdId = String(fd.id);
        const geoJson = this.getGeomanFeature(fd);
        const geoJsonId = geoJson ? this.extractFeatureId(geoJson) : null;

        if (fdId === this.featureId || geoJsonId === this.featureId) {
          toDelete.push(fd);
        }
      });

      toDelete.forEach((fd) => {
        try {
          this.context.featuresApi.delete(fd);
        } catch {
          try {
            fd.delete();
          } catch {
            // Ignore delete errors
          }
        }
      });
    } catch {
      // Ignore forEach errors
    }

    // Then reimport the target feature
    const imported = this.context.featuresApi.importGeoJsonFeature(targetFeature);
    if (imported) {
      this.featureId = String(imported.id);
    }
  }

  private extractFeatureId(feature: Feature): string | null {
    const props = feature.properties as { __gm_id?: string | number; id?: string | number } | undefined;
    const raw = feature.id ?? props?.__gm_id ?? props?.id;
    return raw !== undefined && raw !== null ? String(raw) : null;
  }

  private getGeomanFeature(geomanData?: GeomanFeatureData | null): Feature | null {
    if (!geomanData) return null;

    if (typeof geomanData.getGeoJson === 'function') {
      try {
        return geomanData.getGeoJson();
      } catch {
        return null;
      }
    }

    return geomanData.geoJson ?? null;
  }
}
