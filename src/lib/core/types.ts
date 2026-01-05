/* eslint-disable @typescript-eslint/no-unused-vars */
import type {
  Feature,
  Polygon,
  MultiPolygon,
  LineString,
  MultiLineString,
  Point,
  FeatureCollection,
  GeoJsonProperties,
  Geometry,
} from 'geojson';

// ============================================================================
// Draw and Edit Mode Types
// ============================================================================

export type DrawMode =
  | 'marker'
  | 'circle'
  | 'circle_marker'
  | 'ellipse'
  | 'text_marker'
  | 'line'
  | 'rectangle'
  | 'polygon'
  | 'freehand';

export type EditMode =
  | 'drag'
  | 'change'
  | 'rotate'
  | 'cut'
  | 'delete'
  // Advanced modes (our implementations)
  | 'select'
  | 'scale'
  | 'copy'
  | 'split'
  | 'union'
  | 'difference'
  | 'simplify'
  | 'lasso';

export type HelperMode = 'snapping' | 'measurements';

export type ToolbarPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

export type ToolbarOrientation = 'vertical' | 'horizontal';

// ============================================================================
// Configuration Options
// ============================================================================

export interface GeoEditorOptions {
  /** Position of the control on the map */
  position?: ToolbarPosition;
  /** Whether the toolbar starts collapsed */
  collapsed?: boolean;
  /** Draw modes to enable */
  drawModes?: DrawMode[];
  /** Edit modes to enable */
  editModes?: EditMode[];
  /** Helper modes to enable */
  helperModes?: HelperMode[];
  /** Toolbar orientation */
  toolbarOrientation?: ToolbarOrientation;
  /** Show text labels on toolbar buttons */
  showLabels?: boolean;
  /** Default tolerance for line simplification */
  simplifyTolerance?: number;
  /** Enable snapping by default */
  snappingEnabled?: boolean;
  /** Enable measurements by default */
  measurementsEnabled?: boolean;
  /** Hide the geoman control (use GeoEditor toolbar instead) */
  hideGeomanControl?: boolean;
  /** Callback when a feature is created */
  onFeatureCreate?: (feature: Feature) => void;
  /** Callback when a feature is edited */
  onFeatureEdit?: (feature: Feature, oldFeature: Feature) => void;
  /** Callback when a feature is deleted */
  onFeatureDelete?: (featureId: string) => void;
  /** Callback when selection changes */
  onSelectionChange?: (features: Feature[]) => void;
  /** Callback when mode changes */
  onModeChange?: (mode: DrawMode | EditMode | null) => void;
}

export type GeoEditorOptionsRequired = Required<GeoEditorOptions>;

// ============================================================================
// State Types
// ============================================================================

export interface SelectedFeature {
  id: string;
  feature: Feature;
  layerId: string;
  /** Reference to geoman feature data for deletion */
  geomanData?: GeomanFeatureData;
}

export interface GeoEditorState {
  /** Currently active draw mode */
  activeDrawMode: DrawMode | null;
  /** Currently active edit mode */
  activeEditMode: EditMode | null;
  /** Currently selected features */
  selectedFeatures: SelectedFeature[];
  /** Whether currently drawing */
  isDrawing: boolean;
  /** Whether currently editing */
  isEditing: boolean;
  /** Features in clipboard for copy/paste */
  clipboard: Feature[];
  /** Whether toolbar is collapsed */
  collapsed: boolean;
}

// ============================================================================
// Feature Operation Options
// ============================================================================

export interface ScaleOptions {
  /** Maintain aspect ratio during scaling */
  maintainAspectRatio?: boolean;
  /** Scale from center of feature */
  scaleFromCenter?: boolean;
  /** Minimum scale factor */
  minScale?: number;
  /** Maximum scale factor */
  maxScale?: number;
}

export interface SimplifyOptions {
  /** Tolerance for simplification (in degrees) */
  tolerance: number;
  /** Use high quality simplification */
  highQuality?: boolean;
  /** Mutate original feature */
  mutate?: boolean;
}

export interface CopyOptions {
  /** Offset in [lng, lat] degrees for pasted features */
  offset?: [number, number];
  /** Generate new IDs for copied features */
  generateNewIds?: boolean;
}

export interface SplitOptions {
  /** Keep the original feature after splitting */
  keepOriginal?: boolean;
}

export interface UnionOptions {
  /** Properties to use for the merged feature */
  properties?: GeoJsonProperties;
}

export interface DifferenceOptions {
  /** Properties to use for the result feature */
  properties?: GeoJsonProperties;
}

export interface LassoOptions {
  /** Selection mode: 'contains' or 'intersects' */
  mode?: 'contains' | 'intersects';
}

// ============================================================================
// Operation Results
// ============================================================================

export interface SplitResult {
  /** Original feature that was split */
  original: Feature<Polygon | LineString>;
  /** Resulting parts after splitting */
  parts: Feature[];
  /** Whether the operation was successful */
  success: boolean;
  /** Error message if operation failed */
  error?: string;
}

export interface UnionResult {
  /** Resulting merged feature */
  result: Feature<Polygon | MultiPolygon> | null;
  /** Original features that were merged */
  originals: Feature<Polygon | MultiPolygon>[];
  /** Whether the operation was successful */
  success: boolean;
  /** Error message if operation failed */
  error?: string;
}

export interface DifferenceResult {
  /** Resulting feature after subtraction */
  result: Feature<Polygon | MultiPolygon> | null;
  /** Base feature */
  base: Feature<Polygon | MultiPolygon>;
  /** Features that were subtracted */
  subtracted: Feature<Polygon | MultiPolygon>[];
  /** Whether the operation was successful */
  success: boolean;
  /** Error message if operation failed */
  error?: string;
}

export interface SimplifyResult {
  /** Simplified feature */
  result: Feature;
  /** Original feature */
  original: Feature;
  /** Number of vertices before */
  verticesBefore: number;
  /** Number of vertices after */
  verticesAfter: number;
  /** Reduction percentage */
  reductionPercent: number;
}

export interface LassoResult {
  /** Features selected by the lasso */
  selected: Feature[];
  /** The lasso polygon used for selection */
  lasso: Feature<Polygon>;
}

// ============================================================================
// Scale Handle Types
// ============================================================================

export type ScaleHandlePosition =
  | 'nw'
  | 'n'
  | 'ne'
  | 'e'
  | 'se'
  | 's'
  | 'sw'
  | 'w';

export interface ScaleHandle {
  position: ScaleHandlePosition;
  coordinates: [number, number];
}

// ============================================================================
// Event Types
// ============================================================================

export interface GeoEditorEventMap {
  'gm:scale': { feature: Feature; scaleFactor: number };
  'gm:scalestart': { feature: Feature };
  'gm:scaleend': { feature: Feature; scaleFactor: number };
  'gm:copy': { features: Feature[] };
  'gm:paste': { features: Feature[] };
  'gm:split': SplitResult;
  'gm:union': UnionResult;
  'gm:difference': DifferenceResult;
  'gm:simplify': SimplifyResult;
  'gm:lassostart': Record<string, never>;
  'gm:lassoend': LassoResult;
  'gm:selectionchange': { features: Feature[] };
  'gm:modechange': { mode: DrawMode | EditMode | null };
}

export type GeoEditorEventType = keyof GeoEditorEventMap;

// ============================================================================
// Geoman Types (from @geoman-io/maplibre-geoman-free)
// ============================================================================

export interface GeomanInstance {
  enableDraw: (shape: DrawMode) => void;
  disableDraw: () => void;
  toggleDraw: (shape: DrawMode) => void;
  drawEnabled: (shape?: DrawMode) => boolean;
  enableGlobalEditMode: () => void;
  disableGlobalEditMode: () => void;
  toggleGlobalEditMode: () => void;
  globalEditModeEnabled: () => boolean;
  enableGlobalDragMode: () => void;
  disableGlobalDragMode: () => void;
  toggleGlobalDragMode: () => void;
  globalDragModeEnabled: () => boolean;
  enableGlobalRotateMode: () => void;
  disableGlobalRotateMode: () => void;
  toggleGlobalRotateMode: () => void;
  globalRotateModeEnabled: () => boolean;
  enableGlobalCutMode: () => void;
  disableGlobalCutMode: () => void;
  toggleGlobalCutMode: () => void;
  globalCutModeEnabled: () => boolean;
  enableGlobalRemovalMode: () => void;
  disableGlobalRemovalMode: () => void;
  toggleGlobalRemovalMode: () => void;
  globalRemovalModeEnabled: () => boolean;
  disableAllModes: () => void;
  addControls: (controlsElement?: HTMLElement) => Promise<void>;
  removeControls: () => void;
  setGlobalEventsListener: (
    callback?: (parameters: GeomanEventParameters) => void
  ) => void;
  features: GeomanFeaturesAPI;
}

export interface GeomanFeatureData {
  id: string;
  shape: string;
  geoJson: Feature;
  delete: () => void;
}

export interface GeomanFeaturesAPI {
  getAll: () => FeatureCollection;
  get: (sourceName: string, featureId: string) => GeomanFeatureData | null;
  forEach: (callback: (feature: GeomanFeatureData) => void) => void;
  has: (sourceName: string, featureId: string) => boolean;
  delete: (featureData: GeomanFeatureData) => void;
  deleteAll: () => void;
  importGeoJson: (geoJson: FeatureCollection, options?: { overwrite?: boolean }) => { success: number; failed: number };
  importGeoJsonFeature: (feature: Feature) => GeomanFeatureData | null;
  getFeatureByMouseEvent: (options: { event: MouseEvent; sourceNames?: string[] }) => GeomanFeatureData | null;
  getFeaturesByScreenBounds: (options: { bounds: [[number, number], [number, number]]; sourceNames?: string[] }) => GeomanFeatureData[];
}

export interface GeomanEventParameters {
  type: string;
  feature?: Feature;
  shape?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

// ============================================================================
// Utility Types
// ============================================================================

export type PolygonFeature = Feature<Polygon | MultiPolygon>;
export type LineFeature = Feature<LineString | MultiLineString>;
export type PointFeature = Feature<Point>;
export type AnyFeature = Feature<Geometry>;

export interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}
