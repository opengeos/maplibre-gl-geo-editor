import type { Feature, Polygon, LineString, Position } from 'geojson';
import type { GeoJSONSource } from 'maplibre-gl';
import type { Map as MapLibreMap, MapMouseEvent } from 'maplibre-gl';
import * as turf from '@turf/turf';
import { INTERNAL_IDS } from '../core/constants';

export interface FreehandOptions {
  /** Draw as polygon (closed) or line (open). Default: 'polygon' */
  type?: 'polygon' | 'line';
  /** Simplify tolerance in degrees. Default: 0.00001 */
  simplifyTolerance?: number;
  /** Minimum number of points required. Default: 3 for polygon, 2 for line */
  minPoints?: number;
}

export interface FreehandResult {
  /** The resulting feature (polygon or line) */
  feature: Feature<Polygon | LineString> | null;
  /** Whether drawing was successful */
  success: boolean;
  /** Error message if failed */
  error?: string;
}

/**
 * Handles freehand drawing of polygons and lines
 */
export class FreehandFeature {
  private map: MapLibreMap | null = null;
  private isDrawing: boolean = false;
  private points: Position[] = [];
  private options: Required<FreehandOptions>;
  private onCompleteCallback: ((result: FreehandResult) => void) | null = null;
  private dragPanEnabled: boolean | null = null;
  private boxZoomEnabled: boolean | null = null;
  private doubleClickZoomEnabled: boolean | null = null;

  // Bound event handlers
  private handleMouseDown: ((e: MapMouseEvent) => void) | null = null;
  private handleMouseMove: ((e: MapMouseEvent) => void) | null = null;
  private handleMouseUp: ((e: MapMouseEvent) => void) | null = null;

  constructor(options: FreehandOptions = {}) {
    this.options = {
      type: options.type ?? 'polygon',
      simplifyTolerance: options.simplifyTolerance ?? 0.00001,
      minPoints: options.minPoints ?? (options.type === 'line' ? 2 : 3),
    };
  }

  /**
   * Initialize with map instance
   */
  init(map: MapLibreMap): void {
    this.map = map;
  }

  /**
   * Enable freehand drawing mode
   */
  enable(onComplete?: (result: FreehandResult) => void): void {
    if (!this.map) return;

    this.onCompleteCallback = onComplete || null;
    this.disableMapInteractions();
    this.setupFreehandLayers();
    this.attachEventListeners();

    // Change cursor
    this.map.getCanvas().style.cursor = 'crosshair';
  }

  /**
   * Disable freehand drawing mode
   */
  disable(): void {
    this.removeEventListeners();
    this.clearFreehand();
    this.isDrawing = false;
    this.points = [];
    this.onCompleteCallback = null;
    this.restoreMapInteractions();

    if (this.map) {
      this.map.getCanvas().style.cursor = '';
    }
  }

  /**
   * Set drawing type (polygon or line)
   */
  setType(type: 'polygon' | 'line'): void {
    this.options.type = type;
    this.options.minPoints = type === 'line' ? 2 : 3;
  }

  /**
   * Check if freehand is currently active
   */
  isActive(): boolean {
    return this.isDrawing;
  }

  /**
   * Build feature from drawn points
   */
  buildFeature(): Feature<Polygon | LineString> | null {
    if (this.points.length < this.options.minPoints) return null;

    try {
      // Simplify the points to reduce complexity
      let coords = this.points;

      if (coords.length > 10) {
        // Create a temporary line to simplify
        const tempLine = turf.lineString(coords);
        const simplified = turf.simplify(tempLine, {
          tolerance: this.options.simplifyTolerance,
          highQuality: true,
        });
        coords = simplified.geometry.coordinates as Position[];
      }

      if (this.options.type === 'polygon') {
        // Ensure we have enough points for a polygon
        if (coords.length < 3) return null;

        // Close the polygon
        const closedCoords = [...coords, coords[0]];
        return turf.polygon([closedCoords]);
      } else {
        // Line
        if (coords.length < 2) return null;
        return turf.lineString(coords);
      }
    } catch (error) {
      console.warn('FreehandFeature: Error building feature:', error);
      return null;
    }
  }

  /**
   * Setup map layers for freehand visualization
   */
  private setupFreehandLayers(): void {
    if (!this.map) return;

    // Add source
    if (!this.map.getSource(INTERNAL_IDS.FREEHAND_SOURCE)) {
      this.map.addSource(INTERNAL_IDS.FREEHAND_SOURCE, {
        type: 'geojson',
        data: turf.featureCollection([]),
      });
    }

    // Add fill layer (for polygon preview)
    if (!this.map.getLayer(INTERNAL_IDS.FREEHAND_FILL_LAYER)) {
      this.map.addLayer({
        id: INTERNAL_IDS.FREEHAND_FILL_LAYER,
        type: 'fill',
        source: INTERNAL_IDS.FREEHAND_SOURCE,
        filter: ['==', ['geometry-type'], 'Polygon'],
        paint: {
          'fill-color': '#3388ff',
          'fill-opacity': 0.2,
        },
      });
    }

    // Add line layer
    if (!this.map.getLayer(INTERNAL_IDS.FREEHAND_LINE_LAYER)) {
      this.map.addLayer({
        id: INTERNAL_IDS.FREEHAND_LINE_LAYER,
        type: 'line',
        source: INTERNAL_IDS.FREEHAND_SOURCE,
        paint: {
          'line-color': '#3388ff',
          'line-width': 3,
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
      this.updateFreehandVisualization();
    };

    this.handleMouseMove = (e: MapMouseEvent) => {
      if (!this.isDrawing) return;

      e.preventDefault();
      this.points.push([e.lngLat.lng, e.lngLat.lat]);
      this.updateFreehandVisualization();
    };

    this.handleMouseUp = () => {
      if (!this.isDrawing) return;

      this.isDrawing = false;
      this.completeFreehand();
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
   * Update the freehand visualization on the map
   */
  private updateFreehandVisualization(): void {
    if (!this.map || this.points.length < 2) return;

    const source = this.map.getSource(INTERNAL_IDS.FREEHAND_SOURCE) as GeoJSONSource | undefined;
    if (!source) return;

    const coords = [...this.points];

    if (this.options.type === 'polygon' && coords.length >= 3) {
      // Show as polygon
      const closedCoords = [...coords, coords[0]];
      const polygon = turf.polygon([closedCoords]);
      source.setData(turf.featureCollection([polygon]));
    } else {
      // Show as line
      const line = turf.lineString(coords);
      source.setData(turf.featureCollection([line]));
    }
  }

  /**
   * Complete the freehand drawing
   */
  private completeFreehand(): void {
    const feature = this.buildFeature();

    const result: FreehandResult = {
      feature,
      success: feature !== null,
      error: feature ? undefined : `Need at least ${this.options.minPoints} points`,
    };

    if (this.onCompleteCallback) {
      this.onCompleteCallback(result);
    }

    // Clear the visualization after a short delay
    setTimeout(() => {
      this.clearFreehand();
      this.points = [];
    }, 100);
  }

  /**
   * Clear the freehand visualization
   */
  private clearFreehand(): void {
    if (!this.map) return;

    const source = this.map.getSource(INTERNAL_IDS.FREEHAND_SOURCE) as GeoJSONSource | undefined;
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
   * Remove freehand layers from the map
   */
  removeLayers(): void {
    if (!this.map) return;

    if (this.map.getLayer(INTERNAL_IDS.FREEHAND_LINE_LAYER)) {
      this.map.removeLayer(INTERNAL_IDS.FREEHAND_LINE_LAYER);
    }
    if (this.map.getLayer(INTERNAL_IDS.FREEHAND_FILL_LAYER)) {
      this.map.removeLayer(INTERNAL_IDS.FREEHAND_FILL_LAYER);
    }
    if (this.map.getSource(INTERNAL_IDS.FREEHAND_SOURCE)) {
      this.map.removeSource(INTERNAL_IDS.FREEHAND_SOURCE);
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
