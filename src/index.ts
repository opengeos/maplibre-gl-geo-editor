// Core exports
export { GeoEditor } from './lib/core/GeoEditor';
export { HistoryManager } from './lib/core/HistoryManager';

// Adapter export
export { GeoEditorLayerAdapter } from './lib/adapters/GeoEditorLayerAdapter';
export type {
  GeoEditorOptions,
  GeoEditorState,
  DrawMode,
  EditMode,
  HelperMode,
  FileMode,
  ToolbarPosition,
  ToolbarOrientation,
  SelectedFeature,
  ScaleOptions,
  SimplifyOptions,
  CopyOptions,
  SplitOptions,
  UnionOptions,
  DifferenceOptions,
  LassoOptions,
  SplitResult,
  UnionResult,
  DifferenceResult,
  SimplifyResult,
  LassoResult,
  GeoJsonLoadResult,
  GeoJsonSaveResult,
  ScaleHandle,
  ScaleHandlePosition,
  GeomanInstance,
  GeomanFeaturesAPI,
  GeoEditorEventMap,
  GeoEditorEventType,
  // History types
  HistoryOperationType,
  Command,
  HistoryState,
  // Attribute editing types
  AttributeFieldType,
  AttributeFieldDefinition,
  AttributeSchema,
  AttributeChangeEvent,
} from './lib/core/types';

// Feature exports
export {
  CopyFeature,
  SimplifyFeature,
  UnionFeature,
  DifferenceFeature,
  ScaleFeature,
  LassoFeature,
  SplitFeature,
} from './lib/features';

// Utility exports
export * from './lib/utils';

// Constants
export {
  DEFAULT_DRAW_MODES,
  DEFAULT_EDIT_MODES,
  ADVANCED_EDIT_MODES,
  DEFAULT_FILE_MODES,
  DEFAULT_OPTIONS,
  CSS_PREFIX,
} from './lib/core/constants';

// Import CSS (for bundlers that support it)
import './lib/styles/geo-editor.css';
