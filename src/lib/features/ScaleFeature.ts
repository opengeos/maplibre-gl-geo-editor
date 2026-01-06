import type { Feature, Position } from 'geojson';
import type { Map as MapLibreMap, GeoJSONSource } from 'maplibre-gl';
import * as turf from '@turf/turf';
import type { ScaleOptions, ScaleHandle, ScaleHandlePosition } from '../core/types';
import { SCALE_HANDLE_DEFAULTS, INTERNAL_IDS } from '../core/constants';
import { generateFeatureId, clamp } from '../utils/geometryUtils';

/**
 * Handles interactive scaling of features
 */
export class ScaleFeature {
  private map: MapLibreMap | null = null;
  private options: Required<ScaleOptions>;
  private activeFeature: Feature | null = null;
  private originalFeature: Feature | null = null;
  private handles: ScaleHandle[] = [];
  private activeHandle: ScaleHandlePosition | null = null;
  private startPoint: Position | null = null;
  private onScaleCallback: ((feature: Feature, factor: number) => void) | null =
    null;

  constructor(options: ScaleOptions = {}) {
    this.options = {
      maintainAspectRatio: options.maintainAspectRatio ?? true,
      scaleFromCenter: options.scaleFromCenter ?? true,
      minScale: options.minScale ?? SCALE_HANDLE_DEFAULTS.minScale,
      maxScale: options.maxScale ?? SCALE_HANDLE_DEFAULTS.maxScale,
    };
  }

  /**
   * Initialize with map instance
   */
  init(map: MapLibreMap): void {
    this.map = map;
  }

  /**
   * Scale a feature by a given factor
   */
  scale(
    feature: Feature,
    factor: number,
    origin?: Position
  ): Feature {
    const clampedFactor = clamp(
      factor,
      this.options.minScale,
      this.options.maxScale
    );

    const center =
      origin || (turf.centroid(feature).geometry.coordinates as Position);

    const scaled = turf.transformScale(feature, clampedFactor, {
      origin: center as [number, number],
    });

    scaled.id = feature.id || generateFeatureId();
    scaled.properties = { ...feature.properties };

    return scaled;
  }

  /**
   * Scale feature by dragging from a specific handle
   */
  scaleFromHandle(
    feature: Feature,
    handlePosition: ScaleHandlePosition,
    startPoint: Position,
    currentPoint: Position
  ): Feature {
    const bbox = turf.bbox(feature) as [number, number, number, number];
    const center = turf.centroid(feature).geometry.coordinates;

    // Calculate distances from center
    const startDistance = this.distanceFromCenter(startPoint, center);
    const currentDistance = this.distanceFromCenter(currentPoint, center);

    // Calculate scale factor
    let factor = currentDistance / startDistance;
    factor = clamp(factor, this.options.minScale, this.options.maxScale);

    // Determine origin based on handle position and settings
    let origin: Position;
    if (this.options.scaleFromCenter) {
      origin = center;
    } else {
      origin = this.getOppositeCorner(bbox, handlePosition);
    }

    return this.scale(feature, factor, origin);
  }

  /**
   * Create scale handles for a feature
   */
  createHandles(feature: Feature): ScaleHandle[] {
    const bbox = turf.bbox(feature);
    const [minX, minY, maxX, maxY] = bbox;
    const midX = (minX + maxX) / 2;
    const midY = (minY + maxY) / 2;

    this.handles = [
      { position: 'nw', coordinates: [minX, maxY] },
      { position: 'n', coordinates: [midX, maxY] },
      { position: 'ne', coordinates: [maxX, maxY] },
      { position: 'e', coordinates: [maxX, midY] },
      { position: 'se', coordinates: [maxX, minY] },
      { position: 's', coordinates: [midX, minY] },
      { position: 'sw', coordinates: [minX, minY] },
      { position: 'w', coordinates: [minX, midY] },
    ];

    return this.handles;
  }

  /**
   * Start scaling operation
   */
  startScale(
    feature: Feature,
    handlePosition: ScaleHandlePosition,
    startPoint: Position,
    onScale?: (feature: Feature, factor: number) => void
  ): void {
    this.activeFeature = turf.clone(feature);
    this.originalFeature = turf.clone(feature);
    this.activeHandle = handlePosition;
    this.startPoint = startPoint;
    this.onScaleCallback = onScale || null;

    this.showHandles(feature);
  }

  /**
   * Show scale handles without starting a drag operation
   */
  showHandlesForFeature(feature: Feature): void {
    this.showHandles(feature);
  }

  /**
   * Update scaling during drag
   */
  updateScale(currentPoint: Position): Feature | null {
    if (
      !this.activeFeature ||
      !this.originalFeature ||
      !this.activeHandle ||
      !this.startPoint
    ) {
      return null;
    }

    const scaled = this.scaleFromHandle(
      this.originalFeature,
      this.activeHandle,
      this.startPoint,
      currentPoint
    );

    this.activeFeature = scaled;
    this.updateHandlePositions(scaled);

    // Calculate factor for callback
    const originalBbox = turf.bbox(this.originalFeature);
    const scaledBbox = turf.bbox(scaled);
    const factor =
      (scaledBbox[2] - scaledBbox[0]) / (originalBbox[2] - originalBbox[0]);

    if (this.onScaleCallback) {
      this.onScaleCallback(scaled, factor);
    }

    return scaled;
  }

  /**
   * End scaling operation
   */
  endScale(): { feature: Feature; factor: number } | null {
    if (!this.activeFeature || !this.originalFeature) {
      return null;
    }

    const originalBbox = turf.bbox(this.originalFeature);
    const scaledBbox = turf.bbox(this.activeFeature);
    const factor =
      (scaledBbox[2] - scaledBbox[0]) / (originalBbox[2] - originalBbox[0]);

    const result = {
      feature: this.activeFeature,
      factor,
    };

    this.hideHandles();
    this.activeFeature = null;
    this.originalFeature = null;
    this.activeHandle = null;
    this.startPoint = null;
    this.onScaleCallback = null;

    return result;
  }

  /**
   * Cancel scaling operation
   */
  cancelScale(): void {
    this.hideHandles();
    this.activeFeature = null;
    this.originalFeature = null;
    this.activeHandle = null;
    this.startPoint = null;
    this.onScaleCallback = null;
  }

  /**
   * Show scale handles on the map
   */
  private showHandles(feature: Feature): void {
    if (!this.map) return;

    const handles = this.createHandles(feature);
    const handleFeatures = handles.map((h) =>
      turf.point(h.coordinates, { position: h.position })
    );

    // Add source if it doesn't exist
    if (!this.map.getSource(INTERNAL_IDS.SCALE_HANDLES_SOURCE)) {
      this.map.addSource(INTERNAL_IDS.SCALE_HANDLES_SOURCE, {
        type: 'geojson',
        data: turf.featureCollection(handleFeatures),
      });

      this.map.addLayer({
        id: INTERNAL_IDS.SCALE_HANDLES_LAYER,
        type: 'circle',
        source: INTERNAL_IDS.SCALE_HANDLES_SOURCE,
        paint: {
          'circle-radius': SCALE_HANDLE_DEFAULTS.handleSize / 2,
          'circle-color': SCALE_HANDLE_DEFAULTS.handleColor,
          'circle-stroke-color': SCALE_HANDLE_DEFAULTS.handleBorderColor,
          'circle-stroke-width': SCALE_HANDLE_DEFAULTS.handleBorderWidth,
        },
      });
    } else {
      const source = this.map.getSource(INTERNAL_IDS.SCALE_HANDLES_SOURCE) as GeoJSONSource | undefined;
      if (source) {
        source.setData(turf.featureCollection(handleFeatures));
      }
    }
  }

  /**
   * Update handle positions after scaling
   */
  private updateHandlePositions(feature: Feature): void {
    if (!this.map) return;

    const handles = this.createHandles(feature);
    const handleFeatures = handles.map((h) =>
      turf.point(h.coordinates, { position: h.position })
    );

    const source = this.map.getSource(INTERNAL_IDS.SCALE_HANDLES_SOURCE) as GeoJSONSource | undefined;
    if (source) {
      source.setData(turf.featureCollection(handleFeatures));
    }
  }

  /**
   * Hide scale handles from the map
   */
  private hideHandles(): void {
    if (!this.map) return;

    if (this.map.getLayer(INTERNAL_IDS.SCALE_HANDLES_LAYER)) {
      this.map.removeLayer(INTERNAL_IDS.SCALE_HANDLES_LAYER);
    }
    if (this.map.getSource(INTERNAL_IDS.SCALE_HANDLES_SOURCE)) {
      this.map.removeSource(INTERNAL_IDS.SCALE_HANDLES_SOURCE);
    }
  }

  /**
   * Calculate distance from a point to the center
   */
  private distanceFromCenter(point: Position, center: Position): number {
    return Math.sqrt(
      Math.pow(point[0] - center[0], 2) + Math.pow(point[1] - center[1], 2)
    );
  }

  /**
   * Get the opposite corner for scaling origin
   */
  private getOppositeCorner(
    bbox: [number, number, number, number],
    handlePosition: ScaleHandlePosition
  ): Position {
    const [minX, minY, maxX, maxY] = bbox;
    const midX = (minX + maxX) / 2;
    const midY = (minY + maxY) / 2;

    const opposites: Record<ScaleHandlePosition, Position> = {
      nw: [maxX, minY],
      n: [midX, minY],
      ne: [minX, minY],
      e: [minX, midY],
      se: [minX, maxY],
      s: [midX, maxY],
      sw: [maxX, maxY],
      w: [maxX, midY],
    };

    return opposites[handlePosition];
  }

  /**
   * Get handle at a specific point
   */
  getHandleAtPoint(
    point: Position,
    tolerance: number = 0.0001
  ): ScaleHandlePosition | null {
    for (const handle of this.handles) {
      const distance = this.distanceFromCenter(point, handle.coordinates);
      if (distance < tolerance) {
        return handle.position;
      }
    }
    return null;
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    this.cancelScale();
    this.map = null;
  }
}
