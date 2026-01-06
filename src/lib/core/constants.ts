import type {
  GeoEditorOptionsRequired,
  DrawMode,
  EditMode,
  HelperMode,
  FileMode,
} from './types';

/**
 * Default draw modes available in the toolbar
 */
export const DEFAULT_DRAW_MODES: DrawMode[] = [
  'polygon',
  'line',
  'rectangle',
  'circle',
  'marker',
];

/**
 * Default edit modes available in the toolbar
 */
export const DEFAULT_EDIT_MODES: EditMode[] = [
  'select',
  'drag',
  'change',
  'rotate',
  'cut',
  'delete',
  // Advanced modes
  'scale',
  'copy',
  'split',
  'union',
  'difference',
  'simplify',
  'lasso',
];

/**
 * Advanced edit modes (our implementations)
 */
export const ADVANCED_EDIT_MODES: EditMode[] = [
  'select',
  'scale',
  'copy',
  'split',
  'union',
  'difference',
  'simplify',
  'lasso',
];

/**
 * Default helper modes
 */
export const DEFAULT_HELPER_MODES: HelperMode[] = ['snapping', 'measurements'];

/**
 * Default file modes
 */
export const DEFAULT_FILE_MODES: FileMode[] = ['open', 'save'];

/**
 * Default options for GeoEditor
 */
export const DEFAULT_OPTIONS: GeoEditorOptionsRequired = {
  position: 'top-left',
  collapsed: false,
  drawModes: DEFAULT_DRAW_MODES,
  editModes: DEFAULT_EDIT_MODES,
  helperModes: DEFAULT_HELPER_MODES,
  fileModes: DEFAULT_FILE_MODES,
  toolbarOrientation: 'vertical',
  showLabels: false,
  simplifyTolerance: 0.001,
  snappingEnabled: true,
  measurementsEnabled: false,
  hideGeomanControl: true,
  saveFilename: 'features.geojson',
  onFeatureCreate: () => {},
  onFeatureEdit: () => {},
  onFeatureDelete: () => {},
  onSelectionChange: () => {},
  onModeChange: () => {},
  onGeoJsonLoad: () => {},
  onGeoJsonSave: () => {},
  showFeatureProperties: true,
  fitBoundsOnLoad: true,
};

/**
 * CSS class prefix for the plugin
 */
export const CSS_PREFIX = 'geo-editor';

/**
 * Source and layer IDs used by the plugin
 */
export const INTERNAL_IDS = {
  LASSO_SOURCE: 'geo-editor-lasso-source',
  LASSO_LAYER: 'geo-editor-lasso-layer',
  LASSO_LINE_LAYER: 'geo-editor-lasso-line-layer',
  SCALE_HANDLES_SOURCE: 'geo-editor-scale-handles-source',
  SCALE_HANDLES_LAYER: 'geo-editor-scale-handles-layer',
  SPLIT_LINE_SOURCE: 'geo-editor-split-line-source',
  SPLIT_LINE_LAYER: 'geo-editor-split-line-layer',
  SELECTION_SOURCE: 'geo-editor-selection-source',
  SELECTION_FILL_LAYER: 'geo-editor-selection-fill-layer',
  SELECTION_LINE_LAYER: 'geo-editor-selection-line-layer',
} as const;

/**
 * Default scale handle options
 */
export const SCALE_HANDLE_DEFAULTS = {
  handleSize: 10,
  handleColor: '#3388ff',
  handleBorderColor: '#ffffff',
  handleBorderWidth: 2,
  minScale: 0.1,
  maxScale: 10,
};

/**
 * Default simplification options
 */
export const SIMPLIFY_DEFAULTS = {
  tolerance: 0.001,
  highQuality: false,
  mutate: false,
};

/**
 * Default copy options
 */
export const COPY_DEFAULTS = {
  offset: [0.0005, 0.0005] as [number, number],
  generateNewIds: true,
};

/**
 * Keyboard shortcuts
 */
export const KEYBOARD_SHORTCUTS = {
  COPY: 'c',
  PASTE: 'v',
  DELETE: 'Delete',
  ESCAPE: 'Escape',
  UNDO: 'z',
  REDO: 'y',
} as const;
