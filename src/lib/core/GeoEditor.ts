import type { IControl, Map as MapLibreMap, MapMouseEvent, GeoJSONSource } from 'maplibre-gl';
import type { Feature, FeatureCollection, Polygon, LineString, Point } from 'geojson';
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
} from './types';
import { DEFAULT_OPTIONS, CSS_PREFIX, ADVANCED_EDIT_MODES, INTERNAL_IDS } from './constants';
import {
  CopyFeature,
  SimplifyFeature,
  UnionFeature,
  DifferenceFeature,
  ScaleFeature,
  LassoFeature,
  SplitFeature,
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

    // Create container
    this.container = document.createElement('div');
    this.container.className = `maplibregl-ctrl maplibregl-ctrl-group ${CSS_PREFIX}-control`;

    // Create toolbar
    this.createToolbar();

    // Setup keyboard shortcuts
    this.setupKeyboardShortcuts();

    // Setup selection handler
    this.setupSelectionHandler();
    this.setupScaleHandler();
    this.setupMultiDragHandler();

    // Setup geoman event listener if geoman is available
    this.setupGeomanEvents();

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
    this.disableAllModes();

    // Cleanup feature handlers
    this.scaleFeature.destroy();
    this.lassoFeature.destroy();
    this.splitFeature.destroy();

    if (this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
    }

    // @ts-expect-error - cleanup
    this.map = undefined;
  }

  /**
   * Set the Geoman instance for integration
   */
  setGeoman(geoman: GeomanInstance): void {
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
   * Find a feature at a given point
   */
  private findFeatureAtPoint(lng: number, lat: number): { feature: Feature; geomanData: GeomanFeatureData } | null {
    if (!this.geoman) {
      return null;
    }

    const clickPoint: [number, number] = [lng, lat];
    const point = turf.point(clickPoint);
    let result: { feature: Feature; geomanData: GeomanFeatureData } | null = null;

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
          isHit = distance < 0.5;
        } else if (feature.geometry.type === 'Polygon' || feature.geometry.type === 'MultiPolygon') {
          const inside = turf.booleanPointInPolygon(point, feature as Feature<Polygon>);
          isHit = inside;
        } else if (feature.geometry.type === 'LineString' || feature.geometry.type === 'MultiLineString') {
          const nearestPoint = turf.nearestPointOnLine(feature as Feature<LineString>, point);
          isHit = nearestPoint.properties.dist !== undefined && nearestPoint.properties.dist < 0.1;
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

      if (feature) {
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
      this.addToSelection(feature, resolvedGeomanData);
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

    if (this.geoman) {
      this.geoman.enableDraw(mode);
    }

    this.state.activeDrawMode = mode;
    this.state.isDrawing = true;
    this.options.onModeChange?.(mode);
    this.updateToolbarState();
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
    } else {
      // Layers exist, move them to the top to ensure visibility
      try {
        if (this.map.getLayer(INTERNAL_IDS.SELECTION_FILL_LAYER)) {
          this.map.moveLayer(INTERNAL_IDS.SELECTION_FILL_LAYER);
        }
        if (this.map.getLayer(INTERNAL_IDS.SELECTION_LINE_LAYER)) {
          this.map.moveLayer(INTERNAL_IDS.SELECTION_LINE_LAYER);
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
      geomanData: resolvedGeomanData?.[i],
    }));
    this.updateSelectionHighlight();
    this.options.onSelectionChange?.(features);
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
        geomanData: resolvedGeomanData,
      });
      this.updateSelectionHighlight();
      this.options.onSelectionChange?.(this.getSelectedFeatures());
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
  }

  /**
   * Clear selection
   */
  clearSelection(): void {
    this.state.selectedFeatures = [];
    this.updateSelectionHighlight();
    this.options.onSelectionChange?.([]);
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

    const results = targets.map((feature) => this.simplifyFeature.simplifyWithStats(feature));
    const shouldBatch = results.length > 1;

    results.forEach((result) => {
      if (!result) return;
      this.applySimplifyResult(result, {
        clearSelection: !shouldBatch,
        disableModes: !shouldBatch,
      });
    });

    if (shouldBatch) {
      this.clearSelection();
      this.disableAllModes();
    }
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
      });
    }

    this.emitEvent('gm:split', result);
    this.disableAllModes();
  }

  private handleUnionResult(result: UnionResult): void {
    if (!result.success || !result.result) {
      console.warn('Union failed:', result.error);
      return;
    }

    // Remove original features using provided result data
    this.deleteGeomanFeatures(result.originals);
    this.clearGeomanTemporaryFeatures();
    this.clearSelection();

    // Add merged feature
    if (this.geoman) {
      this.geoman.features.importGeoJsonFeature(result.result);
      this.options.onFeatureCreate?.(result.result);
      this.lastCreatedFeature = result.result;
    }

    this.emitEvent('gm:union', result);
    this.disableAllModes();
  }

  private handleDifferenceResult(result: DifferenceResult): void {
    if (!result.success) {
      console.warn('Difference failed:', result.error);
      return;
    }

    // Remove original features using provided result data
    this.deleteGeomanFeatures([result.base, ...result.subtracted]);
    this.clearGeomanTemporaryFeatures();
    this.clearSelection();

    // Add result if not null (complete subtraction)
    if (result.result && this.geoman) {
      this.geoman.features.importGeoJsonFeature(result.result);
      this.options.onFeatureCreate?.(result.result);
      this.lastCreatedFeature = result.result;
    }

    this.emitEvent('gm:difference', result);
    this.disableAllModes();
  }

  private handleSimplifyResult(result: SimplifyResult): void {
    this.applySimplifyResult(result, { clearSelection: true, disableModes: true });
  }

  private applySimplifyResult(
    result: SimplifyResult,
    options: { clearSelection: boolean; disableModes: boolean }
  ): void {
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

    // Helper tools group (snapping)
    if (this.options.helperModes.includes('snapping')) {
      const helperGroup = this.createHelperToolsGroup();
      toolsWrapper.appendChild(helperGroup);
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
    btn.innerHTML = this.state.collapsed
      ? '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M12 8l-6 6h12z" fill="currentColor"/></svg>'
      : '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M12 16l6-6H6z" fill="currentColor"/></svg>';

    btn.addEventListener('click', () => {
      this.toggleCollapse();
      // Update button icon and title
      btn.innerHTML = this.state.collapsed
        ? '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M12 8l-6 6h12z" fill="currentColor"/></svg>'
        : '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M12 16l6-6H6z" fill="currentColor"/></svg>';
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
      if (e.key === 'Delete' || e.key === 'Backspace') {
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
      // Handle feature creation
      if (event.type === 'gm:create' && event.feature) {
        this.lastCreatedFeature = event.feature;
        this.options.onFeatureCreate?.(event.feature);
      }

      // Handle mode changes
      if (event.type?.includes('modetoggled')) {
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
}
