import type {
  Feature,
  Polygon,
  LineString,
  Position,
} from 'geojson';
import type { Map as MapLibreMap, MapMouseEvent, GeoJSONSource } from 'maplibre-gl';
import * as turf from '@turf/turf';
import type { SplitOptions, SplitResult } from '../core/types';
import { INTERNAL_IDS } from '../core/constants';
import { generateFeatureId } from '../utils/geometryUtils';

/**
 * Handles splitting of polygons and lines
 */
export class SplitFeature {
  private map: MapLibreMap | null = null;
  private isDrawing: boolean = false;
  private splitLinePoints: Position[] = [];
  private targetFeature: Feature<Polygon | LineString> | null = null;
  private onCompleteCallback: ((result: SplitResult) => void) | null = null;

  // Bound event handlers
  private handleClick: ((e: MapMouseEvent) => void) | null = null;
  private handleMouseMove: ((e: MapMouseEvent) => void) | null = null;
  private handleDblClick: ((e: MapMouseEvent) => void) | null = null;

  constructor() {}

  /**
   * Initialize with map instance
   */
  init(map: MapLibreMap): void {
    this.map = map;
  }

  /**
   * Split a polygon with a line
   */
  splitPolygon(
    polygon: Feature<Polygon>,
    splitter: Feature<LineString>,
    _options?: SplitOptions
  ): SplitResult {
    try {
      // Get intersection points
      const polygonLine = turf.polygonToLine(polygon);
      const intersections = turf.lineIntersect(
        polygonLine as Feature<LineString>,
        splitter
      );

      if (intersections.features.length < 2) {
        return {
          original: polygon,
          parts: [],
          success: false,
          error: 'Splitting line must intersect polygon at least twice',
        };
      }

      // Clip splitter to polygon
      const clipped = this.clipLineToBbox(splitter, turf.bbox(polygon) as [number, number, number, number]);
      if (!clipped) {
        return {
          original: polygon,
          parts: [],
          success: false,
          error: 'Could not clip splitting line to polygon',
        };
      }

      // Perform the split using a different approach
      const parts = this.performPolygonSplit(polygon, splitter);

      if (parts.length === 0) {
        return {
          original: polygon,
          parts: [],
          success: false,
          error: 'Split operation produced no valid parts',
        };
      }

      // Assign new IDs to parts
      parts.forEach((part) => {
        part.id = generateFeatureId();
        part.properties = { ...polygon.properties };
      });

      return {
        original: polygon,
        parts,
        success: true,
      };
    } catch (error) {
      return {
        original: polygon,
        parts: [],
        success: false,
        error: `Split operation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  /**
   * Split a line with a point or another line
   */
  splitLine(
    line: Feature<LineString>,
    splitter: Feature<LineString>
  ): SplitResult {
    try {
      const result = turf.lineSplit(line, splitter as Parameters<typeof turf.lineSplit>[1]);

      if (result.features.length <= 1) {
        return {
          original: line,
          parts: [],
          success: false,
          error: 'Splitter does not intersect the line',
        };
      }

      const parts = result.features.map((f) => {
        const feature = f as Feature<LineString>;
        feature.id = generateFeatureId();
        feature.properties = { ...line.properties };
        return feature;
      });

      return {
        original: line,
        parts,
        success: true,
      };
    } catch (error) {
      return {
        original: line,
        parts: [],
        success: false,
        error: `Split operation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  /**
   * Start interactive split mode
   */
  startSplit(
    feature: Feature<Polygon | LineString>,
    onComplete: (result: SplitResult) => void
  ): void {
    if (!this.map) return;

    this.targetFeature = feature;
    this.onCompleteCallback = onComplete;
    this.splitLinePoints = [];
    this.isDrawing = true;

    this.setupSplitLineLayers();
    this.attachEventListeners();

    this.map.getCanvas().style.cursor = 'crosshair';
  }

  /**
   * Cancel the split operation
   */
  cancelSplit(): void {
    this.cleanup();
    this.targetFeature = null;
    this.onCompleteCallback = null;
  }

  /**
   * Check if split mode is active
   */
  isActive(): boolean {
    return this.isDrawing;
  }

  /**
   * Perform the actual polygon split
   */
  private performPolygonSplit(
    polygon: Feature<Polygon>,
    splitter: Feature<LineString>
  ): Feature<Polygon>[] {
    try {
      // Use a cutting approach
      // 1. Buffer the splitting line slightly
      // 2. Compute difference to create two parts

      const bufferedLine = turf.buffer(splitter, 0.00001, { units: 'degrees' });
      if (!bufferedLine) return [];

      // Get the difference (this creates a hole along the split line)
      const collection = turf.featureCollection([polygon, bufferedLine]);
      const withCut = turf.difference(collection);

      if (!withCut) return [];

      // If the result is a MultiPolygon, extract the parts
      if (withCut.geometry.type === 'MultiPolygon') {
        return withCut.geometry.coordinates.map((coords) => {
          return turf.polygon(coords) as Feature<Polygon>;
        });
      }

      // If still a single polygon, try an alternative approach
      // Use the unkink function to handle self-intersections
      const unkinked = turf.unkinkPolygon(withCut as Feature<Polygon>);
      if (unkinked.features.length > 1) {
        return unkinked.features as Feature<Polygon>[];
      }

      return [withCut as Feature<Polygon>];
    } catch {
      return [];
    }
  }

  /**
   * Clip a line to a bounding box
   */
  private clipLineToBbox(
    line: Feature<LineString>,
    bbox: [number, number, number, number]
  ): Feature<LineString> | null {
    try {
      const clipped = turf.bboxClip(line, bbox);
      return clipped as Feature<LineString>;
    } catch {
      return null;
    }
  }

  /**
   * Setup layers for split line visualization
   */
  private setupSplitLineLayers(): void {
    if (!this.map) return;

    if (!this.map.getSource(INTERNAL_IDS.SPLIT_LINE_SOURCE)) {
      this.map.addSource(INTERNAL_IDS.SPLIT_LINE_SOURCE, {
        type: 'geojson',
        data: turf.featureCollection([]),
      });
    }

    if (!this.map.getLayer(INTERNAL_IDS.SPLIT_LINE_LAYER)) {
      this.map.addLayer({
        id: INTERNAL_IDS.SPLIT_LINE_LAYER,
        type: 'line',
        source: INTERNAL_IDS.SPLIT_LINE_SOURCE,
        paint: {
          'line-color': '#ff4444',
          'line-width': 3,
          'line-dasharray': [3, 3],
        },
      });
    }
  }

  /**
   * Attach event listeners for drawing the split line
   */
  private attachEventListeners(): void {
    if (!this.map) return;

    this.handleClick = (e: MapMouseEvent) => {
      this.splitLinePoints.push([e.lngLat.lng, e.lngLat.lat]);
      this.updateSplitLineVisualization();
    };

    this.handleMouseMove = (e: MapMouseEvent) => {
      if (this.splitLinePoints.length === 0) return;

      // Show preview of next segment
      const previewPoints = [
        ...this.splitLinePoints,
        [e.lngLat.lng, e.lngLat.lat],
      ];
      this.updateSplitLineVisualization(previewPoints);
    };

    this.handleDblClick = (e: MapMouseEvent) => {
      e.preventDefault();
      this.completeSplit();
    };

    this.map.on('click', this.handleClick);
    this.map.on('mousemove', this.handleMouseMove);
    this.map.on('dblclick', this.handleDblClick);
  }

  /**
   * Remove event listeners
   */
  private removeEventListeners(): void {
    if (!this.map) return;

    if (this.handleClick) {
      this.map.off('click', this.handleClick);
    }
    if (this.handleMouseMove) {
      this.map.off('mousemove', this.handleMouseMove);
    }
    if (this.handleDblClick) {
      this.map.off('dblclick', this.handleDblClick);
    }

    this.handleClick = null;
    this.handleMouseMove = null;
    this.handleDblClick = null;
  }

  /**
   * Update the split line visualization
   */
  private updateSplitLineVisualization(points?: Position[]): void {
    if (!this.map) return;

    const source = this.map.getSource(INTERNAL_IDS.SPLIT_LINE_SOURCE) as GeoJSONSource | undefined;
    if (!source) return;

    const linePoints = points || this.splitLinePoints;
    if (linePoints.length < 2) {
      source.setData(turf.featureCollection([]));
      return;
    }

    const line = turf.lineString(linePoints);
    source.setData(turf.featureCollection([line]));
  }

  /**
   * Complete the split operation
   */
  private completeSplit(): void {
    if (
      !this.targetFeature ||
      !this.onCompleteCallback ||
      this.splitLinePoints.length < 2
    ) {
      this.cleanup();
      return;
    }

    const splitter = turf.lineString(this.splitLinePoints);
    let result: SplitResult;

    if (this.targetFeature.geometry.type === 'Polygon') {
      result = this.splitPolygon(
        this.targetFeature as Feature<Polygon>,
        splitter
      );
    } else {
      result = this.splitLine(
        this.targetFeature as Feature<LineString>,
        splitter
      );
    }

    this.onCompleteCallback(result);
    this.cleanup();
  }

  /**
   * Cleanup after split operation
   */
  private cleanup(): void {
    this.removeEventListeners();
    this.clearSplitLine();
    this.isDrawing = false;
    this.splitLinePoints = [];

    if (this.map) {
      this.map.getCanvas().style.cursor = '';
    }
  }

  /**
   * Clear the split line visualization
   */
  private clearSplitLine(): void {
    if (!this.map) return;

    const source = this.map.getSource(INTERNAL_IDS.SPLIT_LINE_SOURCE) as GeoJSONSource | undefined;
    if (source) {
      source.setData(turf.featureCollection([]));
    }
  }

  /**
   * Remove split line layers from the map
   */
  removeLayers(): void {
    if (!this.map) return;

    if (this.map.getLayer(INTERNAL_IDS.SPLIT_LINE_LAYER)) {
      this.map.removeLayer(INTERNAL_IDS.SPLIT_LINE_LAYER);
    }
    if (this.map.getSource(INTERNAL_IDS.SPLIT_LINE_SOURCE)) {
      this.map.removeSource(INTERNAL_IDS.SPLIT_LINE_SOURCE);
    }
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    this.cancelSplit();
    this.removeLayers();
    this.map = null;
  }
}
