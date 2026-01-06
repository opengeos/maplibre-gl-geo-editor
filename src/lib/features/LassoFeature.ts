import type { Feature, Polygon, Position } from 'geojson';
import type { GeoJSONSource } from 'maplibre-gl';
import type { Map as MapLibreMap, MapMouseEvent } from 'maplibre-gl';
import * as turf from '@turf/turf';
import type { LassoOptions, LassoResult } from '../core/types';
import { INTERNAL_IDS } from '../core/constants';

/**
 * Handles lasso selection of features
 */
export class LassoFeature {
  private map: MapLibreMap | null = null;
  private isDrawing: boolean = false;
  private points: Position[] = [];
  private options: Required<LassoOptions>;
  private onCompleteCallback:
    | ((result: LassoResult) => void)
    | null = null;
  private dragPanEnabled: boolean | null = null;
  private boxZoomEnabled: boolean | null = null;
  private doubleClickZoomEnabled: boolean | null = null;

  // Bound event handlers
  private handleMouseDown: ((e: MapMouseEvent) => void) | null = null;
  private handleMouseMove: ((e: MapMouseEvent) => void) | null = null;
  private handleMouseUp: ((e: MapMouseEvent) => void) | null = null;

  constructor(options: LassoOptions = {}) {
    this.options = {
      mode: options.mode ?? 'intersects',
    };
  }

  /**
   * Initialize with map instance
   */
  init(map: MapLibreMap): void {
    this.map = map;
  }

  /**
   * Enable lasso selection mode
   */
  enable(onComplete?: (result: LassoResult) => void): void {
    if (!this.map) return;

    this.onCompleteCallback = onComplete || null;
    this.disableMapInteractions();
    this.setupLassoLayers();
    this.attachEventListeners();

    // Change cursor
    this.map.getCanvas().style.cursor = 'crosshair';
  }

  /**
   * Disable lasso selection mode
   */
  disable(): void {
    this.removeEventListeners();
    this.clearLasso();
    this.isDrawing = false;
    this.points = [];
    this.onCompleteCallback = null;
    this.restoreMapInteractions();

    if (this.map) {
      this.map.getCanvas().style.cursor = '';
    }
  }

  /**
   * Get features within the lasso polygon
   */
  selectWithinLasso(
    lassoPolygon: Feature<Polygon>,
    features: Feature[]
  ): Feature[] {
    return features.filter((feature) => {
      try {
        if (this.options.mode === 'contains') {
          return turf.booleanWithin(feature, lassoPolygon);
        } else {
          return turf.booleanIntersects(feature, lassoPolygon);
        }
      } catch {
        return false;
      }
    });
  }

  /**
   * Build polygon from drawn points
   */
  buildLassoPolygon(): Feature<Polygon> | null {
    if (this.points.length < 3) return null;

    // Close the polygon
    const coords = [...this.points, this.points[0]];

    try {
      return turf.polygon([coords]);
    } catch {
      return null;
    }
  }

  /**
   * Set selection mode
   */
  setMode(mode: 'contains' | 'intersects'): void {
    this.options.mode = mode;
  }

  /**
   * Check if lasso is currently active
   */
  isActive(): boolean {
    return this.isDrawing;
  }

  /**
   * Setup map layers for lasso visualization
   */
  private setupLassoLayers(): void {
    if (!this.map) return;

    // Add source
    if (!this.map.getSource(INTERNAL_IDS.LASSO_SOURCE)) {
      this.map.addSource(INTERNAL_IDS.LASSO_SOURCE, {
        type: 'geojson',
        data: turf.featureCollection([]),
      });
    }

    // Add fill layer
    if (!this.map.getLayer(INTERNAL_IDS.LASSO_LAYER)) {
      this.map.addLayer({
        id: INTERNAL_IDS.LASSO_LAYER,
        type: 'fill',
        source: INTERNAL_IDS.LASSO_SOURCE,
        paint: {
          'fill-color': '#3388ff',
          'fill-opacity': 0.2,
        },
      });
    }

    // Add line layer
    if (!this.map.getLayer(INTERNAL_IDS.LASSO_LINE_LAYER)) {
      this.map.addLayer({
        id: INTERNAL_IDS.LASSO_LINE_LAYER,
        type: 'line',
        source: INTERNAL_IDS.LASSO_SOURCE,
        paint: {
          'line-color': '#3388ff',
          'line-width': 2,
          'line-dasharray': [2, 2],
        },
      });
    }
  }

  /**
   * Attach mouse event listeners
   */
  private attachEventListeners(): void {
    if (!this.map) return;

    this.handleMouseDown = (e: MapMouseEvent) => {
      e.preventDefault();
      this.isDrawing = true;
      this.points = [[e.lngLat.lng, e.lngLat.lat]];
      this.updateLassoVisualization();
    };

    this.handleMouseMove = (e: MapMouseEvent) => {
      if (!this.isDrawing) return;

      e.preventDefault();
      this.points.push([e.lngLat.lng, e.lngLat.lat]);
      this.updateLassoVisualization();
    };

    this.handleMouseUp = () => {
      if (!this.isDrawing) return;

      this.isDrawing = false;
      this.completeLasso();
    };

    this.map.on('mousedown', this.handleMouseDown);
    this.map.on('mousemove', this.handleMouseMove);
    this.map.on('mouseup', this.handleMouseUp);
  }

  /**
   * Remove event listeners
   */
  private removeEventListeners(): void {
    if (!this.map) return;

    if (this.handleMouseDown) {
      this.map.off('mousedown', this.handleMouseDown);
    }
    if (this.handleMouseMove) {
      this.map.off('mousemove', this.handleMouseMove);
    }
    if (this.handleMouseUp) {
      this.map.off('mouseup', this.handleMouseUp);
    }

    this.handleMouseDown = null;
    this.handleMouseMove = null;
    this.handleMouseUp = null;
  }

  /**
   * Update the lasso visualization on the map
   */
  private updateLassoVisualization(): void {
    if (!this.map || this.points.length < 2) return;

    const source = this.map.getSource(INTERNAL_IDS.LASSO_SOURCE) as GeoJSONSource | undefined;
    if (!source) return;

    // Create a temporary polygon for visualization
    const coords = [...this.points];
    if (coords.length >= 3) {
      // Close the polygon
      coords.push(coords[0]);
      const polygon = turf.polygon([coords]);
      source.setData(turf.featureCollection([polygon]));
    } else {
      // Just show a line
      const line = turf.lineString(coords);
      source.setData(turf.featureCollection([line]));
    }
  }

  /**
   * Complete the lasso selection
   */
  private completeLasso(): void {
    const polygon = this.buildLassoPolygon();

    if (polygon && this.onCompleteCallback) {
      // Get all features from the map (this would need to be provided externally)
      // For now, return empty selection - actual feature selection happens in GeoEditor
      const result: LassoResult = {
        selected: [],
        lasso: polygon,
      };
      this.onCompleteCallback(result);
    }

    // Clear the lasso visualization after a short delay
    setTimeout(() => {
      this.clearLasso();
      this.points = [];
    }, 100);
  }

  /**
   * Clear the lasso visualization
   */
  private clearLasso(): void {
    if (!this.map) return;

    const source = this.map.getSource(INTERNAL_IDS.LASSO_SOURCE) as GeoJSONSource | undefined;
    if (source) {
      source.setData(turf.featureCollection([]));
    }
  }

  private disableMapInteractions(): void {
    if (!this.map) return;

    this.dragPanEnabled = this.map.dragPan.isEnabled();
    if (this.dragPanEnabled) {
      this.map.dragPan.disable();
    }

    if (this.map.boxZoom) {
      this.boxZoomEnabled = this.map.boxZoom.isEnabled();
      if (this.boxZoomEnabled) {
        this.map.boxZoom.disable();
      }
    }

    if (this.map.doubleClickZoom) {
      this.doubleClickZoomEnabled = this.map.doubleClickZoom.isEnabled();
      if (this.doubleClickZoomEnabled) {
        this.map.doubleClickZoom.disable();
      }
    }
  }

  private restoreMapInteractions(): void {
    if (!this.map) return;

    if (this.dragPanEnabled) {
      this.map.dragPan.enable();
    }
    if (this.boxZoomEnabled && this.map.boxZoom) {
      this.map.boxZoom.enable();
    }
    if (this.doubleClickZoomEnabled && this.map.doubleClickZoom) {
      this.map.doubleClickZoom.enable();
    }

    this.dragPanEnabled = null;
    this.boxZoomEnabled = null;
    this.doubleClickZoomEnabled = null;
  }

  /**
   * Remove lasso layers from the map
   */
  removeLayers(): void {
    if (!this.map) return;

    if (this.map.getLayer(INTERNAL_IDS.LASSO_LINE_LAYER)) {
      this.map.removeLayer(INTERNAL_IDS.LASSO_LINE_LAYER);
    }
    if (this.map.getLayer(INTERNAL_IDS.LASSO_LAYER)) {
      this.map.removeLayer(INTERNAL_IDS.LASSO_LAYER);
    }
    if (this.map.getSource(INTERNAL_IDS.LASSO_SOURCE)) {
      this.map.removeSource(INTERNAL_IDS.LASSO_SOURCE);
    }
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    this.disable();
    this.removeLayers();
    this.map = null;
  }
}
