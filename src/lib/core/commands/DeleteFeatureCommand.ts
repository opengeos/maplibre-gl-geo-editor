import type { Feature } from 'geojson';
import * as turf from '@turf/turf';
import type { Command, HistoryOperationType, GeomanFeatureData } from '../types';
import type { CommandContext } from './types';

/**
 * Command for deleting a feature.
 * Undo: re-imports the feature to Geoman.
 * Execute/Redo: deletes the feature from Geoman.
 */
export class DeleteFeatureCommand implements Command {
  readonly description: string;
  readonly type: HistoryOperationType = 'delete';

  private feature: Feature;
  private featureId: string | null;
  private context: CommandContext;

  /**
   * Create a new DeleteFeatureCommand.
   * @param feature - The feature that was deleted
   * @param context - The command context with Geoman API access
   */
  constructor(feature: Feature, context: CommandContext) {
    // Deep clone the feature to preserve its state
    this.feature = turf.clone(feature);
    this.context = context;
    this.featureId = this.extractFeatureId(feature);

    const geomType = feature.geometry?.type || 'feature';
    this.description = `Delete ${geomType}`;
  }

  /**
   * Execute/redo the delete operation by removing the feature.
   */
  execute(): void {
    if (!this.featureId) {
      return;
    }

    // Find and delete the feature
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

      if (toDelete.length > 0 && this.featureId) {
        this.context.onFeatureDelete?.(this.featureId);
      }
    } catch {
      // Ignore forEach errors
    }
  }

  /**
   * Undo the delete operation by re-importing the feature.
   */
  undo(): void {
    const imported = this.context.featuresApi.importGeoJsonFeature(this.feature);
    if (imported) {
      this.featureId = String(imported.id);
      this.context.onFeatureCreate?.(this.feature);
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
