import type { CustomLayerAdapter, LayerState } from 'maplibre-gl-layer-control';
import type { GeoEditor } from '../core/GeoEditor';

const LAYER_ID = 'geo-editor-features';

/**
 * Adapter for integrating GeoEditor drawn features with maplibre-gl-layer-control.
 *
 * Exposes all drawn features as a single composite layer "geo-editor-features"
 * that appears in the layer control panel.
 *
 * @example
 * ```typescript
 * import { GeoEditor, GeoEditorLayerAdapter } from 'maplibre-gl-geo-editor';
 * import { LayerControl } from 'maplibre-gl-layer-control';
 *
 * const editor = new GeoEditor({ ... });
 * map.addControl(editor, 'top-left');
 *
 * const editorAdapter = new GeoEditorLayerAdapter(editor);
 * const layerControl = new LayerControl({
 *   customLayerAdapters: [editorAdapter],
 * });
 * map.addControl(layerControl, 'top-left');
 * ```
 */
export class GeoEditorLayerAdapter implements CustomLayerAdapter {
  readonly type = 'geo-editor';

  private _control: GeoEditor;
  private _changeCallbacks: Array<(event: 'add' | 'remove', layerId: string) => void> = [];
  private _visible = true;
  private _opacity = 1;
  private _hasFeatures = false;

  constructor(control: GeoEditor) {
    this._control = control;
    this._setupEventListeners();
  }

  private _setupEventListeners(): void {
    // Listen for feature changes via the map container CustomEvents
    // We'll periodically check if features exist when getLayerIds is called
  }

  getLayerIds(): string[] {
    const features = this._control.getFeatures();
    const hasFeatures = features && features.features && features.features.length > 0;

    if (hasFeatures && !this._hasFeatures) {
      this._hasFeatures = true;
      this._changeCallbacks.forEach((cb) => cb('add', LAYER_ID));
    } else if (!hasFeatures && this._hasFeatures) {
      this._hasFeatures = false;
      this._changeCallbacks.forEach((cb) => cb('remove', LAYER_ID));
    }

    return hasFeatures ? [LAYER_ID] : [];
  }

  getLayerState(_layerId: string): LayerState | null {
    const features = this._control.getFeatures();
    if (!features || !features.features || features.features.length === 0) return null;

    return {
      visible: this._visible,
      opacity: this._opacity,
      name: this.getName(_layerId),
      isCustomLayer: true,
      customLayerType: 'geo-editor',
    };
  }

  setVisibility(_layerId: string, visible: boolean): void {
    this._visible = visible;
    // Access the map through the control to toggle Geoman layer visibility
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const map = (this._control as any).map;
    if (!map) return;

    // Toggle visibility of all Geoman-managed layers
    const style = map.getStyle();
    if (style?.layers) {
      for (const layer of style.layers) {
        // Geoman creates layers with source IDs starting with 'geoman'
        if (layer.source && typeof layer.source === 'string' && layer.source.startsWith('geoman')) {
          map.setLayoutProperty(layer.id, 'visibility', visible ? 'visible' : 'none');
        }
      }
    }
  }

  setOpacity(_layerId: string, opacity: number): void {
    this._opacity = opacity;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const map = (this._control as any).map;
    if (!map) return;

    const style = map.getStyle();
    if (style?.layers) {
      for (const layer of style.layers) {
        if (layer.source && typeof layer.source === 'string' && layer.source.startsWith('geoman')) {
          if (layer.type === 'fill') {
            map.setPaintProperty(layer.id, 'fill-opacity', opacity * 0.3);
          } else if (layer.type === 'line') {
            map.setPaintProperty(layer.id, 'line-opacity', opacity);
          } else if (layer.type === 'circle') {
            map.setPaintProperty(layer.id, 'circle-opacity', opacity);
          }
        }
      }
    }
  }

  getName(_layerId: string): string {
    return 'Drawn Features';
  }

  getSymbolType(_layerId: string): string {
    return 'fill';
  }

  removeLayer(_layerId: string): void {
    // Remove all drawn features
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const geoman = (this._control as any).geoman;
    if (geoman?.features) {
      geoman.features.forEach((feature: { delete: () => void }) => {
        feature.delete();
      });
    }
    this._hasFeatures = false;
  }

  onLayerChange(callback: (event: 'add' | 'remove', layerId: string) => void): () => void {
    this._changeCallbacks.push(callback);
    return () => {
      const idx = this._changeCallbacks.indexOf(callback);
      if (idx >= 0) this._changeCallbacks.splice(idx, 1);
    };
  }

  destroy(): void {
    this._changeCallbacks = [];
  }
}
