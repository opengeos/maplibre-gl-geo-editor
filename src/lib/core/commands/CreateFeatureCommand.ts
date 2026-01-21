import type { Feature } from 'geojson';
import * as turf from '@turf/turf';
import type { Command, HistoryOperationType, GeomanFeatureData } from '../types';
import type { CommandContext } from './types';

/**
 * Command for creating a feature.
 * Undo: deletes the feature from Geoman.
 * Execute/Redo: re-imports the feature to Geoman.
 */
export class CreateFeatureCommand implements Command {
  readonly description: string;
  readonly type: HistoryOperationType = 'create';

  private feature: Feature;
  private featureId: string | null = null;
  private context: CommandContext;

  /**
   * Create a new CreateFeatureCommand.
   * @param feature - The feature that was created
   * @param context - The command context with Geoman API access
   */
  constructor(feature: Feature, context: CommandContext) {
    // Deep clone the feature to preserve its state
    this.feature = turf.clone(feature);
    this.context = context;
    this.featureId = this.extractFeatureId(feature);

    const geomType = feature.geometry?.type || 'feature';
    this.description = `Create ${geomType}`;
  }

  /**
   * Execute/redo the create operation by re-importing the feature.
   */
  execute(): void {
    const imported = this.context.featuresApi.importGeoJsonFeature(this.feature);
    if (imported) {
      this.featureId = String(imported.id);
      this.context.onFeatureCreate?.(this.feature);
    }
  }

  /**
   * Undo the create operation by deleting the feature.
   */
  undo(): void {
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
