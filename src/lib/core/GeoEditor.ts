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

  // Selection mode state
  private isSelectMode: boolean = false;

  // Interactive selection mode for union/difference
  private pendingOperation: 'union' | 'difference' | null = null;

  // Snapping state (independent of other modes)
  private snappingEnabled: boolean = false;

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

      // Find the clicked feature
      const result = this.findFeatureAtPoint(e.lngLat.lng, e.lngLat.lat);

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
        // Skip if geoman data or its geoJson is undefined
        if (!fd || !fd.geoJson || !fd.geoJson.geometry) {
          index++;
          return;
        }
        const feature = fd.geoJson;
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
   * Find geoman data for a feature by searching
   */
  private findGeomanDataForFeature(targetFeature: Feature): GeomanFeatureData | null {
    if (!this.geoman) return null;

    let foundData: GeomanFeatureData | null = null;

    try {
      this.geoman.features.forEach((fd) => {
        if (foundData) return;

        // Match by ID or by geometry
        if (fd.geoJson.id === targetFeature.id) {
          foundData = fd;
        } else if (JSON.stringify(fd.geoJson.geometry) === JSON.stringify(targetFeature.geometry)) {
          foundData = fd;
        }
      });
    } catch {
      // forEach not available
    }

    return foundData;
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
   * Toggle feature in selection
   */
  private toggleFeatureSelection(feature: Feature, geomanData?: GeomanFeatureData): void {
    const featureId = geomanData?.id || String(feature.id);
    const isSelected = this.state.selectedFeatures.some((s) => s.id === featureId);

    if (isSelected) {
      this.removeFromSelection(featureId);
    } else {
      this.addToSelection(feature, geomanData);
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
          features.push(fd.geoJson);
        });
        return { type: 'FeatureCollection', features };
      }
    }
    return { type: 'FeatureCollection', features: [] };
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
          this.geoman.enableGlobalDragMode();
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

    // Reset pending operation
    this.pendingOperation = null;

    // Reset cursor
    this.map.getCanvas().style.cursor = '';

    this.state.activeDrawMode = null;
    this.state.activeEditMode = null;
    this.state.isDrawing = false;
    this.state.isEditing = false;
    this.updateToolbarState();

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
    this.pendingOperation = 'union';
    this.clearSelection();
    this.map.getCanvas().style.cursor = 'pointer';
  }

  /**
   * Enable difference mode (interactive polygon selection)
   */
  private enableDifferenceMode(): void {
    this.pendingOperation = 'difference';
    this.clearSelection();
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
    this.state.selectedFeatures = features.map((f, i) => ({
      id: geomanDataList?.[i]?.id || String(f.id || Date.now()),
      feature: f,
      layerId: 'default',
      geomanData: geomanDataList?.[i],
    }));
    this.updateSelectionHighlight();
    this.options.onSelectionChange?.(features);
  }

  /**
   * Add feature to selection
   */
  addToSelection(feature: Feature, geomanData?: GeomanFeatureData): void {
    const featureId = geomanData?.id || String(feature.id);
    const exists = this.state.selectedFeatures.some(
      (s) => s.id === featureId
    );
    if (!exists) {
      this.state.selectedFeatures.push({
        id: featureId,
        feature,
        layerId: 'default',
        geomanData,
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
    const selected = this.getSelectedFeatures();
    if (selected.length === 0) {
      console.warn('Select a feature to scale');
      return;
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
    if (selected.length === 0) {
      console.warn('Select a feature to simplify');
      return;
    }

    const feature = selected[0];
    const result = this.simplifyFeature.simplifyWithStats(feature);
    this.handleSimplifyResult(result);
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
      this.geoman.features.forEach((fd) => {
        if (fd.id === featureId || fd.geoJson.id === featureId) {
          fd.delete();
        }
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
      // Use geoman data's delete method if available (most reliable)
      if (s.geomanData?.delete) {
        try {
          s.geomanData.delete();
        } catch {
          // Fallback to ID-based deletion
          this.deleteFeatureById(s.id);
        }
      } else {
        this.deleteFeatureById(s.id);
      }
      this.options.onFeatureDelete?.(s.id);
    });

    this.clearSelection();
  }

  // ============================================================================
  // Result Handlers
  // ============================================================================

  private handleSplitResult(result: SplitResult): void {
    if (!result.success) {
      console.warn('Split failed:', result.error);
      return;
    }

    // Remove original feature using stored geoman data
    this.deleteSelectedFeatures();

    // Add new parts
    if (this.geoman) {
      result.parts.forEach((part) => {
        this.geoman?.features.importGeoJsonFeature(part);
        this.options.onFeatureCreate?.(part);
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

    // Remove original features using stored geoman data
    this.deleteSelectedFeatures();

    // Add merged feature
    if (this.geoman) {
      this.geoman.features.importGeoJsonFeature(result.result);
      this.options.onFeatureCreate?.(result.result);
    }

    this.emitEvent('gm:union', result);
    this.disableAllModes();
  }

  private handleDifferenceResult(result: DifferenceResult): void {
    if (!result.success) {
      console.warn('Difference failed:', result.error);
      return;
    }

    // Remove original features using stored geoman data
    this.deleteSelectedFeatures();

    // Add result if not null (complete subtraction)
    if (result.result && this.geoman) {
      this.geoman.features.importGeoJsonFeature(result.result);
      this.options.onFeatureCreate?.(result.result);
    }

    this.emitEvent('gm:difference', result);
    this.disableAllModes();
  }

  private handleSimplifyResult(result: SimplifyResult): void {
    // Remove original feature
    const originalId = String(result.original.id);
    this.deleteFeatureById(originalId);

    // Add simplified feature
    if (this.geoman) {
      result.result.id = originalId;
      this.geoman.features.importGeoJsonFeature(result.result);
      this.options.onFeatureEdit?.(result.result, result.original);
    }

    this.emitEvent('gm:simplify', result);
    this.clearSelection();
    this.disableAllModes();
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
    snappingBtn.title = 'Toggle Snapping (requires Geoman Pro for full functionality)';
    snappingBtn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M20 6h-3V4c0-1.1-.9-2-2-2H9c-1.1 0-2 .9-2 2v2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zM9 4h6v2H9V4zm11 16H4V8h16v12z" fill="currentColor"/><circle cx="12" cy="14" r="3" fill="currentColor"/></svg>';

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

  /**
   * Toggle snapping on/off (independent of other modes)
   * Note: Snapping functionality requires Geoman Pro. In the free version,
   * this toggle tracks state but does not enable actual vertex snapping.
   */
  toggleSnapping(): void {
    this.snappingEnabled = !this.snappingEnabled;

    // Attempt to set snapping if Geoman supports it (Pro version)
    if (this.geoman) {
      try {
        // Try to access snapping API if available (Geoman Pro)
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
        // Snapping API not available in this version of Geoman
        console.info('Snapping toggle: Geoman free version does not support snapping. Consider upgrading to Geoman Pro for full snapping functionality.');
      }
    }
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
      select: '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M3 5l6 6V5H3zm12 0v6l6-6h-6zM9 19l-6-6v6h6zm6 0h6v-6l-6 6z" fill="currentColor"/><path d="M12 8l-4 8h8l-4-8z" fill="currentColor"/></svg>',
      drag: '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M10 9h4V6h3l-5-5-5 5h3v3zm-1 1H6V7l-5 5 5 5v-3h3v-4zm14 2l-5-5v3h-3v4h3v3l5-5zm-9 3h-4v3H7l5 5 5-5h-3v-3z" fill="currentColor"/></svg>',
      change: '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a.996.996 0 0 0 0-1.41l-2.34-2.34a.996.996 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" fill="currentColor"/></svg>',
      rotate: '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z" fill="currentColor"/></svg>',
      cut: '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M9.64 7.64c.23-.5.36-1.05.36-1.64 0-2.21-1.79-4-4-4S2 3.79 2 6s1.79 4 4 4c.59 0 1.14-.13 1.64-.36L10 12l-2.36 2.36C7.14 14.13 6.59 14 6 14c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4c0-.59-.13-1.14-.36-1.64L12 14l7 7h3v-1L9.64 7.64z" fill="currentColor"/></svg>',
      delete: '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" fill="currentColor"/></svg>',
      scale: '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M21 15h2v2h-2v-2zm0-4h2v2h-2v-2zm2 8h-2v2c1 0 2-1 2-2zM13 3h2v2h-2V3zm8 4h2v2h-2V7zm0-4v2h2c0-1-1-2-2-2zM1 7h2v2H1V7zm16-4h2v2h-2V3zm0 16h2v2h-2v-2zM3 3C2 3 1 4 1 5h2V3zm6 0h2v2H9V3zM5 3h2v2H5V3zm-4 8v8c0 1.1.9 2 2 2h12V11H1z" fill="currentColor"/></svg>',
      copy: '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z" fill="currentColor"/></svg>',
      split: '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M14 4l2.29 2.29-2.88 2.88 1.42 1.42 2.88-2.88L20 10V4h-6zm-4 0H4v6l2.29-2.29 4.71 4.7V20h2v-8.41l-5.29-5.3L10 4z" fill="currentColor"/></svg>',
      union: '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M4 4h7v7H4V4zm9 0h7v7h-7V4zm-9 9h7v7H4v-7zm9 0h7v7h-7v-7z" fill="currentColor"/></svg>',
      difference: '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM9 17H7v-7h2v7zm4 0h-2V7h2v10zm4 0h-2v-4h2v4z" fill="currentColor"/></svg>',
      simplify: '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z" fill="currentColor"/></svg>',
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
