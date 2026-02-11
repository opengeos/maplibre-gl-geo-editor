import type { IControl, Map as MapLibreMap, MapMouseEvent, GeoJSONSource } from 'maplibre-gl';
import maplibregl from 'maplibre-gl';
import type { Feature, FeatureCollection, Polygon, LineString, Point, GeoJsonProperties } from 'geojson';
import * as turf from '@turf/turf';
import type {
  GeoEditorOptions,
  GeoEditorOptionsRequired,
  GeoEditorState,
  DrawMode,
  EditMode,
  GeomanInstance,
  GeomanFeatureData,
  SplitResult,
  UnionResult,
  DifferenceResult,
  SimplifyResult,
  LassoResult,
  ScaleHandlePosition,
  GeoJsonLoadResult,
  GeoJsonSaveResult,
  HistoryState,
  AttributeFieldDefinition,
  AttributeSchema,
  AttributeChangeEvent,
} from './types';
import { HistoryManager } from './HistoryManager';
import {
  CreateFeatureCommand,
  EditFeatureCommand,
  DeleteFeatureCommand,
  CompositeCommand,
} from './commands';
import type { CommandContext } from './commands';
import { DEFAULT_OPTIONS, CSS_PREFIX, ADVANCED_EDIT_MODES, INTERNAL_IDS } from './constants';
import {
  CopyFeature,
  SimplifyFeature,
  UnionFeature,
  DifferenceFeature,
  ScaleFeature,
  LassoFeature,
  SplitFeature,
  FreehandFeature,
} from '../features';
import { getPolygonFeatures } from '../utils/selectionUtils';
import { isPolygon, isLine } from '../utils/geometryUtils';

/**
 * GeoEditor - Advanced geometry editing control for MapLibre GL
 * Extends the free Geoman control with advanced features
 */
export class GeoEditor implements IControl {
  private map!: MapLibreMap;
  private geoman: GeomanInstance | null = null;
  private container!: HTMLDivElement;
  private options: GeoEditorOptionsRequired;
  private state: GeoEditorState;

  // Feature handlers
  private copyFeature: CopyFeature;
  private simplifyFeature: SimplifyFeature;
  private unionFeature: UnionFeature;
  private differenceFeature: DifferenceFeature;
  private scaleFeature: ScaleFeature;
  private lassoFeature: LassoFeature;
  private splitFeature: SplitFeature;
  private freehandFeature: FreehandFeature;

  // Event listeners
  private boundKeyHandler: ((e: KeyboardEvent) => void) | null = null;
  private boundClickHandler: ((e: MapMouseEvent) => void) | null = null;
  private boundScaleMouseDown: ((e: MapMouseEvent) => void) | null = null;
  private boundScaleMouseMove: ((e: MapMouseEvent) => void) | null = null;
  private boundScaleMouseUp: ((e: MapMouseEvent) => void) | null = null;

  // Selection mode state
  private isSelectMode: boolean = false;

  // Interactive selection mode for union/difference
  private pendingOperation: 'union' | 'difference' | null = null;

  // Snapping state (independent of other modes)
  private snappingEnabled: boolean = false;

  // Last known feature operations
  private lastCreatedFeature: Feature | null = null;
  private lastEditedFeature: Feature | null = null;
  private lastDeletedFeature: Feature | null = null;
  private lastDeletedFeatureId: string | null = null;

  // Scale mode state
  private isScaling: boolean = false;
  private scaleTargetFeature: Feature | null = null;
  private scaleTargetGeomanData: GeomanFeatureData | null = null;
  private scaleStartFeature: Feature | null = null;
  private scaleDragPanEnabled: boolean | null = null;

  // Multi-drag mode state
  private isMultiDragging: boolean = false;
  private multiDragStartPoint: [number, number] | null = null;
  private multiDragOriginalFeatures: Feature[] = [];
  private multiDragGeomanData: (GeomanFeatureData | null)[] = [];
  private multiDragPanEnabled: boolean | null = null;
  private boundMultiDragMouseDown: ((e: MapMouseEvent) => void) | null = null;
  private boundMultiDragMouseMove: ((e: MapMouseEvent) => void) | null = null;
  private boundMultiDragMouseUp: ((e: MapMouseEvent) => void) | null = null;

  // Toolbar element reference
  private toolbar: HTMLDivElement | null = null;

  // Hidden file input for file dialog
  private fileInput: HTMLInputElement | null = null;

  // Feature properties popup
  private propertiesPopup: maplibregl.Popup | null = null;

  // History management (undo/redo)
  private historyManager: HistoryManager | null = null;
  private pendingEditFeature: Feature | null = null;
  private isPerformingCompositeOperation: boolean = false;

  // Attribute editing panel
  private attributePanel: HTMLDivElement | null = null;
  private attributePanelVisible: boolean = false;
  private currentEditingFeature: Feature | null = null;
  private currentEditingGeomanData: GeomanFeatureData | null = null;
  private isNewFeature: boolean = false;
  private originalProperties: Record<string, unknown> | null = null;

  // Style data listener for modifying Geoman's vertex markers
  private boundStyleDataHandler: (() => void) | null = null;

  // Event handlers for on()/off() API
  private _eventHandlers: globalThis.Map<string, Set<(data?: unknown) => void>> = new globalThis.Map();

  constructor(options: GeoEditorOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };

    this.state = {
      activeDrawMode: null,
      activeEditMode: null,
      selectedFeatures: [],
      isDrawing: false,
      isEditing: false,
      clipboard: [],
      collapsed: this.options.collapsed,
    };

    // Initialize snapping from options
    this.snappingEnabled = this.options.snappingEnabled;

    // Initialize feature handlers
    this.copyFeature = new CopyFeature();
    this.simplifyFeature = new SimplifyFeature({
      tolerance: this.options.simplifyTolerance,
    });
    this.unionFeature = new UnionFeature();
    this.differenceFeature = new DifferenceFeature();
    this.scaleFeature = new ScaleFeature();
    this.lassoFeature = new LassoFeature();
    this.splitFeature = new SplitFeature();
    this.freehandFeature = new FreehandFeature();

    // Initialize history manager if enabled
    if (this.options.enableHistory !== false) {
      this.historyManager = new HistoryManager(
        this.options.maxHistorySize,
        (canUndo, canRedo) => {
          this.updateHistoryButtonStates(canUndo, canRedo);
          this.options.onHistoryChange?.(canUndo, canRedo);
        }
      );
    }
  }

  /**
   * Called when the control is added to the map
   */
  onAdd(map: MapLibreMap): HTMLElement {
    this.map = map;

    // Initialize feature handlers with map
    this.scaleFeature.init(map);
    this.lassoFeature.init(map);
    this.splitFeature.init(map);
    this.freehandFeature.init(map);

    // Create container
    this.container = document.createElement('div');
    this.container.className = `maplibregl-ctrl maplibregl-ctrl-group ${CSS_PREFIX}-control`;

    // Create toolbar
    this.createToolbar();

    // Setup file input for file dialog
    this.setupFileInput();

    // Setup keyboard shortcuts
    this.setupKeyboardShortcuts();

    // Setup selection handler
    this.setupSelectionHandler();
    this.setupScaleHandler();
    this.setupMultiDragHandler();

    // Setup styledata listener to modify Geoman's vertex markers when layers change
    this.setupVertexMarkerStyleListener();

    // Setup geoman event listener if geoman is available
    this.setupGeomanEvents();

    // Create attribute editing panel if enabled
    if (this.options.enableAttributeEditing) {
      this.createAttributePanel();
    }

    return this.container;
  }

  /**
   * Called when the control is removed from the map
   */
  onRemove(): void {
    this.removeKeyboardShortcuts();
    this.removeSelectionHandler();
    this.removeScaleHandler();
    this.removeMultiDragHandler();
    this.removeVertexMarkerStyleListener();
    this.disableAllModes();

    // Cleanup popup and attribute panel
    this.hideFeaturePropertiesPopup();
    this.hideAttributePanel();
    this.removeAttributePanel();

    // Cleanup feature handlers
    this.scaleFeature.destroy();
    this.lassoFeature.destroy();
    this.splitFeature.destroy();
    this.freehandFeature.destroy();

    // Cleanup file input
    if (this.fileInput && this.fileInput.parentNode) {
      this.fileInput.parentNode.removeChild(this.fileInput);
      this.fileInput = null;
    }

    if (this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
    }

    // @ts-expect-error - cleanup
    this.map = undefined;
  }

  /**
   * Set the Geoman instance for integration
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setGeoman(geoman: any): void {
    this.geoman = geoman;
    this.setupGeomanEvents();
    this.applySnappingState();

    // Hide geoman control if option is set
    if (this.options.hideGeomanControl) {
      this.hideGeomanControl();
    }
  }

  /**
   * Hide the geoman control toolbar
   */
  private hideGeomanControl(): void {
    // Use geoman's removeControls method if available
    if (this.geoman) {
      try {
        this.geoman.removeControls();
      } catch {
        // Fallback: hide via CSS with multiple possible selectors
        const selectors = [
          '.maplibregl-ctrl.geoman-controls',
          '.gm-control',
          '.maplibregl-ctrl-group.geoman',
          '[class*="geoman"]',
        ];
        selectors.forEach((selector) => {
          const elements = document.querySelectorAll(selector);
          elements.forEach((el) => {
            // Don't hide our own control
            if (!el.classList.contains('geo-editor-control')) {
              (el as HTMLElement).style.display = 'none';
            }
          });
        });
      }
    }
  }

  /**
   * Setup click handler for feature selection
   */
  private setupSelectionHandler(): void {
    this.boundClickHandler = (e: MapMouseEvent) => {
      // Handle both select mode and pending operation mode (union/difference)
      if (!this.isSelectMode && !this.pendingOperation) {
        return;
      }
      if (!this.geoman) {
        return;
      }

      // Find the clicked feature (prefer Geoman's hit test, fallback to turf)
      const result =
        this.findFeatureByMouseEvent(e) ||
        this.findFeatureAtPoint(e.lngLat.lng, e.lngLat.lat);

      if (result) {
        const { feature, geomanData } = result;
        // For union/difference mode, always add to selection (multi-select)
        if (this.pendingOperation) {
          // Only add polygons for union/difference
          if (feature.geometry.type === 'Polygon' || feature.geometry.type === 'MultiPolygon') {
            this.addToSelection(feature, geomanData);
          }
          // Silently ignore non-polygon clicks in union/difference mode
        } else if (e.originalEvent.shiftKey) {
          this.toggleFeatureSelection(feature, geomanData);
        } else {
          this.selectFeatures([feature], [geomanData]);
        }
      } else if (!e.originalEvent.shiftKey && !this.pendingOperation) {
        this.clearSelection();
      }
    };

    this.map.on('click', this.boundClickHandler);
  }

  /**
   * Calculate click tolerance in kilometers based on current zoom level.
   * At lower zoom levels (zoomed out), we need a larger geographic tolerance
   * to achieve a reasonable pixel-based click area.
   */
  private getClickToleranceKm(): number {
    const zoom = this.map.getZoom();
    // Base tolerance in pixels (how many pixels away from a feature counts as a hit)
    const pixelTolerance = 15;
    // At zoom 0, the world is ~40,000 km wide in 256 pixels
    // Each zoom level doubles the resolution
    const worldWidthKm = 40075; // Earth's circumference in km
    const tileSize = 512; // MapLibre default tile size
    const pixelsAtZoom = tileSize * Math.pow(2, zoom);
    const kmPerPixel = worldWidthKm / pixelsAtZoom;
    return kmPerPixel * pixelTolerance;
  }

  /**
   * Find a feature at a given point
   */
  private findFeatureAtPoint(lng: number, lat: number): { feature: Feature; geomanData: GeomanFeatureData } | null {
    if (!this.geoman) {
      return null;
    }

    const clickPoint: [number, number] = [lng, lat];
    const point = turf.point(clickPoint);
    let result: { feature: Feature; geomanData: GeomanFeatureData } | null = null;

    // Calculate zoom-aware tolerance for point and line hit detection
    const toleranceKm = this.getClickToleranceKm();

    // Try to get all features first using getAll()
    let allFeatures: Feature[] = [];
    const geomanDataMap = new Map<string, GeomanFeatureData>();

    try {
      // Try forEach to build a map of geoman data
      let index = 0;
      this.geoman.features.forEach((fd) => {
        const feature = this.getGeomanFeature(fd);
        // Skip if geoman data or its geoJson is undefined
        if (!fd || !feature || !feature.geometry) {
          index++;
          return;
        }
        // Use index as fallback since fd.id might be undefined
        const featureId = String(fd.id ?? feature.id ?? `feature-${index}`);
        allFeatures.push(feature);
        geomanDataMap.set(featureId, fd);
        // Also map by index for reliable lookup
        geomanDataMap.set(`idx-${index}`, fd);
        index++;
      });
    } catch {
      try {
        const fc = this.geoman.features.getAll();
        // Filter out undefined/null features
        allFeatures = (fc.features || []).filter((f) => f && f.geometry);
      } catch {
        return null;
      }
    }

    // Now check each feature
    for (let i = 0; i < allFeatures.length; i++) {
      const feature = allFeatures[i];

      // Skip undefined or null features
      if (!feature || !feature.geometry) {
        continue;
      }

      const featureId = String(feature.id ?? `feature-${i}`);
      // Try to get geoman data by feature id first, then by index
      const geomanData = geomanDataMap.get(featureId) || geomanDataMap.get(`idx-${i}`);

      try {
        let isHit = false;

        if (feature.geometry.type === 'Point') {
          const featurePoint = turf.point((feature.geometry as Point).coordinates as [number, number]);
          const distance = turf.distance(point, featurePoint, { units: 'kilometers' });
          isHit = distance < toleranceKm;
        } else if (feature.geometry.type === 'Polygon' || feature.geometry.type === 'MultiPolygon') {
          const inside = turf.booleanPointInPolygon(point, feature as Feature<Polygon>);
          isHit = inside;
        } else if (feature.geometry.type === 'LineString' || feature.geometry.type === 'MultiLineString') {
          const nearestPoint = turf.nearestPointOnLine(feature as Feature<LineString>, point);
          isHit = nearestPoint.properties.dist !== undefined && nearestPoint.properties.dist < toleranceKm;
        }

        if (isHit) {
          // If we don't have geomanData, create a minimal one with delete method
          const fd = geomanData || this.findGeomanDataForFeature(feature);
          if (fd) {
            result = { feature, geomanData: fd };
            break;
          }
        }
      } catch {
        // Continue to next feature
      }
    }

    return result;
  }

  /**
   * Find a feature at the mouse event using Geoman's hit test
   */
  private findFeatureByMouseEvent(
    e: MapMouseEvent
  ): { feature: Feature; geomanData: GeomanFeatureData } | null {
    if (!this.geoman || !e.originalEvent) {
      return null;
    }

    try {
      const geomanData = this.geoman.features.getFeatureByMouseEvent({
        event: e,
      });
      const feature = this.getGeomanFeature(geomanData);

      if (feature && geomanData) {
        return { feature, geomanData };
      }
    } catch {
      // Fall back to turf-based hit testing
    }

    return null;
  }

  /**
   * Find geoman data for a feature by searching
   */
  private findGeomanDataForFeature(targetFeature: Feature): GeomanFeatureData | null {
    if (!this.geoman) return null;

    let foundData: GeomanFeatureData | null = null;
    const targetId = this.getGeomanIdFromFeature(targetFeature);

    try {
      this.geoman.features.forEach((fd) => {
        if (foundData) return;

        const feature = this.getGeomanFeature(fd);
        if (!feature) return;

        // Match by ID or by geometry
        if (
          (targetId && String(feature.id) === targetId) ||
          (targetId && this.getGeomanIdFromFeature(feature) === targetId)
        ) {
          foundData = fd;
        } else if (JSON.stringify(feature.geometry) === JSON.stringify(targetFeature.geometry)) {
          foundData = fd;
        }
      });
    } catch {
      // forEach not available
    }

    return foundData;
  }

  private getGeomanIdFromFeature(feature: Feature): string | null {
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

  /**
   * Remove selection handler
   */
  private removeSelectionHandler(): void {
    if (this.boundClickHandler) {
      this.map.off('click', this.boundClickHandler);
      this.boundClickHandler = null;
    }
  }

  /**
   * Setup mouse handlers for scale mode
   */
  private setupScaleHandler(): void {
    this.boundScaleMouseDown = (e: MapMouseEvent) => {
      if (this.state.activeEditMode !== 'scale') {
        return;
      }

      const handle = this.getScaleHandleFromEvent(e);
      if (!handle || !this.scaleTargetFeature || !this.scaleTargetGeomanData) {
        return;
      }

      e.preventDefault();
      this.isScaling = true;
      this.scaleStartFeature = this.scaleTargetFeature;
      this.disableScaleDragPan();
      this.scaleFeature.startScale(
        this.scaleTargetFeature,
        handle,
        [e.lngLat.lng, e.lngLat.lat],
        (scaled, factor) => {
          this.applyScaledFeature(scaled);
          this.emitEvent('gm:scale', { feature: scaled, scaleFactor: factor });
        }
      );
      this.emitEvent('gm:scalestart', { feature: this.scaleTargetFeature });
    };

    this.boundScaleMouseMove = (e: MapMouseEvent) => {
      if (!this.isScaling) {
        return;
      }

      const scaled = this.scaleFeature.updateScale([e.lngLat.lng, e.lngLat.lat]);
      if (scaled) {
        this.applyScaledFeature(scaled);
      }
    };

    this.boundScaleMouseUp = () => {
      if (!this.isScaling) {
        return;
      }

      this.isScaling = false;
      const result = this.scaleFeature.endScale();
      this.restoreScaleDragPan();

      if (result) {
        this.applyScaledFeature(result.feature);
        if (this.scaleStartFeature) {
          this.options.onFeatureEdit?.(result.feature, this.scaleStartFeature);
        }
        this.lastEditedFeature = result.feature;
        this.logSelectedFeatureCollection('edited', result.feature);
        this.scaleFeature.showHandlesForFeature(result.feature);
        this.bringScaleHandlesToFront();
        this.emitEvent('gm:scaleend', {
          feature: result.feature,
          scaleFactor: result.factor,
        });
      }

      this.scaleStartFeature = null;
    };

    this.map.on('mousedown', this.boundScaleMouseDown);
    this.map.on('mousemove', this.boundScaleMouseMove);
    this.map.on('mouseup', this.boundScaleMouseUp);
  }

  /**
   * Remove scale handlers
   */
  private removeScaleHandler(): void {
    if (this.boundScaleMouseDown) {
      this.map.off('mousedown', this.boundScaleMouseDown);
      this.boundScaleMouseDown = null;
    }
    if (this.boundScaleMouseMove) {
      this.map.off('mousemove', this.boundScaleMouseMove);
      this.boundScaleMouseMove = null;
    }
    if (this.boundScaleMouseUp) {
      this.map.off('mouseup', this.boundScaleMouseUp);
      this.boundScaleMouseUp = null;
    }
  }

  /**
   * Setup mouse handlers for multi-drag when multiple features are selected
   */
  private setupMultiDragHandler(): void {
    this.boundMultiDragMouseDown = (e: MapMouseEvent) => {
      if (this.state.activeEditMode !== 'drag') {
        return;
      }
      if (this.state.selectedFeatures.length < 2) {
        return;
      }

      const hit = this.findFeatureByMouseEvent(e) || this.findFeatureAtPoint(e.lngLat.lng, e.lngLat.lat);
      if (!hit) {
        return;
      }

      const hitId = this.getGeomanIdFromFeature(hit.feature);
      const isSelected = this.state.selectedFeatures.some(
        (s) => this.getGeomanIdFromFeature(s.feature) === hitId
      );
      if (!isSelected) {
        return;
      }

      e.preventDefault();
      this.isMultiDragging = true;
      this.multiDragStartPoint = [e.lngLat.lng, e.lngLat.lat];
      this.multiDragOriginalFeatures = this.state.selectedFeatures.map((s) => turf.clone(s.feature));
      this.multiDragGeomanData = this.state.selectedFeatures.map(
        (s) => s.geomanData ?? this.findGeomanDataForFeature(s.feature)
      );

      this.disableMultiDragPan();
    };

    this.boundMultiDragMouseMove = (e: MapMouseEvent) => {
      if (!this.isMultiDragging || !this.multiDragStartPoint) {
        return;
      }

      const start = this.multiDragStartPoint;
      const current: [number, number] = [e.lngLat.lng, e.lngLat.lat];
      const distance = turf.distance(turf.point(start), turf.point(current), { units: 'kilometers' });
      const bearing = turf.bearing(turf.point(start), turf.point(current));

      const updated: Feature[] = [];
      this.multiDragOriginalFeatures.forEach((feature, index) => {
        const moved = turf.transformTranslate(feature, distance, bearing, { units: 'kilometers' });
        const geomanData = this.multiDragGeomanData[index];
        if (geomanData?.updateGeometry) {
          geomanData.updateGeometry(moved.geometry);
        } else if (geomanData?.updateGeoJsonGeometry) {
          geomanData.updateGeoJsonGeometry(moved.geometry);
        }
        updated.push(moved);
      });

      this.state.selectedFeatures = this.state.selectedFeatures.map((s, index) => ({
        ...s,
        feature: updated[index] ?? s.feature,
      }));

      this.updateSelectionHighlight();
    };

    this.boundMultiDragMouseUp = () => {
      if (!this.isMultiDragging) {
        return;
      }

      this.isMultiDragging = false;
      this.restoreMultiDragPan();

      if (this.state.selectedFeatures.length > 0) {
        this.state.selectedFeatures.forEach((featureState, index) => {
          const original = this.multiDragOriginalFeatures[index];
          if (original) {
            this.options.onFeatureEdit?.(featureState.feature, original);
          }
        });
        this.lastEditedFeature = this.state.selectedFeatures[this.state.selectedFeatures.length - 1]?.feature ?? null;
        this.logSelectedFeatureCollection('edited', this.lastEditedFeature);
      }

      this.multiDragStartPoint = null;
      this.multiDragOriginalFeatures = [];
      this.multiDragGeomanData = [];
    };

    this.map.on('mousedown', this.boundMultiDragMouseDown);
    this.map.on('mousemove', this.boundMultiDragMouseMove);
    this.map.on('mouseup', this.boundMultiDragMouseUp);
  }

  private removeMultiDragHandler(): void {
    if (this.boundMultiDragMouseDown) {
      this.map.off('mousedown', this.boundMultiDragMouseDown);
      this.boundMultiDragMouseDown = null;
    }
    if (this.boundMultiDragMouseMove) {
      this.map.off('mousemove', this.boundMultiDragMouseMove);
      this.boundMultiDragMouseMove = null;
    }
    if (this.boundMultiDragMouseUp) {
      this.map.off('mouseup', this.boundMultiDragMouseUp);
      this.boundMultiDragMouseUp = null;
    }
  }

  private disableMultiDragPan(): void {
    this.multiDragPanEnabled = this.map.dragPan.isEnabled();
    if (this.multiDragPanEnabled) {
      this.map.dragPan.disable();
    }
  }

  private restoreMultiDragPan(): void {
    if (this.multiDragPanEnabled) {
      this.map.dragPan.enable();
    }
    this.multiDragPanEnabled = null;
  }

  private getScaleHandleFromEvent(e: MapMouseEvent): ScaleHandlePosition | null {
    if (!this.map.getLayer(INTERNAL_IDS.SCALE_HANDLES_LAYER)) {
      return null;
    }

    const hits = this.map.queryRenderedFeatures(e.point, {
      layers: [INTERNAL_IDS.SCALE_HANDLES_LAYER],
    });
    if (!hits.length) {
      return null;
    }

    const position = hits[0].properties?.position;
    if (typeof position === 'string') {
      return position as ScaleHandlePosition;
    }

    return null;
  }

  private disableScaleDragPan(): void {
    this.scaleDragPanEnabled = this.map.dragPan.isEnabled();
    if (this.scaleDragPanEnabled) {
      this.map.dragPan.disable();
    }
  }

  private restoreScaleDragPan(): void {
    if (this.scaleDragPanEnabled) {
      this.map.dragPan.enable();
    }
    this.scaleDragPanEnabled = null;
  }

  private applyScaledFeature(feature: Feature): void {
    if (this.scaleTargetGeomanData?.updateGeometry) {
      this.scaleTargetGeomanData.updateGeometry(feature.geometry);
    } else if (this.scaleTargetGeomanData?.updateGeoJsonGeometry) {
      this.scaleTargetGeomanData.updateGeoJsonGeometry(feature.geometry);
    }

    if (this.state.selectedFeatures.length > 0) {
      const current = this.state.selectedFeatures[0];
      this.state.selectedFeatures[0] = {
        ...current,
        id: String(this.scaleTargetGeomanData?.id ?? feature.id ?? current.id),
        feature,
        geomanData: this.scaleTargetGeomanData ?? current.geomanData,
      };
      this.scaleTargetFeature = feature;
    }

    this.updateSelectionHighlight();
    this.bringScaleHandlesToFront();
  }

  private bringScaleHandlesToFront(): void {
    if (!this.map.getLayer(INTERNAL_IDS.SCALE_HANDLES_LAYER)) {
      return;
    }

    try {
      this.map.moveLayer(INTERNAL_IDS.SCALE_HANDLES_LAYER);
    } catch {
      // Ignore move errors
    }
  }

  private logSelectedFeatureCollection(action: string, feature?: Feature | null): void {
    const featureId = feature ? this.getGeomanIdFromFeature(feature) : null;
    console.log('GeoEditor', {
      action,
      featureId,
      feature,
      selection: this.getSelectedFeatureCollection(),
    });
  }

  private extractFeatureFromEvent(featureLike: unknown): Feature | null {
    if (!featureLike || typeof featureLike !== 'object') {
      return null;
    }

    const candidate = featureLike as { getGeoJson?: () => Feature; geoJson?: Feature; geometry?: Feature['geometry'] };
    if (typeof candidate.getGeoJson === 'function') {
      try {
        return candidate.getGeoJson();
      } catch {
        return null;
      }
    }

    if (candidate.geoJson) {
      return candidate.geoJson;
    }

    if ('geometry' in candidate) {
      return candidate as Feature;
    }

    return null;
  }

  /**
   * Toggle feature in selection
   */
  private toggleFeatureSelection(feature: Feature, geomanData?: GeomanFeatureData): void {
    const resolvedGeomanData = geomanData ?? this.findGeomanDataForFeature(feature);
    const featureId = String(resolvedGeomanData?.id ?? feature.id);
    const isSelected = this.state.selectedFeatures.some((s) => s.id === featureId);

    if (isSelected) {
      this.removeFromSelection(featureId);
    } else {
      this.addToSelection(feature, resolvedGeomanData ?? undefined);
    }
  }

  /**
   * Enable select mode
   */
  enableSelectMode(): void {
    this.disableAllModes();
    this.isSelectMode = true;
    this.map.getCanvas().style.cursor = 'pointer';
    this.updateToolbarState();
  }

  /**
   * Disable select mode
   */
  disableSelectMode(): void {
    this.isSelectMode = false;
    this.map.getCanvas().style.cursor = '';
  }

  /**
   * Get the current state
   */
  getState(): GeoEditorState {
    return { ...this.state };
  }

  /**
   * Get selected features
   */
  getSelectedFeatures(): Feature[] {
    return this.state.selectedFeatures.map((s) => s.feature);
  }

  getSelectedFeatureCollection(): FeatureCollection {
    return {
      type: 'FeatureCollection',
      features: this.getSelectedFeatures(),
    };
  }

  /**
   * Get all features from the map
   */
  getFeatures(): FeatureCollection {
    if (this.geoman) {
      try {
        return this.geoman.features.getAll();
      } catch {
        // Fallback
        const features: Feature[] = [];
        this.geoman.features.forEach((fd) => {
          const feature = this.getGeomanFeature(fd);
          if (feature) {
            features.push(feature);
          }
        });
        return { type: 'FeatureCollection', features };
      }
    }
    return { type: 'FeatureCollection', features: [] };
  }

  getAllFeatureCollection(): FeatureCollection {
    return this.getFeatures();
  }

  getLastCreatedFeature(): Feature | null {
    return this.lastCreatedFeature;
  }

  getLastEditedFeature(): Feature | null {
    return this.lastEditedFeature;
  }

  getLastDeletedFeature(): Feature | null {
    return this.lastDeletedFeature;
  }

  getLastDeletedFeatureId(): string | null {
    return this.lastDeletedFeatureId;
  }

  // ============================================================================
  // Mode Management
  // ============================================================================

  /**
   * Enable a draw mode
   */
  enableDrawMode(mode: DrawMode): void {
    this.disableAllModes();

    // Handle freehand with our custom implementation (not available in Geoman free)
    if (mode === 'freehand') {
      this.enableFreehandMode();
    } else if (this.geoman) {
      this.geoman.enableDraw(mode);
      // Apply semi-transparent vertex marker styles after a short delay
      // to allow Geoman to create its drawing layers
      setTimeout(() => this.applyVertexMarkerStyles(), 50);
    }

    this.state.activeDrawMode = mode;
    this.state.isDrawing = true;
    this.options.onModeChange?.(mode);
    this.updateToolbarState();
  }

  /**
   * Apply semi-transparent styles to Geoman's vertex markers during drawing.
   * Geoman creates circle layers for vertex markers with specific naming patterns.
   */
  private applyVertexMarkerStyles(): void {
    if (!this.map) return;

    const style = this.map.getStyle();
    if (!style || !style.layers) return;

    // Find and modify Geoman's drawing marker layers
    // Geoman typically creates layers with patterns like 'gm-' prefix or containing 'marker', 'vertex', 'handle'
    for (const layer of style.layers) {
      const layerId = layer.id.toLowerCase();

      // Check if this is a Geoman drawing-related circle layer
      if (
        layer.type === 'circle' &&
        (layerId.includes('gm-') ||
          layerId.includes('geoman') ||
          layerId.includes('marker') ||
          layerId.includes('vertex') ||
          layerId.includes('handle') ||
          layerId.includes('temp'))
      ) {
        try {
          // Make the circle fill semi-transparent
          if (this.map.getLayer(layer.id)) {
            this.map.setPaintProperty(layer.id, 'circle-opacity', 0.5);
            // Also reduce stroke opacity slightly for a softer look
            this.map.setPaintProperty(layer.id, 'circle-stroke-opacity', 0.8);
          }
        } catch {
          // Ignore errors for layers that don't support these properties
        }
      }
    }
  }

  /**
   * Setup listener to apply vertex marker styles when map style changes.
   * This ensures Geoman's drawing markers stay semi-transparent.
   */
  private setupVertexMarkerStyleListener(): void {
    if (!this.map) return;

    this.boundStyleDataHandler = () => {
      // Only apply styles when actively drawing
      if (this.state.isDrawing) {
        this.applyVertexMarkerStyles();
      }
    };

    this.map.on('styledata', this.boundStyleDataHandler);
  }

  /**
   * Remove the vertex marker style listener
   */
  private removeVertexMarkerStyleListener(): void {
    if (this.map && this.boundStyleDataHandler) {
      this.map.off('styledata', this.boundStyleDataHandler);
      this.boundStyleDataHandler = null;
    }
  }

  /**
   * Enable freehand drawing mode (custom implementation)
   */
  private enableFreehandMode(): void {
    this.freehandFeature.enable((result) => {
      if (result.success && result.feature && this.geoman) {
        // Import the drawn feature into Geoman
        const imported = this.geoman.features.importGeoJsonFeature(result.feature);
        if (imported) {
          // Trigger feature create callback
          this.options.onFeatureCreate?.(result.feature);
          this.emitEvent('gm:create', { feature: result.feature });
        }
      }
      // Keep freehand mode active for continuous drawing
      // User can switch modes via toolbar
    });
  }

  /**
   * Disable freehand drawing mode
   */
  private disableFreehandMode(): void {
    this.freehandFeature.disable();
  }

  /**
   * Enable an edit mode
   */
  enableEditMode(mode: EditMode): void {
    this.disableAllModes();

    // Check if it's an advanced mode (our implementation)
    if (ADVANCED_EDIT_MODES.includes(mode)) {
      this.enableAdvancedEditMode(mode);
    } else if (this.geoman) {
      // Use Geoman's built-in modes
      switch (mode) {
        case 'drag':
          if (this.state.selectedFeatures.length < 2) {
            this.geoman.enableGlobalDragMode();
          }
          break;
        case 'change':
          this.geoman.enableGlobalEditMode();
          break;
        case 'rotate':
          this.geoman.enableGlobalRotateMode();
          break;
        case 'cut':
          this.geoman.enableGlobalCutMode();
          break;
        case 'delete':
          if (this.state.selectedFeatures.length > 0) {
            this.deleteSelectedFeatures();
            return;
          }
          this.geoman.enableGlobalRemovalMode();
          break;
      }
    }

    this.state.activeEditMode = mode;
    this.state.isEditing = true;
    this.options.onModeChange?.(mode);
    this.updateToolbarState();
  }

  /**
   * Disable all modes
   */
  disableAllModes(): void {
    if (this.geoman) {
      this.geoman.disableAllModes();
    }

    // Disable advanced modes
    this.scaleFeature.cancelScale();
    this.lassoFeature.disable();
    this.splitFeature.cancelSplit();
    this.disableFreehandMode();
    this.disableSelectMode();
    this.restoreScaleDragPan();
    this.restoreMultiDragPan();
    this.isMultiDragging = false;
    this.multiDragStartPoint = null;
    this.multiDragOriginalFeatures = [];
    this.multiDragGeomanData = [];
    this.isScaling = false;
    this.scaleTargetFeature = null;
    this.scaleTargetGeomanData = null;
    this.scaleStartFeature = null;

    // Reset pending operation
    this.pendingOperation = null;

    // Reset cursor
    this.map.getCanvas().style.cursor = '';

    this.state.activeDrawMode = null;
    this.state.activeEditMode = null;
    this.state.isDrawing = false;
    this.state.isEditing = false;
    this.updateToolbarState();
    this.applySnappingState();

    // Note: snapping state is NOT reset here - it's independent
  }

  /**
   * Enable an advanced edit mode
   */
  private enableAdvancedEditMode(mode: EditMode): void {
    switch (mode) {
      case 'select':
        this.enableSelectMode();
        break;
      case 'scale':
        this.enableScaleMode();
        break;
      case 'copy':
        this.enableCopyMode();
        break;
      case 'split':
        this.enableSplitMode();
        break;
      case 'union':
        this.enableUnionMode();
        break;
      case 'difference':
        this.enableDifferenceMode();
        break;
      case 'simplify':
        this.executeSimplify();
        break;
      case 'lasso':
        this.enableLassoMode();
        break;
    }
  }

  /**
   * Enable union mode (interactive polygon selection)
   */
  private enableUnionMode(): void {
    const selected = this.getSelectedFeatures();
    const polygons = getPolygonFeatures(selected);
    if (polygons.length >= 2) {
      this.executeUnion();
      return;
    }

    this.pendingOperation = 'union';
    this.map.getCanvas().style.cursor = 'pointer';
  }

  /**
   * Enable difference mode (interactive polygon selection)
   */
  private enableDifferenceMode(): void {
    const selected = this.getSelectedFeatures();
    const polygons = getPolygonFeatures(selected);
    if (polygons.length >= 2) {
      this.executeDifference();
      return;
    }

    this.pendingOperation = 'difference';
    this.map.getCanvas().style.cursor = 'pointer';
  }

  /**
   * Execute the pending operation (union/difference)
   */
  executePendingOperation(): void {
    if (!this.pendingOperation) return;

    if (this.pendingOperation === 'union') {
      this.executeUnion();
    } else if (this.pendingOperation === 'difference') {
      this.executeDifference();
    }

    this.pendingOperation = null;
  }

  /**
   * Cancel pending operation
   */
  cancelPendingOperation(): void {
    this.pendingOperation = null;
    this.clearSelection();
    this.map.getCanvas().style.cursor = '';
    this.updateToolbarState();
  }

  // ============================================================================
  // Selection Management
  // ============================================================================

  /**
   * Setup selection highlight layer
   */
  private setupSelectionHighlight(): void {
    if (!this.map) return;

    // Add source for selection highlights
    if (!this.map.getSource(INTERNAL_IDS.SELECTION_SOURCE)) {
      this.map.addSource(INTERNAL_IDS.SELECTION_SOURCE, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });

      // Add fill layer for polygons - bright yellow fill
      this.map.addLayer({
        id: INTERNAL_IDS.SELECTION_FILL_LAYER,
        type: 'fill',
        source: INTERNAL_IDS.SELECTION_SOURCE,
        filter: ['match', ['geometry-type'], ['Polygon', 'MultiPolygon'], true, false],
        paint: {
          'fill-color': '#ffff00',
          'fill-opacity': 0.3,
        },
      });

      // Add line layer for all geometries - bright yellow/orange dashed outline
      this.map.addLayer({
        id: INTERNAL_IDS.SELECTION_LINE_LAYER,
        type: 'line',
        source: INTERNAL_IDS.SELECTION_SOURCE,
        paint: {
          'line-color': '#ff9900',
          'line-width': 5,
          'line-opacity': 1,
          'line-dasharray': [3, 2],
        },
      });

      // Add circle layer for points (markers, circle markers) - bright yellow/orange highlight
      this.map.addLayer({
        id: INTERNAL_IDS.SELECTION_CIRCLE_LAYER,
        type: 'circle',
        source: INTERNAL_IDS.SELECTION_SOURCE,
        filter: ['==', ['geometry-type'], 'Point'],
        paint: {
          'circle-radius': 12,
          'circle-color': '#ffff00',
          'circle-opacity': 0.5,
          'circle-stroke-color': '#ff9900',
          'circle-stroke-width': 3,
          'circle-stroke-opacity': 1,
        },
      });
    } else {
      // Layers exist, move them to the top to ensure visibility
      try {
        if (this.map.getLayer(INTERNAL_IDS.SELECTION_FILL_LAYER)) {
          this.map.setFilter(INTERNAL_IDS.SELECTION_FILL_LAYER, [
            'match',
            ['geometry-type'],
            ['Polygon', 'MultiPolygon'],
            true,
            false,
          ]);
          this.map.moveLayer(INTERNAL_IDS.SELECTION_FILL_LAYER);
        }
        if (this.map.getLayer(INTERNAL_IDS.SELECTION_LINE_LAYER)) {
          this.map.moveLayer(INTERNAL_IDS.SELECTION_LINE_LAYER);
        }
        if (this.map.getLayer(INTERNAL_IDS.SELECTION_CIRCLE_LAYER)) {
          this.map.moveLayer(INTERNAL_IDS.SELECTION_CIRCLE_LAYER);
        }
      } catch {
        // Ignore move errors
      }
    }
  }

  /**
   * Update selection highlight on the map
   */
  private updateSelectionHighlight(): void {
    if (!this.map) return;

    // Ensure layers exist
    this.setupSelectionHighlight();

    const source = this.map.getSource(INTERNAL_IDS.SELECTION_SOURCE) as GeoJSONSource | undefined;
    if (source) {
      const features = this.getSelectedFeatures();
      source.setData({
        type: 'FeatureCollection',
        features,
      });
    }
  }

  /**
   * Select features
   */
  selectFeatures(features: Feature[], geomanDataList?: GeomanFeatureData[]): void {
    const resolvedGeomanData =
      geomanDataList && geomanDataList.length
        ? geomanDataList
        : features.map((feature) => this.findGeomanDataForFeature(feature));
    const fallbackBase = Date.now();

    this.state.selectedFeatures = features.map((f, i) => ({
      id: String(resolvedGeomanData?.[i]?.id ?? f.id ?? `${fallbackBase}-${i}`),
      feature: f,
      layerId: 'default',
      geomanData: resolvedGeomanData?.[i] ?? undefined,
    }));
    this.updateSelectionHighlight();
    this.options.onSelectionChange?.(features);
    this.logSelectedFeatureCollection('selected');

    // Show popup or attribute panel for single selected feature in select mode
    if (features.length === 1 && this.isSelectMode) {
      if (this.options.enableAttributeEditing) {
        this.showAttributePanel(features[0], resolvedGeomanData?.[0] ?? undefined, false);
      } else if (this.options.showFeatureProperties) {
        this.showFeaturePropertiesPopup(features[0]);
      }
    } else {
      this.hideAttributePanel();
      this.hideFeaturePropertiesPopup();
    }
  }

  /**
   * Add feature to selection
   */
  addToSelection(feature: Feature, geomanData?: GeomanFeatureData): void {
    const resolvedGeomanData = geomanData ?? this.findGeomanDataForFeature(feature);
    const featureId = String(resolvedGeomanData?.id ?? feature.id);
    const exists = this.state.selectedFeatures.some(
      (s) => s.id === featureId
    );
    if (!exists) {
      this.state.selectedFeatures.push({
        id: featureId,
        feature,
        layerId: 'default',
        geomanData: resolvedGeomanData ?? undefined,
      });
      this.updateSelectionHighlight();
      this.options.onSelectionChange?.(this.getSelectedFeatures());
      this.logSelectedFeatureCollection('selected');
    }
  }

  /**
   * Remove feature from selection
   */
  removeFromSelection(featureId: string): void {
    this.state.selectedFeatures = this.state.selectedFeatures.filter(
      (s) => s.id !== featureId
    );
    this.updateSelectionHighlight();
    this.options.onSelectionChange?.(this.getSelectedFeatures());
    this.logSelectedFeatureCollection('selected');
  }

  /**
   * Clear selection
   */
  clearSelection(): void {
    this.state.selectedFeatures = [];
    this.updateSelectionHighlight();
    this.hideFeaturePropertiesPopup();
    this.hideAttributePanel();
    this.options.onSelectionChange?.([]);
    this.logSelectedFeatureCollection('selected');
  }

  // ============================================================================
  // Feature Properties Popup
  // ============================================================================

  /**
   * Show popup with feature properties
   */
  private showFeaturePropertiesPopup(feature: Feature): void {
    if (!this.options.showFeatureProperties) return;
    if (!feature.properties || Object.keys(feature.properties).length === 0) return;

    // Remove existing popup
    this.hideFeaturePropertiesPopup();

    // Calculate popup position (centroid of the feature)
    const centroid = turf.centroid(feature);
    const coordinates = centroid.geometry.coordinates as [number, number];

    // Format properties as HTML
    const html = this.formatPropertiesHtml(feature.properties);

    // Create popup
    this.propertiesPopup = new maplibregl.Popup({
      maxWidth: '300px',
      closeButton: true,
      closeOnClick: false,
      className: 'geo-editor-properties-popup',
    })
      .setLngLat(coordinates)
      .setHTML(html)
      .addTo(this.map);
  }

  /**
   * Hide feature properties popup
   */
  private hideFeaturePropertiesPopup(): void {
    if (this.propertiesPopup) {
      this.propertiesPopup.remove();
      this.propertiesPopup = null;
    }
  }

  /**
   * Format feature properties as HTML table
   */
  private formatPropertiesHtml(properties: Record<string, unknown>): string {
    const entries = Object.entries(properties).filter(
      ([key]) => !key.startsWith('__') // Filter out internal properties
    );

    if (entries.length === 0) {
      return '<div class="geo-editor-popup-empty">No properties</div>';
    }

    const rows = entries
      .map(([key, value]) => {
        const displayValue =
          value === null || value === undefined
            ? '<em>null</em>'
            : typeof value === 'object'
              ? this.escapeHtml(JSON.stringify(value))
              : this.escapeHtml(String(value));
        return `<tr><td class="geo-editor-popup-key">${this.escapeHtml(key)}</td><td class="geo-editor-popup-value">${displayValue}</td></tr>`;
      })
      .join('');

    return `<table class="geo-editor-popup-table"><tbody>${rows}</tbody></table>`;
  }

  /**
   * Escape HTML special characters
   */
  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // ============================================================================
  // Attribute Editing Panel
  // ============================================================================

  /**
   * Create the attribute editing panel DOM structure
   */
  private createAttributePanel(): void {
    if (this.attributePanel) return;

    const position = this.options.attributePanelPosition;
    const width = this.options.attributePanelWidth;
    const maxHeight = this.options.attributePanelMaxHeight;
    const top = this.options.attributePanelTop;
    const sideOffset = this.options.attributePanelSideOffset;

    this.attributePanel = document.createElement('div');
    this.attributePanel.className = `${CSS_PREFIX}-attribute-panel ${CSS_PREFIX}-attribute-panel--${position} ${CSS_PREFIX}-attribute-panel--hidden`;
    this.attributePanel.style.width = `${width}px`;
    this.attributePanel.style.maxHeight = typeof maxHeight === 'number' ? `${maxHeight}px` : maxHeight;
    this.attributePanel.style.top = `${top}px`;
    // Apply side offset based on position
    if (position === 'right') {
      this.attributePanel.style.right = `${sideOffset}px`;
    } else {
      this.attributePanel.style.left = `${sideOffset}px`;
    }

    // Header
    const header = document.createElement('div');
    header.className = `${CSS_PREFIX}-attribute-panel-header`;

    const title = document.createElement('h3');
    title.className = `${CSS_PREFIX}-attribute-panel-title`;
    title.textContent = this.options.attributePanelTitle;
    header.appendChild(title);

    const closeBtn = document.createElement('button');
    closeBtn.className = `${CSS_PREFIX}-attribute-panel-close`;
    closeBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M1 1l12 12M13 1L1 13"/></svg>';
    closeBtn.title = 'Close';
    closeBtn.addEventListener('click', () => this.hideAttributePanel());
    header.appendChild(closeBtn);

    this.attributePanel.appendChild(header);

    // Body
    const body = document.createElement('div');
    body.className = `${CSS_PREFIX}-attribute-panel-body`;
    body.setAttribute('data-panel-body', 'true');
    this.attributePanel.appendChild(body);

    // Footer
    const footer = document.createElement('div');
    footer.className = `${CSS_PREFIX}-attribute-panel-footer`;

    const cancelBtn = document.createElement('button');
    cancelBtn.className = `${CSS_PREFIX}-btn ${CSS_PREFIX}-btn--secondary`;
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => this.hideAttributePanel());
    footer.appendChild(cancelBtn);

    const saveBtn = document.createElement('button');
    saveBtn.className = `${CSS_PREFIX}-btn ${CSS_PREFIX}-btn--primary`;
    saveBtn.textContent = 'Save';
    saveBtn.setAttribute('data-save-btn', 'true');
    saveBtn.addEventListener('click', () => this.saveAttributeChanges());
    footer.appendChild(saveBtn);

    this.attributePanel.appendChild(footer);

    // Append to map container
    this.map.getContainer().appendChild(this.attributePanel);
  }

  /**
   * Remove the attribute panel from DOM
   */
  private removeAttributePanel(): void {
    if (this.attributePanel && this.attributePanel.parentNode) {
      this.attributePanel.parentNode.removeChild(this.attributePanel);
      this.attributePanel = null;
    }
  }

  /**
   * Show the attribute panel with feature data
   */
  private showAttributePanel(
    feature: Feature,
    geomanData?: GeomanFeatureData,
    isNew: boolean = false
  ): void {
    if (!this.attributePanel) return;

    this.currentEditingFeature = feature;
    this.currentEditingGeomanData = geomanData ?? null;
    this.isNewFeature = isNew;
    this.originalProperties = feature.properties ? { ...feature.properties } : {};

    // Build the form
    this.buildAttributeForm(feature);

    // Show the panel
    this.attributePanel.classList.remove(`${CSS_PREFIX}-attribute-panel--hidden`);
    this.attributePanelVisible = true;

    // Hide the properties popup if visible
    this.hideFeaturePropertiesPopup();
  }

  /**
   * Hide the attribute panel
   */
  private hideAttributePanel(): void {
    if (!this.attributePanel) return;

    this.attributePanel.classList.add(`${CSS_PREFIX}-attribute-panel--hidden`);
    this.attributePanelVisible = false;
    this.currentEditingFeature = null;
    this.currentEditingGeomanData = null;
    this.isNewFeature = false;
    this.originalProperties = null;
  }

  /**
   * Toggle attribute panel visibility
   */
  toggleAttributePanel(): void {
    if (this.attributePanelVisible) {
      this.hideAttributePanel();
    } else if (this.currentEditingFeature) {
      this.showAttributePanel(
        this.currentEditingFeature,
        this.currentEditingGeomanData ?? undefined,
        this.isNewFeature
      );
    }
  }

  /**
   * Get schema fields for a geometry type
   */
  private getSchemaFieldsForGeometry(geometryType: string): AttributeFieldDefinition[] {
    const schema = this.options.attributeSchema;
    if (!schema) return [];

    const fields: AttributeFieldDefinition[] = [];

    // Add geometry-specific fields
    if (geometryType === 'Polygon' || geometryType === 'MultiPolygon') {
      if (schema.polygon) fields.push(...schema.polygon);
    } else if (geometryType === 'LineString' || geometryType === 'MultiLineString') {
      if (schema.line) fields.push(...schema.line);
    } else if (geometryType === 'Point' || geometryType === 'MultiPoint') {
      if (schema.point) fields.push(...schema.point);
    }

    // Add common fields
    if (schema.common) fields.push(...schema.common);

    return fields;
  }

  /**
   * Get properties not defined in schema (extra properties)
   */
  private getExtraProperties(feature: Feature): Record<string, unknown> {
    const properties = feature.properties || {};
    const schemaFields = this.getSchemaFieldsForGeometry(feature.geometry.type);
    const schemaFieldNames = new Set(schemaFields.map(f => f.name));

    const extra: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(properties)) {
      // Skip internal properties and schema fields
      if (!key.startsWith('__') && !schemaFieldNames.has(key)) {
        extra[key] = value;
      }
    }
    return extra;
  }

  /**
   * Build the attribute form for a feature
   */
  private buildAttributeForm(feature: Feature): void {
    if (!this.attributePanel) return;

    const body = this.attributePanel.querySelector('[data-panel-body]');
    if (!body) return;

    body.innerHTML = '';

    const geometryType = feature.geometry.type;
    const schemaFields = this.getSchemaFieldsForGeometry(geometryType);
    const properties = feature.properties || {};

    // Add geometry type badge to header
    const header = this.attributePanel.querySelector(`.${CSS_PREFIX}-attribute-panel-header`);
    if (header) {
      // Remove existing badge
      const existingBadge = header.querySelector(`.${CSS_PREFIX}-attribute-geometry-badge`);
      if (existingBadge) existingBadge.remove();

      const badge = document.createElement('span');
      badge.className = `${CSS_PREFIX}-attribute-geometry-badge`;
      badge.textContent = this.getGeometryDisplayName(geometryType);
      const title = header.querySelector(`.${CSS_PREFIX}-attribute-panel-title`);
      if (title) title.appendChild(badge);
    }

    // Build schema fields
    if (schemaFields.length > 0) {
      schemaFields.forEach(field => {
        const value = properties[field.name];
        const formGroup = this.createFormField(field, value);
        body.appendChild(formGroup);
      });
    } else {
      // No schema defined - show empty message or all properties as editable
      const emptyMessage = document.createElement('div');
      emptyMessage.className = `${CSS_PREFIX}-attribute-empty`;
      emptyMessage.textContent = 'No attribute schema defined';
      body.appendChild(emptyMessage);
    }

    // Show extra properties (not in schema) as read-only
    const extraProps = this.getExtraProperties(feature);
    const extraKeys = Object.keys(extraProps);
    if (extraKeys.length > 0) {
      const extraSection = document.createElement('div');
      extraSection.className = `${CSS_PREFIX}-attribute-extra-section`;

      const sectionTitle = document.createElement('div');
      sectionTitle.className = `${CSS_PREFIX}-attribute-extra-section-title`;
      sectionTitle.textContent = 'Other Properties';
      extraSection.appendChild(sectionTitle);

      extraKeys.forEach(key => {
        const formGroup = this.createReadOnlyField(key, extraProps[key]);
        extraSection.appendChild(formGroup);
      });

      body.appendChild(extraSection);
    }
  }

  /**
   * Get display name for geometry type
   */
  private getGeometryDisplayName(geometryType: string): string {
    const names: Record<string, string> = {
      Point: 'Point',
      MultiPoint: 'Multi-Point',
      LineString: 'Line',
      MultiLineString: 'Multi-Line',
      Polygon: 'Polygon',
      MultiPolygon: 'Multi-Polygon',
      GeometryCollection: 'Collection',
    };
    return names[geometryType] || geometryType;
  }

  /**
   * Create a form field element
   */
  private createFormField(field: AttributeFieldDefinition, value: unknown): HTMLDivElement {
    const formGroup = document.createElement('div');
    formGroup.className = `${CSS_PREFIX}-attribute-form-group`;

    // Create label
    const label = document.createElement('label');
    label.className = `${CSS_PREFIX}-attribute-label`;
    if (field.required) {
      label.classList.add(`${CSS_PREFIX}-attribute-label--required`);
    }
    label.textContent = field.label || field.name;
    label.setAttribute('for', `attr-${field.name}`);
    formGroup.appendChild(label);

    // Create input based on type
    const input = this.createInputForFieldType(field, value);
    formGroup.appendChild(input);

    return formGroup;
  }

  /**
   * Create input element for a specific field type
   */
  private createInputForFieldType(field: AttributeFieldDefinition, value: unknown): HTMLElement {
    const id = `attr-${field.name}`;

    switch (field.type) {
      case 'boolean': {
        const wrapper = document.createElement('div');
        wrapper.className = `${CSS_PREFIX}-attribute-checkbox-wrapper`;

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.id = id;
        checkbox.name = field.name;
        checkbox.className = `${CSS_PREFIX}-attribute-checkbox`;
        checkbox.checked = value === true || value === 'true';
        checkbox.disabled = field.readOnly ?? false;
        wrapper.appendChild(checkbox);

        const checkboxLabel = document.createElement('label');
        checkboxLabel.className = `${CSS_PREFIX}-attribute-checkbox-label`;
        checkboxLabel.setAttribute('for', id);
        checkboxLabel.textContent = field.label || field.name;
        wrapper.appendChild(checkboxLabel);

        return wrapper;
      }

      case 'select': {
        const select = document.createElement('select');
        select.id = id;
        select.name = field.name;
        select.className = `${CSS_PREFIX}-attribute-select`;
        select.disabled = field.readOnly ?? false;

        // Add empty option if not required
        if (!field.required) {
          const emptyOption = document.createElement('option');
          emptyOption.value = '';
          emptyOption.textContent = '-- Select --';
          select.appendChild(emptyOption);
        }

        // Add options
        if (field.options) {
          field.options.forEach(opt => {
            const option = document.createElement('option');
            option.value = String(opt.value);
            option.textContent = opt.label;
            if (String(value) === String(opt.value)) {
              option.selected = true;
            }
            select.appendChild(option);
          });
        }

        return select;
      }

      case 'textarea': {
        const textarea = document.createElement('textarea');
        textarea.id = id;
        textarea.name = field.name;
        textarea.className = `${CSS_PREFIX}-attribute-textarea`;
        textarea.value = value != null ? String(value) : '';
        textarea.placeholder = field.placeholder || '';
        textarea.disabled = field.readOnly ?? false;
        return textarea;
      }

      case 'number': {
        const input = document.createElement('input');
        input.type = 'number';
        input.id = id;
        input.name = field.name;
        input.className = `${CSS_PREFIX}-attribute-input`;
        input.value = value != null ? String(value) : '';
        input.placeholder = field.placeholder || '';
        input.disabled = field.readOnly ?? false;
        if (field.min !== undefined) input.min = String(field.min);
        if (field.max !== undefined) input.max = String(field.max);
        if (field.step !== undefined) input.step = String(field.step);
        return input;
      }

      case 'date': {
        const input = document.createElement('input');
        input.type = 'date';
        input.id = id;
        input.name = field.name;
        input.className = `${CSS_PREFIX}-attribute-input`;
        input.value = value != null ? String(value) : '';
        input.disabled = field.readOnly ?? false;
        return input;
      }

      case 'color': {
        const input = document.createElement('input');
        input.type = 'color';
        input.id = id;
        input.name = field.name;
        input.className = `${CSS_PREFIX}-attribute-input`;
        input.value = value != null ? String(value) : '#000000';
        input.disabled = field.readOnly ?? false;
        return input;
      }

      case 'string':
      default: {
        const input = document.createElement('input');
        input.type = 'text';
        input.id = id;
        input.name = field.name;
        input.className = `${CSS_PREFIX}-attribute-input`;
        input.value = value != null ? String(value) : '';
        input.placeholder = field.placeholder || '';
        input.disabled = field.readOnly ?? false;
        return input;
      }
    }
  }

  /**
   * Create a read-only field for extra properties
   */
  private createReadOnlyField(name: string, value: unknown): HTMLDivElement {
    const formGroup = document.createElement('div');
    formGroup.className = `${CSS_PREFIX}-attribute-form-group`;

    const label = document.createElement('label');
    label.className = `${CSS_PREFIX}-attribute-label`;
    label.textContent = name;
    formGroup.appendChild(label);

    const display = document.createElement('div');
    display.className = `${CSS_PREFIX}-attribute-readonly`;

    if (value === null || value === undefined) {
      display.classList.add(`${CSS_PREFIX}-attribute-readonly-null`);
      display.textContent = 'null';
    } else if (typeof value === 'object') {
      display.textContent = JSON.stringify(value);
    } else {
      display.textContent = String(value);
    }

    formGroup.appendChild(display);
    return formGroup;
  }

  /**
   * Collect form values from the attribute panel
   */
  private collectFormValues(): Record<string, unknown> {
    if (!this.attributePanel || !this.currentEditingFeature) return {};

    const body = this.attributePanel.querySelector('[data-panel-body]');
    if (!body) return {};

    const values: Record<string, unknown> = {};
    const schemaFields = this.getSchemaFieldsForGeometry(this.currentEditingFeature.geometry.type);

    schemaFields.forEach(field => {
      const element = body.querySelector(`[name="${field.name}"]`) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null;
      if (!element) return;

      if (field.type === 'boolean') {
        values[field.name] = (element as HTMLInputElement).checked;
      } else if (field.type === 'number') {
        const numValue = element.value.trim();
        values[field.name] = numValue !== '' ? parseFloat(numValue) : null;
      } else {
        values[field.name] = element.value || null;
      }
    });

    return values;
  }

  /**
   * Validate form values
   */
  private validateFormValues(values: Record<string, unknown>): { valid: boolean; errors: Record<string, string> } {
    if (!this.currentEditingFeature) return { valid: true, errors: {} };

    const schemaFields = this.getSchemaFieldsForGeometry(this.currentEditingFeature.geometry.type);
    const errors: Record<string, string> = {};

    schemaFields.forEach(field => {
      if (field.required) {
        const value = values[field.name];
        if (value === null || value === undefined || value === '') {
          errors[field.name] = `${field.label || field.name} is required`;
        }
      }
    });

    return { valid: Object.keys(errors).length === 0, errors };
  }

  /**
   * Show validation errors on form fields
   */
  private showValidationErrors(errors: Record<string, string>): void {
    if (!this.attributePanel) return;

    const body = this.attributePanel.querySelector('[data-panel-body]');
    if (!body) return;

    // Clear existing errors
    body.querySelectorAll(`.${CSS_PREFIX}-attribute-error`).forEach(el => el.remove());
    body.querySelectorAll(`.${CSS_PREFIX}-attribute-input--error, .${CSS_PREFIX}-attribute-select--error, .${CSS_PREFIX}-attribute-textarea--error`)
      .forEach(el => {
        el.classList.remove(`${CSS_PREFIX}-attribute-input--error`);
        el.classList.remove(`${CSS_PREFIX}-attribute-select--error`);
        el.classList.remove(`${CSS_PREFIX}-attribute-textarea--error`);
      });

    // Show new errors
    Object.entries(errors).forEach(([fieldName, message]) => {
      const element = body.querySelector(`[name="${fieldName}"]`);
      if (element) {
        element.classList.add(`${CSS_PREFIX}-attribute-input--error`);
        const errorDiv = document.createElement('div');
        errorDiv.className = `${CSS_PREFIX}-attribute-error`;
        errorDiv.textContent = message;
        element.parentNode?.appendChild(errorDiv);
      }
    });
  }

  /**
   * Apply default values from schema to a feature
   */
  private applyDefaultValues(feature: Feature): void {
    const schemaFields = this.getSchemaFieldsForGeometry(feature.geometry.type);
    if (schemaFields.length === 0) return;

    if (!feature.properties) {
      feature.properties = {};
    }

    schemaFields.forEach(field => {
      if (field.defaultValue !== undefined && feature.properties![field.name] === undefined) {
        feature.properties![field.name] = field.defaultValue;
      }
    });
  }

  /**
   * Save attribute changes to the feature
   */
  private saveAttributeChanges(): void {
    if (!this.currentEditingFeature) return;

    const values = this.collectFormValues();
    const validation = this.validateFormValues(values);

    if (!validation.valid) {
      this.showValidationErrors(validation.errors);
      return;
    }

    // Merge with existing properties (preserve extra properties)
    const newProperties: GeoJsonProperties = {
      ...this.currentEditingFeature.properties,
      ...values,
    };

    // Update feature properties
    this.currentEditingFeature.properties = newProperties;

    // Update Geoman feature if available
    if (this.currentEditingGeomanData) {
      this.updateFeatureProperties(this.currentEditingGeomanData, newProperties);
    }

    // Fire callback
    const event: AttributeChangeEvent = {
      feature: this.currentEditingFeature,
      previousProperties: (this.originalProperties ?? {}) as GeoJsonProperties,
      newProperties,
      isNewFeature: this.isNewFeature,
    };
    this.options.onAttributeChange?.(event);

    // Hide the panel
    this.hideAttributePanel();
  }

  /**
   * Update Geoman feature properties
   */
  private updateFeatureProperties(geomanData: GeomanFeatureData, properties: GeoJsonProperties): void {
    // Get the current GeoJSON from Geoman
    const geoJson = geomanData.getGeoJson ? geomanData.getGeoJson() : geomanData.geoJson;
    if (geoJson) {
      geoJson.properties = properties;
    }
  }

  /**
   * Programmatically open attribute editor for a feature
   */
  openAttributeEditor(feature: Feature): void {
    if (!this.options.enableAttributeEditing) {
      console.warn('Attribute editing is not enabled');
      return;
    }

    const geomanData = this.findGeomanDataForFeature(feature);
    this.showAttributePanel(feature, geomanData ?? undefined, false);
  }

  /**
   * Close attribute editor
   */
  closeAttributeEditor(): void {
    this.hideAttributePanel();
  }

  /**
   * Dynamically set attribute schema
   */
  setAttributeSchema(schema: AttributeSchema): void {
    this.options.attributeSchema = schema;

    // Rebuild form if panel is visible
    if (this.attributePanelVisible && this.currentEditingFeature) {
      this.buildAttributeForm(this.currentEditingFeature);
    }
  }

  /**
   * Get the current attribute schema
   */
  getAttributeSchema(): AttributeSchema | undefined {
    return this.options.attributeSchema;
  }

  // ============================================================================
  // Advanced Edit Mode Implementations
  // ============================================================================

  /**
   * Enable scale mode
   */
  private enableScaleMode(): void {
    this.scaleTargetFeature = null;
    this.scaleTargetGeomanData = null;

    const selected = this.getSelectedFeatures();
    if (selected.length === 0) {
      console.warn('Select a feature to scale');
      return;
    }

    const geomanData = this.findGeomanDataForFeature(selected[0]);
    if (!geomanData) {
      console.warn('Selected feature is not managed by Geoman');
      return;
    }

    this.scaleTargetFeature = selected[0];
    this.scaleTargetGeomanData = geomanData;
    this.scaleFeature.showHandlesForFeature(selected[0]);
    this.bringScaleHandlesToFront();
    if (this.state.selectedFeatures.length > 0) {
      this.state.selectedFeatures[0] = {
        ...this.state.selectedFeatures[0],
        id: String(geomanData.id),
        geomanData,
      };
    }

    // Scale mode is interactive - the actual scaling happens in event handlers
    this.map.getCanvas().style.cursor = 'nwse-resize';
  }

  /**
   * Enable copy mode
   */
  private enableCopyMode(): void {
    this.copySelectedFeatures();
  }

  /**
   * Enable split mode
   */
  private enableSplitMode(): void {
    const selected = this.getSelectedFeatures();
    if (selected.length === 0) {
      console.warn('Select a polygon or line to split');
      return;
    }

    const feature = selected[0];
    if (!isPolygon(feature) && !isLine(feature)) {
      console.warn('Can only split polygons and lines');
      return;
    }

    this.splitFeature.startSplit(
      feature as Feature<Polygon | LineString>,
      (result: SplitResult) => {
        this.handleSplitResult(result);
      }
    );
  }

  /**
   * Enable lasso selection mode
   */
  private enableLassoMode(): void {
    this.lassoFeature.enable((result: LassoResult) => {
      this.handleLassoResult(result);
    });
  }

  /**
   * Execute union on selected polygons
   */
  private executeUnion(): void {
    const selected = this.getSelectedFeatures();
    const polygons = getPolygonFeatures(selected);

    if (polygons.length < 2) {
      console.warn('Select at least 2 polygons to merge');
      return;
    }

    const result = this.unionFeature.union(polygons);
    this.handleUnionResult(result);
  }

  /**
   * Execute difference on selected polygons
   */
  private executeDifference(): void {
    const selected = this.getSelectedFeatures();
    const polygons = getPolygonFeatures(selected);

    if (polygons.length < 2) {
      console.warn('Select at least 2 polygons (first is base, rest are subtracted)');
      return;
    }

    const [base, ...subtract] = polygons;
    const result = this.differenceFeature.difference(base, subtract);
    this.handleDifferenceResult(result);
  }

  /**
   * Execute simplify on selected features
   */
  private executeSimplify(): void {
    const selected = this.getSelectedFeatures();
    let targets = selected;

    if (targets.length === 0 && this.lastCreatedFeature) {
      targets = [this.lastCreatedFeature];
    }

    if (targets.length === 0) {
      console.warn('Select a feature to simplify');
      return;
    }

    const results = targets
      .map((feature) => this.getSimplifyResult(feature))
      .filter((result): result is SimplifyResult => Boolean(result));
    const shouldBatch = results.length > 1;

    if (results.length === 0) {
      console.warn('Simplify: no vertices removed with current tolerance');
      return;
    }

    results.forEach((result) => {
      this.applySimplifyResult(result, {
        clearSelection: !shouldBatch,
        disableModes: !shouldBatch,
      });
      this.logSelectedFeatureCollection('edited', result.result);
    });

    if (shouldBatch) {
      this.clearSelection();
      this.disableAllModes();
    }
  }

  private getSimplifyResult(feature: Feature): SimplifyResult | null {
    const base = this.simplifyFeature.simplifyWithStats(feature);
    if (base.verticesAfter < base.verticesBefore) {
      return base;
    }

    const tolerances = this.simplifyFeature.getSuggestedTolerances(feature);
    for (const tolerance of tolerances) {
      if (tolerance === this.options.simplifyTolerance) {
        continue;
      }
      const result = this.simplifyFeature.simplifyWithStats(feature, { tolerance });
      if (result.verticesAfter < result.verticesBefore) {
        return result;
      }
    }

    return null;
  }

  // ============================================================================
  // Copy/Paste Operations
  // ============================================================================

  /**
   * Copy selected features to clipboard
   */
  copySelectedFeatures(): void {
    const selected = this.getSelectedFeatures();
    if (selected.length === 0) {
      console.warn('No features selected to copy');
      return;
    }

    this.state.clipboard = this.copyFeature.copyMultiple(selected);
    this.emitEvent('gm:copy', { features: selected });
  }

  /**
   * Paste features from clipboard
   */
  pasteFeatures(): void {
    if (this.state.clipboard.length === 0) {
      console.warn('Clipboard is empty');
      return;
    }

    const pasted = this.copyFeature.copyMultiple(this.state.clipboard);

    // Add features to the map
    if (this.geoman) {
      pasted.forEach((feature) => {
        this.geoman?.features.importGeoJsonFeature(feature);
        this.options.onFeatureCreate?.(feature);
        this.lastCreatedFeature = feature;
      });
    }

    this.emitEvent('gm:paste', { features: pasted });
  }

  /**
   * Delete a feature by ID
   */
  private deleteFeatureById(featureId: string): void {
    if (!this.geoman) return;

    try {
      // Try to find and delete the feature
      const toDelete: GeomanFeatureData[] = [];
      this.geoman.features.forEach((fd) => {
        const feature = this.getGeomanFeature(fd);
        const featureProps = feature?.properties as { __gm_id?: string | number } | undefined;
        if (
          String(fd.id) === featureId ||
          String(feature?.id) === featureId ||
          String(featureProps?.__gm_id) === featureId
        ) {
          toDelete.push(fd);
        }
      });
      toDelete.forEach((fd) => {
        this.deleteGeomanFeatureData(fd);
      });
    } catch {
      // Silently fail if feature not found
    }
  }

  /**
   * Delete selected features
   */
  deleteSelectedFeatures(): void {
    const selected = this.state.selectedFeatures;
    if (selected.length === 0) {
      return;
    }

    selected.forEach((s) => {
      const geomanData = s.geomanData ?? this.findGeomanDataForFeature(s.feature);
      this.deleteGeomanFeatureData(geomanData, s.id);
      this.options.onFeatureDelete?.(s.id);
      this.lastDeletedFeature = s.feature;
      this.lastDeletedFeatureId = s.id;
      this.logSelectedFeatureCollection('deleted', s.feature);
    });

    this.clearSelection();
  }

  private deleteGeomanFeatureData(
    geomanData?: GeomanFeatureData | null,
    fallbackId?: string | null
  ): void {
    if (!this.geoman) return;

    if (geomanData) {
      try {
        this.geoman.features.delete(geomanData);
        return;
      } catch {
        // Continue with fallback delete
      }
      try {
        geomanData.delete();
        return;
      } catch {
        // Continue with fallback delete
      }
    }

    if (fallbackId) {
      this.deleteFeatureById(fallbackId);
    }
  }

  private deleteGeomanFeatures(features: Feature[]): void {
    features.forEach((feature) => {
      const geomanData = this.findGeomanDataForFeature(feature);
      const fallbackId = this.getGeomanIdFromFeature(feature);
      this.deleteGeomanFeatureData(geomanData, fallbackId ?? undefined);
      if (fallbackId) {
        this.options.onFeatureDelete?.(fallbackId);
      }
      this.lastDeletedFeature = feature;
      this.lastDeletedFeatureId = fallbackId ?? null;
      this.logSelectedFeatureCollection('deleted', feature);
    });
  }

  private clearGeomanTemporaryFeatures(): void {
    if (!this.geoman) return;

    try {
      if (typeof this.geoman.features.tmpForEach === 'function') {
        this.geoman.features.tmpForEach((fd) => {
          try {
            fd.delete();
          } catch {
            // Ignore delete errors for temporary features
          }
        });
        return;
      }

      this.geoman.features.forEach((fd) => {
        if (fd.temporary) {
          try {
            fd.delete();
          } catch {
            // Ignore delete errors for temporary features
          }
        }
      });
    } catch {
      // Ignore cleanup errors
    }
  }

  // ============================================================================
  // Result Handlers
  // ============================================================================

  private handleSplitResult(result: SplitResult): void {
    if (!result.success) {
      console.warn('Split failed:', result.error);
      return;
    }

    // Record composite operation before making changes
    this.recordCompositeOperation([result.original], result.parts, 'Split');

    // Set flag to prevent individual operations from being recorded
    this.isPerformingCompositeOperation = true;

    try {
      // Remove original feature using provided result data
      this.deleteGeomanFeatures([result.original]);
      this.clearGeomanTemporaryFeatures();
      this.clearSelection();

      // Add new parts
      if (this.geoman) {
        result.parts.forEach((part) => {
          this.geoman?.features.importGeoJsonFeature(part);
          this.options.onFeatureCreate?.(part);
          this.lastCreatedFeature = part;
          this.logSelectedFeatureCollection('created', part);
        });
      }
    } finally {
      this.isPerformingCompositeOperation = false;
    }

    this.emitEvent('gm:split', result);
    this.disableAllModes();
  }

  private handleUnionResult(result: UnionResult): void {
    if (!result.success || !result.result) {
      console.warn('Union failed:', result.error);
      return;
    }

    // Record composite operation before making changes
    this.recordCompositeOperation(result.originals, [result.result], 'Union');

    // Set flag to prevent individual operations from being recorded
    this.isPerformingCompositeOperation = true;

    try {
      // Remove original features using provided result data
      this.deleteGeomanFeatures(result.originals);
      this.clearGeomanTemporaryFeatures();
      this.clearSelection();

      // Add merged feature
      if (this.geoman) {
        this.geoman.features.importGeoJsonFeature(result.result);
        this.options.onFeatureCreate?.(result.result);
        this.lastCreatedFeature = result.result;
        this.logSelectedFeatureCollection('created', result.result);
      }
    } finally {
      this.isPerformingCompositeOperation = false;
    }

    this.emitEvent('gm:union', result);
    this.disableAllModes();
  }

  private handleDifferenceResult(result: DifferenceResult): void {
    if (!result.success) {
      console.warn('Difference failed:', result.error);
      return;
    }

    // Record composite operation before making changes
    const deletedFeatures = [result.base, ...result.subtracted];
    const createdFeatures = result.result ? [result.result] : [];
    this.recordCompositeOperation(deletedFeatures, createdFeatures, 'Difference');

    // Set flag to prevent individual operations from being recorded
    this.isPerformingCompositeOperation = true;

    try {
      // Remove original features using provided result data
      this.deleteGeomanFeatures([result.base, ...result.subtracted]);
      this.clearGeomanTemporaryFeatures();
      this.clearSelection();

      // Add result if not null (complete subtraction)
      if (result.result && this.geoman) {
        this.geoman.features.importGeoJsonFeature(result.result);
        this.options.onFeatureCreate?.(result.result);
        this.lastCreatedFeature = result.result;
        this.logSelectedFeatureCollection('created', result.result);
      }
    } finally {
      this.isPerformingCompositeOperation = false;
    }

    this.emitEvent('gm:difference', result);
    this.disableAllModes();
  }

  private applySimplifyResult(
    result: SimplifyResult,
    options: { clearSelection: boolean; disableModes: boolean }
  ): void {
    // Record composite operation before making changes (simplify is delete + create)
    this.recordCompositeOperation([result.original], [result.result], 'Simplify');

    // Set flag to prevent individual operations from being recorded
    this.isPerformingCompositeOperation = true;

    try {
      // Remove original feature
      this.deleteGeomanFeatures([result.original]);
      this.clearGeomanTemporaryFeatures();

      // Add simplified feature
      if (this.geoman) {
        result.result.id = this.getGeomanIdFromFeature(result.original) ?? result.result.id;
        this.geoman.features.importGeoJsonFeature(result.result);
        this.options.onFeatureEdit?.(result.result, result.original);
        this.lastEditedFeature = result.result;
      }
    } finally {
      this.isPerformingCompositeOperation = false;
    }

    this.emitEvent('gm:simplify', result);

    if (options.clearSelection) {
      this.clearSelection();
    }
    if (options.disableModes) {
      this.disableAllModes();
    }
  }

  private handleLassoResult(result: LassoResult): void {
    // Get all features and filter by lasso
    const allFeatures = this.getFeatures().features;
    const selected = this.lassoFeature.selectWithinLasso(
      result.lasso,
      allFeatures
    );

    this.selectFeatures(selected);
    this.emitEvent('gm:lassoend', { ...result, selected });
    this.disableAllModes();
  }

  // ============================================================================
  // UI Creation
  // ============================================================================

  /**
   * Create the toolbar UI
   */
  private createToolbar(): void {
    this.toolbar = document.createElement('div');
    this.toolbar.className = `${CSS_PREFIX}-toolbar ${CSS_PREFIX}-toolbar--${this.options.toolbarOrientation}`;

    // Add columns class for multi-column layout (only for vertical orientation)
    if (this.options.toolbarOrientation === 'vertical' && this.options.columns > 1) {
      this.toolbar.classList.add(`${CSS_PREFIX}-toolbar--columns-${this.options.columns}`);
    }

    // Add collapsed class if starting collapsed
    if (this.state.collapsed) {
      this.toolbar.classList.add(`${CSS_PREFIX}-toolbar--collapsed`);
    }

    // Collapse/expand button at the top
    const collapseBtn = this.createCollapseButton();
    this.toolbar.appendChild(collapseBtn);

    // Tool groups wrapper (can be hidden when collapsed)
    const toolsWrapper = document.createElement('div');
    toolsWrapper.className = `${CSS_PREFIX}-tools-wrapper`;

    // Draw tools group
    if (this.options.drawModes.length > 0) {
      const drawGroup = this.createToolGroup('Draw', this.options.drawModes, 'draw');
      toolsWrapper.appendChild(drawGroup);
    }

    // Edit tools group (basic)
    const basicEditModes = this.options.editModes.filter(
      (m) => !ADVANCED_EDIT_MODES.includes(m)
    );
    if (basicEditModes.length > 0) {
      const editGroup = this.createToolGroup('Edit', basicEditModes, 'edit');
      toolsWrapper.appendChild(editGroup);
    }

    // Advanced edit tools group
    const advancedModes = this.options.editModes.filter((m) =>
      ADVANCED_EDIT_MODES.includes(m)
    );
    if (advancedModes.length > 0) {
      const advancedGroup = this.createToolGroup('Advanced', advancedModes, 'edit');
      toolsWrapper.appendChild(advancedGroup);
    }

    // History tools group (undo/redo)
    if (this.historyManager) {
      const historyGroup = this.createHistoryToolsGroup();
      toolsWrapper.appendChild(historyGroup);
    }

    // Helper tools group (snapping)
    if (this.options.helperModes.includes('snapping')) {
      const helperGroup = this.createHelperToolsGroup();
      toolsWrapper.appendChild(helperGroup);
    }

    // File tools group (open/save GeoJSON)
    if (this.options.fileModes && this.options.fileModes.length > 0) {
      const fileGroup = this.createFileToolsGroup();
      toolsWrapper.appendChild(fileGroup);
    }

    const resetGroup = this.createResetToolsGroup();
    toolsWrapper.appendChild(resetGroup);

    this.toolbar.appendChild(toolsWrapper);

    // Apply initial collapsed state
    if (this.state.collapsed) {
      toolsWrapper.style.display = 'none';
    }

    this.container.appendChild(this.toolbar);
  }

  /**
   * Create the collapse/expand button
   */
  private createCollapseButton(): HTMLElement {
    const btn = document.createElement('button');
    btn.className = `${CSS_PREFIX}-tool-button ${CSS_PREFIX}-collapse-btn`;
    btn.title = this.state.collapsed ? 'Expand toolbar' : 'Collapse toolbar';
    const editIcon = '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" fill="currentColor"/></svg>';
    const collapseIcon = '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" fill="currentColor"/></svg>';
    btn.innerHTML = this.state.collapsed ? editIcon : collapseIcon;

    btn.addEventListener('click', () => {
      this.toggleCollapse();
      // Update button icon and title
      btn.innerHTML = this.state.collapsed ? editIcon : collapseIcon;
      btn.title = this.state.collapsed ? 'Expand toolbar' : 'Collapse toolbar';
    });

    return btn;
  }

  /**
   * Toggle toolbar collapsed state
   */
  toggleCollapse(): void {
    this.state.collapsed = !this.state.collapsed;

    if (this.toolbar) {
      // Toggle collapsed class on toolbar
      this.toolbar.classList.toggle(`${CSS_PREFIX}-toolbar--collapsed`, this.state.collapsed);

      const wrapper = this.toolbar.querySelector(`.${CSS_PREFIX}-tools-wrapper`) as HTMLElement;
      if (wrapper) {
        wrapper.style.display = this.state.collapsed ? 'none' : '';
      }
    }

    this._emitControlEvent(this.state.collapsed ? 'collapse' : 'expand');
  }

  /**
   * Check if toolbar is collapsed
   */
  isCollapsed(): boolean {
    return this.state.collapsed;
  }

  /**
   * Set toolbar collapsed state
   */
  setCollapsed(collapsed: boolean): void {
    if (this.state.collapsed !== collapsed) {
      this.toggleCollapse();
    }
  }

  /**
   * Expand the toolbar (show tools)
   */
  expand(): void {
    this.setCollapsed(false);
  }

  /**
   * Collapse the toolbar (hide tools)
   */
  collapse(): void {
    this.setCollapsed(true);
  }

  /**
   * Register an event handler.
   */
  on(event: string, handler: (data?: unknown) => void): void {
    if (!this._eventHandlers.has(event)) {
      this._eventHandlers.set(event, new Set());
    }
    this._eventHandlers.get(event)!.add(handler);
  }

  /**
   * Remove an event handler.
   */
  off(event: string, handler: (data?: unknown) => void): void {
    this._eventHandlers.get(event)?.delete(handler);
  }

  private _emitControlEvent(event: string, data?: unknown): void {
    const handlers = this._eventHandlers.get(event);
    if (handlers) {
      handlers.forEach((handler) => handler(data));
    }
  }

  /**
   * Create helper tools group (snapping toggle)
   */
  private createHelperToolsGroup(): HTMLElement {
    const group = document.createElement('div');
    group.className = `${CSS_PREFIX}-tool-group`;

    if (this.options.showLabels) {
      const groupLabel = document.createElement('div');
      groupLabel.className = `${CSS_PREFIX}-tool-group-label`;
      groupLabel.textContent = 'Helper';
      group.appendChild(groupLabel);
    }

    const buttons = document.createElement('div');
    buttons.className = `${CSS_PREFIX}-tool-buttons`;

    // Snapping toggle button
    const snappingBtn = document.createElement('button');
    snappingBtn.className = `${CSS_PREFIX}-tool-button`;
    snappingBtn.dataset.helper = 'snapping';
    snappingBtn.title = 'Toggle Snapping';
    snappingBtn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M7 3h4v6H7V3zm6 0h4v6h-4V3zM7 9h4v3a3 3 0 0 0 6 0V9h4v3a7 7 0 0 1-14 0V9z" fill="currentColor"/></svg>';

    // Set initial state from instance property
    if (this.snappingEnabled) {
      snappingBtn.classList.add(`${CSS_PREFIX}-tool-button--active`);
    }

    // Toggle snapping on click (independent of other mode changes)
    snappingBtn.addEventListener('click', (e) => {
      e.stopPropagation(); // Prevent event bubbling
      this.toggleSnapping();
      snappingBtn.classList.toggle(`${CSS_PREFIX}-tool-button--active`, this.snappingEnabled);
    });

    buttons.appendChild(snappingBtn);
    group.appendChild(buttons);
    return group;
  }

  private createResetToolsGroup(): HTMLElement {
    const group = document.createElement('div');
    group.className = `${CSS_PREFIX}-tool-group`;

    if (this.options.showLabels) {
      const groupLabel = document.createElement('div');
      groupLabel.className = `${CSS_PREFIX}-tool-group-label`;
      groupLabel.textContent = 'Reset';
      group.appendChild(groupLabel);
    }

    const buttons = document.createElement('div');
    buttons.className = `${CSS_PREFIX}-tool-buttons`;

    const resetBtn = document.createElement('button');
    resetBtn.className = `${CSS_PREFIX}-tool-button`;
    resetBtn.title = 'Clear selection and disable tools';
    resetBtn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M12 5a7 7 0 1 1-6.32 4H3l3.5-3.5L10 9H7.74A5 5 0 1 0 12 7v2l3-3-3-3v2z" fill="currentColor"/></svg>';
    resetBtn.addEventListener('click', () => {
      this.disableAllModes();
      this.clearSelection();
      this.updateToolbarState();
    });

    buttons.appendChild(resetBtn);
    group.appendChild(buttons);
    return group;
  }

  /**
   * Create file tools group (open/save GeoJSON)
   */
  private createFileToolsGroup(): HTMLElement {
    const group = document.createElement('div');
    group.className = `${CSS_PREFIX}-tool-group`;

    if (this.options.showLabels) {
      const groupLabel = document.createElement('div');
      groupLabel.className = `${CSS_PREFIX}-tool-group-label`;
      groupLabel.textContent = 'File';
      group.appendChild(groupLabel);
    }

    const buttons = document.createElement('div');
    buttons.className = `${CSS_PREFIX}-tool-buttons`;

    // Open button
    if (this.options.fileModes.includes('open')) {
      const openBtn = document.createElement('button');
      openBtn.className = `${CSS_PREFIX}-tool-button`;
      openBtn.dataset.file = 'open';
      openBtn.title = 'Open GeoJSON file';
      openBtn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M20 6h-8l-2-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm0 12H4V8h16v10z" fill="currentColor"/></svg>';
      openBtn.addEventListener('click', () => this.openFileDialog());
      buttons.appendChild(openBtn);
    }

    // Save button
    if (this.options.fileModes.includes('save')) {
      const saveBtn = document.createElement('button');
      saveBtn.className = `${CSS_PREFIX}-tool-button`;
      saveBtn.dataset.file = 'save';
      saveBtn.title = 'Save GeoJSON file';
      saveBtn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M17 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V7l-4-4zm2 16H5V5h11.17L19 7.83V19zm-7-7c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3zM6 6h9v4H6V6z" fill="currentColor"/></svg>';
      saveBtn.addEventListener('click', () => this.saveGeoJson());
      buttons.appendChild(saveBtn);
    }

    group.appendChild(buttons);
    return group;
  }

  /**
   * Setup hidden file input for file dialog
   */
  private setupFileInput(): void {
    this.fileInput = document.createElement('input');
    this.fileInput.type = 'file';
    this.fileInput.accept = '.geojson,.json,application/geo+json,application/json';
    this.fileInput.style.display = 'none';
    this.fileInput.addEventListener('change', (e) => this.handleFileSelect(e));
    document.body.appendChild(this.fileInput);
  }

  /**
   * Open file dialog to select GeoJSON file
   */
  openFileDialog(): void {
    if (this.fileInput) {
      this.fileInput.click();
    }
  }

  /**
   * Handle file selection from file dialog
   */
  private handleFileSelect(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];

    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string;
        const geoJson = JSON.parse(content);
        this.loadGeoJson(geoJson, file.name);
      } catch (error) {
        console.error('GeoEditor: Failed to parse GeoJSON file:', error);

        const errorInfo = {
          filename: file.name,
          message: error instanceof Error ? error.message : String(error),
          error,
        };

        // Emit an event so applications can provide user-facing error feedback
        this.emitEvent('gm:geojsonloaderror', errorInfo);
      }
    };
    reader.readAsText(file);

    // Reset the input so the same file can be selected again
    input.value = '';
  }

  /**
   * Load GeoJSON data into the editor
   * @param geoJson - FeatureCollection or Feature to load
   * @param filename - Optional filename for logging
   * @returns Result of the load operation
   */
  loadGeoJson(geoJson: FeatureCollection | Feature, filename: string = 'loaded.geojson'): GeoJsonLoadResult {
    if (!this.geoman) {
      throw new Error('Geoman not initialized');
    }

    // Clear existing features
    try {
      this.geoman.features.deleteAll();
    } catch {
      // Fallback: delete features one by one
      this.geoman.features.forEach((fd) => {
        try {
          fd.delete();
        } catch {
          /* ignore */
        }
      });
    }
    this.clearSelection();

    // Normalize to FeatureCollection
    let featureCollection: FeatureCollection;
    if (geoJson.type === 'Feature') {
      featureCollection = {
        type: 'FeatureCollection',
        features: [geoJson as Feature],
      };
    } else if (geoJson.type === 'FeatureCollection') {
      featureCollection = geoJson as FeatureCollection;
    } else {
      throw new Error('Invalid GeoJSON: expected Feature or FeatureCollection');
    }

    // Import the features
    const importResult = this.geoman.features.importGeoJson(featureCollection);

    const result: GeoJsonLoadResult = {
      features: featureCollection.features,
      count: importResult.success,
      filename,
    };

    // Fit bounds to show all features
    if (this.options.fitBoundsOnLoad && featureCollection.features.length > 0) {
      this.fitBoundsToFeatures(featureCollection);
    }

    // Call callback
    this.options.onGeoJsonLoad?.(result);

    // Emit event
    this.emitEvent('gm:geojsonload', result);

    console.log(`GeoEditor: Loaded ${result.count} features from ${filename}`);

    return result;
  }

  /**
   * Fit the map bounds to show all features in a FeatureCollection
   */
  private fitBoundsToFeatures(featureCollection: FeatureCollection): void {
    if (!featureCollection.features || featureCollection.features.length === 0) {
      return;
    }

    try {
      // Calculate bounding box using turf.bbox
      const bbox = turf.bbox(featureCollection) as [number, number, number, number];

      // Check if bbox is valid (not infinite or NaN)
      if (!this.isValidBBox(bbox)) {
        console.warn('GeoEditor: Invalid bounding box for loaded features');
        return;
      }

      // Convert to LngLatBoundsLike format: [[west, south], [east, north]]
      const bounds: [[number, number], [number, number]] = [
        [bbox[0], bbox[1]], // southwest
        [bbox[2], bbox[3]], // northeast
      ];

      // Apply fitBounds with configured options
      this.map.fitBounds(bounds, {
        padding: 50,
        maxZoom: 18,
        duration: 500,
      });
    } catch (error) {
      console.warn('GeoEditor: Failed to fit bounds to features:', error);
    }
  }

  /**
   * Check if a bounding box is valid
   */
  private isValidBBox(bbox: [number, number, number, number]): boolean {
    return (
      bbox.every((v) => isFinite(v) && !isNaN(v)) &&
      bbox[0] <= bbox[2] && // west <= east
      bbox[1] <= bbox[3] // south <= north
    );
  }

  /**
   * Fit the map to show all current features
   */
  fitToAllFeatures(): void {
    const featureCollection = this.getFeatures();
    if (featureCollection.features.length === 0) {
      console.warn('GeoEditor: No features to fit bounds to');
      return;
    }
    this.fitBoundsToFeatures(featureCollection);
  }

  /**
   * Save current features as GeoJSON file download
   * @param filename - Optional filename for download
   * @returns Result of the save operation
   */
  saveGeoJson(filename?: string): GeoJsonSaveResult {
    const featureCollection = this.getFeatures();
    const saveFilename = filename || this.options.saveFilename || 'features.geojson';

    // Create blob and download
    const blob = new Blob([JSON.stringify(featureCollection, null, 2)], {
      type: 'application/geo+json',
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = saveFilename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    const result: GeoJsonSaveResult = {
      featureCollection,
      count: featureCollection.features.length,
      filename: saveFilename,
    };

    // Call callback
    this.options.onGeoJsonSave?.(result);

    // Emit event
    this.emitEvent('gm:geojsonsave', result);

    console.log(`GeoEditor: Saved ${result.count} features to ${saveFilename}`);

    return result;
  }

  /**
   * Toggle snapping on/off (independent of other modes)
   * Note: Snapping functionality requires Geoman Pro. In the free version,
   * this toggle tracks state but does not enable actual vertex snapping.
   */
  toggleSnapping(): void {
    this.snappingEnabled = !this.snappingEnabled;

    this.applySnappingState();
  }

  /**
   * Check if snapping is enabled
   */
  isSnappingEnabled(): boolean {
    return this.snappingEnabled;
  }

  /**
   * Set snapping state
   */
  setSnapping(enabled: boolean): void {
    this.snappingEnabled = enabled;
    this.applySnappingState();
  }

  private applySnappingState(): void {
    if (!this.geoman) {
      return;
    }

    try {
      if (typeof this.geoman.enableMode === 'function') {
        if (this.snappingEnabled) {
          this.geoman.enableMode('helper', 'snapping');
        } else {
          this.geoman.disableMode('helper', 'snapping');
        }
        return;
      }

      // Fallback for older APIs
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const gm = this.geoman as any;
      if (typeof gm.setGlobalOptions === 'function') {
        gm.setGlobalOptions({ snapping: this.snappingEnabled });
      } else if (typeof gm.enableSnapping === 'function' && this.snappingEnabled) {
        gm.enableSnapping();
      } else if (typeof gm.disableSnapping === 'function' && !this.snappingEnabled) {
        gm.disableSnapping();
      }
    } catch {
      console.info('Snapping toggle: Geoman version does not support snapping.');
    }
  }

  /**
   * Create a tool group
   */
  private createToolGroup(
    label: string,
    modes: (DrawMode | EditMode)[],
    type: 'draw' | 'edit'
  ): HTMLElement {
    const group = document.createElement('div');
    group.className = `${CSS_PREFIX}-tool-group`;

    if (this.options.showLabels) {
      const groupLabel = document.createElement('div');
      groupLabel.className = `${CSS_PREFIX}-tool-group-label`;
      groupLabel.textContent = label;
      group.appendChild(groupLabel);
    }

    const buttons = document.createElement('div');
    buttons.className = `${CSS_PREFIX}-tool-buttons`;

    modes.forEach((mode) => {
      const button = this.createToolButton(mode, type);
      buttons.appendChild(button);
    });

    group.appendChild(buttons);
    return group;
  }

  /**
   * Create a tool button
   */
  private createToolButton(
    mode: DrawMode | EditMode,
    type: 'draw' | 'edit'
  ): HTMLElement {
    const button = document.createElement('button');
    button.className = `${CSS_PREFIX}-tool-button`;
    button.dataset.mode = mode;
    button.dataset.type = type;
    button.title = this.getModeLabel(mode);
    button.innerHTML = this.getModeIcon(mode);

    button.addEventListener('click', () => {
      if (type === 'draw') {
        this.enableDrawMode(mode as DrawMode);
      } else {
        this.enableEditMode(mode as EditMode);
      }
    });

    return button;
  }

  /**
   * Update toolbar button states
   */
  private updateToolbarState(): void {
    const buttons = this.container.querySelectorAll(`.${CSS_PREFIX}-tool-button`);
    buttons.forEach((btn) => {
      const button = btn as HTMLButtonElement;
      const mode = button.dataset.mode;
      const type = button.dataset.type;
      const helper = button.dataset.helper;

      // Skip helper buttons (snapping) - they manage their own state
      if (helper) return;

      let isActive = false;

      if (type === 'draw') {
        isActive = mode === this.state.activeDrawMode;
      } else if (type === 'edit') {
        // Special handling for select mode
        if (mode === 'select') {
          isActive = this.isSelectMode;
        } else if (mode === 'union') {
          // Union is active when in pending union mode
          isActive = this.pendingOperation === 'union';
        } else if (mode === 'difference') {
          // Difference is active when in pending difference mode
          isActive = this.pendingOperation === 'difference';
        } else {
          isActive = mode === this.state.activeEditMode;
        }
      }

      button.classList.toggle(`${CSS_PREFIX}-tool-button--active`, isActive);

      // Clear any inline styles that might conflict with CSS - let CSS handle colors
      const svg = button.querySelector('svg');
      if (svg) {
        svg.querySelectorAll('path, polygon, rect, circle, ellipse, line, text').forEach((el) => {
          const element = el as SVGElement;
          // Remove inline styles to let CSS take over
          element.style.fill = '';
          element.style.stroke = '';
        });
      }
    });
  }

  /**
   * Get human-readable label for a mode
   */
  private getModeLabel(mode: DrawMode | EditMode): string {
    const labels: Record<string, string> = {
      // Draw modes
      marker: 'Marker',
      circle: 'Circle',
      circle_marker: 'Circle Marker',
      ellipse: 'Ellipse',
      text_marker: 'Text',
      line: 'Line',
      rectangle: 'Rectangle',
      polygon: 'Polygon',
      freehand: 'Freehand',
      // Edit modes
      select: 'Select (click features)',
      drag: 'Drag',
      change: 'Edit',
      rotate: 'Rotate',
      cut: 'Cut',
      delete: 'Delete',
      scale: 'Scale',
      copy: 'Copy',
      split: 'Split',
      union: 'Union (select 2+ polygons)',
      difference: 'Difference (select 2+ polygons)',
      simplify: 'Simplify',
      lasso: 'Lasso Select',
    };
    return labels[mode] || mode;
  }

  /**
   * Get SVG icon for a mode
   */
  private getModeIcon(mode: DrawMode | EditMode): string {
    // Simple SVG icons
    const icons: Record<string, string> = {
      polygon: '<svg viewBox="0 0 24 24" width="18" height="18"><polygon points="12,2 22,8 18,22 6,22 2,8" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
      line: '<svg viewBox="0 0 24 24" width="18" height="18"><line x1="4" y1="20" x2="20" y2="4" stroke="currentColor" stroke-width="2"/></svg>',
      rectangle: '<svg viewBox="0 0 24 24" width="18" height="18"><rect x="3" y="5" width="18" height="14" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
      circle: '<svg viewBox="0 0 24 24" width="18" height="18"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
      marker: '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
      select: '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M4 3l6 14 2-6 6-2L4 3z" fill="currentColor"/><path d="M12.5 13.5l4.5 4.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
      drag: '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M10 9h4V6h3l-5-5-5 5h3v3zm-1 1H6V7l-5 5 5 5v-3h3v-4zm14 2l-5-5v3h-3v4h3v3l5-5zm-9 3h-4v3H7l5 5 5-5h-3v-3z" fill="currentColor"/></svg>',
      change: '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a.996.996 0 0 0 0-1.41l-2.34-2.34a.996.996 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" fill="currentColor"/></svg>',
      rotate: '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z" fill="currentColor"/></svg>',
      cut: '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M9.64 7.64c.23-.5.36-1.05.36-1.64 0-2.21-1.79-4-4-4S2 3.79 2 6s1.79 4 4 4c.59 0 1.14-.13 1.64-.36L10 12l-2.36 2.36C7.14 14.13 6.59 14 6 14c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4c0-.59-.13-1.14-.36-1.64L12 14l7 7h3v-1L9.64 7.64z" fill="currentColor"/></svg>',
      delete: '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" fill="currentColor"/></svg>',
      scale: '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M21 15h2v2h-2v-2zm0-4h2v2h-2v-2zm2 8h-2v2c1 0 2-1 2-2zM13 3h2v2h-2V3zm8 4h2v2h-2V7zm0-4v2h2c0-1-1-2-2-2zM1 7h2v2H1V7zm16-4h2v2h-2V3zm0 16h2v2h-2v-2zM3 3C2 3 1 4 1 5h2V3zm6 0h2v2H9V3zM5 3h2v2H5V3zm-4 8v8c0 1.1.9 2 2 2h12V11H1z" fill="currentColor"/></svg>',
      copy: '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z" fill="currentColor"/></svg>',
      split: '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M14 4l2.29 2.29-2.88 2.88 1.42 1.42 2.88-2.88L20 10V4h-6zm-4 0H4v6l2.29-2.29 4.71 4.7V20h2v-8.41l-5.29-5.3L10 4z" fill="currentColor"/></svg>',
      union: '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M4 4h7v7H4V4zm9 0h7v7h-7V4zm-9 9h7v7H4v-7zm9 0h7v7h-7v-7z" fill="currentColor"/></svg>',
      difference: '<svg viewBox="0 0 24 24" width="18" height="18"><rect x="4" y="4" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2"/><rect x="10" y="10" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2"/><path d="M13 7h6v2h-6z" fill="currentColor"/></svg>',
      simplify: '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M4 17l5-5 3 3 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 6h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
      lasso: '<svg viewBox="0 0 24 24" width="18" height="18"><ellipse cx="12" cy="10" rx="8" ry="6" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="4 2"/><circle cx="12" cy="18" r="3" fill="currentColor"/></svg>',
      freehand: '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25z" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
      circle_marker: '<svg viewBox="0 0 24 24" width="18" height="18"><circle cx="12" cy="12" r="4" fill="currentColor"/></svg>',
      ellipse: '<svg viewBox="0 0 24 24" width="18" height="18"><ellipse cx="12" cy="12" rx="10" ry="6" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
      text_marker: '<svg viewBox="0 0 24 24" width="18" height="18"><text x="12" y="16" text-anchor="middle" font-size="14" fill="currentColor">T</text></svg>',
    };
    return icons[mode] || `<span>${mode[0].toUpperCase()}</span>`;
  }

  // ============================================================================
  // Keyboard Shortcuts
  // ============================================================================

  private setupKeyboardShortcuts(): void {
    this.boundKeyHandler = (e: KeyboardEvent) => {
      // Check whether the event target is an input, textarea, or other editable content.
      const isInputField =
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        (e.target instanceof HTMLElement && e.target.isContentEditable);

      // Ctrl/Cmd + Z - Undo
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        this.undo();
        e.preventDefault();
        return;
      }
      // Ctrl/Cmd + Y or Ctrl/Cmd + Shift + Z - Redo
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey) || (e.key === 'Z' && e.shiftKey))) {
        this.redo();
        e.preventDefault();
        return;
      }
      // Ctrl/Cmd + C
      if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
        this.copySelectedFeatures();
        e.preventDefault();
      }
      // Ctrl/Cmd + V
      if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
        this.pasteFeatures();
        e.preventDefault();
      }
      // Delete
      if ((e.key === 'Delete' || e.key === 'Backspace') && !isInputField && !(e.target instanceof Element && e.target.closest(`.${CSS_PREFIX}-attribute-panel`))) {
        this.deleteSelectedFeatures();
        e.preventDefault();
      }

      // Enter - execute pending operation (union/difference)
      if (e.key === 'Enter' && this.pendingOperation) {
        this.executePendingOperation();
        e.preventDefault();
      }
      // Escape
      if (e.key === 'Escape') {
        if (this.pendingOperation) {
          this.cancelPendingOperation();
        } else {
          this.disableAllModes();
          this.clearSelection();
        }
      }
    };

    document.addEventListener('keydown', this.boundKeyHandler);
  }

  private removeKeyboardShortcuts(): void {
    if (this.boundKeyHandler) {
      document.removeEventListener('keydown', this.boundKeyHandler);
      this.boundKeyHandler = null;
    }
  }

  // ============================================================================
  // Geoman Integration
  // ============================================================================

  private setupGeomanEvents(): void {
    if (!this.geoman) return;

    this.geoman.setGlobalEventsListener((event) => {
      const eventName = (event as { name?: string; type?: string }).name ?? event.type ?? '';
      const eventFeature = this.extractFeatureFromEvent((event as { feature?: unknown }).feature);
      const eventAction = (event as { action?: string }).action ?? '';

      // Handle feature creation
      if ((eventName === 'gm:create' || event.type === 'gm:create') && eventFeature) {
        this.lastCreatedFeature = eventFeature;
        this.options.onFeatureCreate?.(eventFeature);
        this.logSelectedFeatureCollection('created', eventFeature);
        // Record create operation in history
        this.recordCreateOperation(eventFeature);

        // Show attribute panel for newly created feature
        if (this.options.enableAttributeEditing) {
          this.applyDefaultValues(eventFeature);
          const geomanData = this.findGeomanDataForFeature(eventFeature);
          this.showAttributePanel(eventFeature, geomanData ?? undefined, true);
        }
      }

      // Handle feature edit start - store pre-edit state
      if (eventAction === 'feature_edit_start' && eventFeature) {
        this.pendingEditFeature = turf.clone(eventFeature);
      }

      // Handle feature edit end
      if (eventAction === 'feature_edit_end' && eventFeature) {
        this.lastEditedFeature = eventFeature;
        this.logSelectedFeatureCollection('edited', eventFeature);
        // Record edit operation in history
        if (this.pendingEditFeature) {
          this.recordEditOperation(this.pendingEditFeature, eventFeature);
          this.pendingEditFeature = null;
        }
      }

      // Handle feature removed
      if (eventAction === 'feature_removed' && eventFeature) {
        this.lastDeletedFeature = eventFeature;
        this.lastDeletedFeatureId = this.getGeomanIdFromFeature(eventFeature);
        this.logSelectedFeatureCollection('deleted', eventFeature);
        // Record delete operation in history
        this.recordDeleteOperation(eventFeature);
      }

      // Handle mode changes
      if (eventName.includes('modetoggled') || event.type?.includes('modetoggled')) {
        this.updateToolbarState();
      }
    });
  }

  // ============================================================================
  // Event Emission
  // ============================================================================

  private emitEvent(type: string, detail: unknown): void {
    const event = new CustomEvent(type, { detail });
    this.map.getContainer().dispatchEvent(event);
  }

  // ============================================================================
  // History Management (Undo/Redo)
  // ============================================================================

  /**
   * Undo the last operation.
   * @returns true if undo was successful, false if nothing to undo
   */
  undo(): boolean {
    if (!this.historyManager) {
      return false;
    }
    return this.historyManager.undo();
  }

  /**
   * Redo the last undone operation.
   * @returns true if redo was successful, false if nothing to redo
   */
  redo(): boolean {
    if (!this.historyManager) {
      return false;
    }
    return this.historyManager.redo();
  }

  /**
   * Check if undo is available.
   */
  canUndo(): boolean {
    return this.historyManager?.canUndo() ?? false;
  }

  /**
   * Check if redo is available.
   */
  canRedo(): boolean {
    return this.historyManager?.canRedo() ?? false;
  }

  /**
   * Clear all history.
   */
  clearHistory(): void {
    this.historyManager?.clear();
  }

  /**
   * Get the current history state.
   * @returns History state with canUndo, canRedo, and counts, or null if history is disabled
   */
  getHistoryState(): HistoryState | null {
    return this.historyManager?.getState() ?? null;
  }

  /**
   * Get the command context for creating commands.
   */
  private getCommandContext(): CommandContext | null {
    if (!this.geoman) {
      return null;
    }

    return {
      featuresApi: this.geoman.features,
      onFeatureCreate: this.options.onFeatureCreate,
      onFeatureDelete: this.options.onFeatureDelete,
      onFeatureEdit: this.options.onFeatureEdit,
    };
  }

  /**
   * Record a create operation in history.
   */
  private recordCreateOperation(feature: Feature): void {
    if (!this.historyManager || this.historyManager.isExecutingCommand() || this.isPerformingCompositeOperation) {
      return;
    }

    const context = this.getCommandContext();
    if (!context) {
      return;
    }

    const command = new CreateFeatureCommand(feature, context);
    this.historyManager.record(command);
  }

  /**
   * Record an edit operation in history.
   */
  private recordEditOperation(oldFeature: Feature, newFeature: Feature): void {
    if (!this.historyManager || this.historyManager.isExecutingCommand() || this.isPerformingCompositeOperation) {
      return;
    }

    const context = this.getCommandContext();
    if (!context) {
      return;
    }

    const command = new EditFeatureCommand(oldFeature, newFeature, context);
    this.historyManager.record(command);
  }

  /**
   * Record a delete operation in history.
   */
  private recordDeleteOperation(feature: Feature): void {
    if (!this.historyManager || this.historyManager.isExecutingCommand() || this.isPerformingCompositeOperation) {
      return;
    }

    const context = this.getCommandContext();
    if (!context) {
      return;
    }

    const command = new DeleteFeatureCommand(feature, context);
    this.historyManager.record(command);
  }

  /**
   * Record a composite operation (union, difference, split) in history.
   */
  private recordCompositeOperation(
    deletedFeatures: Feature[],
    createdFeatures: Feature[],
    description: string
  ): void {
    if (!this.historyManager || this.historyManager.isExecutingCommand()) {
      return;
    }

    const context = this.getCommandContext();
    if (!context) {
      return;
    }

    const commands: (DeleteFeatureCommand | CreateFeatureCommand)[] = [];

    // Add delete commands for original features
    for (const feature of deletedFeatures) {
      commands.push(new DeleteFeatureCommand(feature, context));
    }

    // Add create commands for new features
    for (const feature of createdFeatures) {
      commands.push(new CreateFeatureCommand(feature, context));
    }

    const composite = new CompositeCommand(commands, description);
    this.historyManager.record(composite);
  }

  /**
   * Update history button states (enabled/disabled).
   */
  private updateHistoryButtonStates(canUndo: boolean, canRedo: boolean): void {
    const undoBtn = this.container.querySelector('[data-history="undo"]') as HTMLButtonElement | null;
    const redoBtn = this.container.querySelector('[data-history="redo"]') as HTMLButtonElement | null;

    if (undoBtn) {
      undoBtn.disabled = !canUndo;
    }
    if (redoBtn) {
      redoBtn.disabled = !canRedo;
    }
  }

  /**
   * Create the history tools group (undo/redo buttons).
   */
  private createHistoryToolsGroup(): HTMLElement {
    const group = document.createElement('div');
    group.className = `${CSS_PREFIX}-tool-group`;

    if (this.options.showLabels) {
      const groupLabel = document.createElement('div');
      groupLabel.className = `${CSS_PREFIX}-tool-group-label`;
      groupLabel.textContent = 'History';
      group.appendChild(groupLabel);
    }

    const buttons = document.createElement('div');
    buttons.className = `${CSS_PREFIX}-tool-buttons`;

    // Undo button
    const undoBtn = document.createElement('button');
    undoBtn.className = `${CSS_PREFIX}-tool-button`;
    undoBtn.dataset.history = 'undo';
    undoBtn.title = 'Undo (Ctrl+Z)';
    undoBtn.disabled = true;
    undoBtn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M12.5 8c-2.65 0-5.05 1.04-6.93 2.75L2.5 7.69v7.81h7.81l-3.12-3.12c1.36-1.2 3.13-1.88 5.04-1.88 3.31 0 6.13 2.04 7.31 4.94l2.33-.91C20.32 10.93 16.73 8 12.5 8z" fill="currentColor"/></svg>';
    undoBtn.addEventListener('click', () => this.undo());
    buttons.appendChild(undoBtn);

    // Redo button
    const redoBtn = document.createElement('button');
    redoBtn.className = `${CSS_PREFIX}-tool-button`;
    redoBtn.dataset.history = 'redo';
    redoBtn.title = 'Redo (Ctrl+Y)';
    redoBtn.disabled = true;
    redoBtn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M18.43 10.75C16.55 9.04 14.15 8 11.5 8c-4.23 0-7.82 2.93-9.37 6.53l2.33.91c1.18-2.9 4-4.94 7.31-4.94 1.91 0 3.68.68 5.04 1.88l-3.12 3.12h7.81V7.69l-3.07 3.06z" fill="currentColor"/></svg>';
    redoBtn.addEventListener('click', () => this.redo());
    buttons.appendChild(redoBtn);

    group.appendChild(buttons);
    return group;
  }
}
