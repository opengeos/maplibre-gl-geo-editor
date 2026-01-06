import { useEffect, useRef, useCallback } from 'react';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { GeoEditor } from './GeoEditor';
import type { GeoEditorOptions, GeomanInstance, DrawMode, EditMode } from './types';

export interface GeoEditorReactProps extends GeoEditorOptions {
  /** MapLibre map instance */
  map: MapLibreMap;
  /** Geoman instance for integration */
  geoman?: GeomanInstance;
}

/**
 * React wrapper component for GeoEditor
 * This component renders nothing but manages the GeoEditor lifecycle
 */
export function GeoEditorReact({
  map,
  geoman,
  position = 'top-left',
  ...options
}: GeoEditorReactProps) {
  const controlRef = useRef<GeoEditor | null>(null);

  useEffect(() => {
    if (!map) return;

    // Create and add the control
    const control = new GeoEditor({ ...options, position });
    controlRef.current = control;

    map.addControl(control, position);

    // Set geoman instance if provided
    if (geoman) {
      control.setGeoman(geoman);
    }

    // Cleanup on unmount
    return () => {
      if (controlRef.current) {
        map.removeControl(controlRef.current);
        controlRef.current = null;
      }
    };
  }, [map, position]);

  // Update geoman instance when it changes
  useEffect(() => {
    if (controlRef.current && geoman) {
      controlRef.current.setGeoman(geoman);
    }
  }, [geoman]);

  // This component doesn't render anything
  return null;
}

/**
 * Hook for using GeoEditor imperatively
 */
export function useGeoEditor(
  map: MapLibreMap | null,
  options: GeoEditorOptions = {}
): {
  control: GeoEditor | null;
  enableDrawMode: (mode: DrawMode) => void;
  enableEditMode: (mode: EditMode) => void;
  disableAllModes: () => void;
  copySelected: () => void;
  pasteFeatures: () => void;
  deleteSelected: () => void;
  clearSelection: () => void;
} {
  const controlRef = useRef<GeoEditor | null>(null);

  useEffect(() => {
    if (!map) return;

    const control = new GeoEditor(options);
    controlRef.current = control;
    map.addControl(control, options.position || 'top-left');

    return () => {
      if (controlRef.current) {
        map.removeControl(controlRef.current);
        controlRef.current = null;
      }
    };
  }, [map]);

  const enableDrawMode = useCallback((mode: DrawMode) => {
    controlRef.current?.enableDrawMode(mode);
  }, []);

  const enableEditMode = useCallback((mode: EditMode) => {
    controlRef.current?.enableEditMode(mode);
  }, []);

  const disableAllModes = useCallback(() => {
    controlRef.current?.disableAllModes();
  }, []);

  const copySelected = useCallback(() => {
    controlRef.current?.copySelectedFeatures();
  }, []);

  const pasteFeatures = useCallback(() => {
    controlRef.current?.pasteFeatures();
  }, []);

  const deleteSelected = useCallback(() => {
    controlRef.current?.deleteSelectedFeatures();
  }, []);

  const clearSelection = useCallback(() => {
    controlRef.current?.clearSelection();
  }, []);

  return {
    control: controlRef.current,
    enableDrawMode,
    enableEditMode,
    disableAllModes,
    copySelected,
    pasteFeatures,
    deleteSelected,
    clearSelection,
  };
}

export default GeoEditorReact;
