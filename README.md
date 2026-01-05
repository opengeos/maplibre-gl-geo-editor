# maplibre-gl-geo-editor

A powerful MapLibre GL plugin for creating and editing geometries. Extends the free [Geoman](https://geoman.io/docs/maplibre/) control with advanced editing features including Union, Split, Scale, Difference, Simplify, Copy, and Lasso selection.

[![npm version](https://img.shields.io/npm/v/maplibre-gl-geo-editor.svg)](https://www.npmjs.com/package/maplibre-gl-geo-editor)
[![license](https://img.shields.io/npm/l/maplibre-gl-geo-editor.svg)](https://github.com/opengeos/maplibre-gl-geo-editor/blob/main/LICENSE)

## Features

### Draw Tools
- **Polygon** - Draw polygons by clicking points
- **Line** - Draw polylines
- **Rectangle** - Draw rectangles
- **Circle** - Draw circles
- **Marker** - Place point markers

### Basic Edit Tools (via Geoman Free)
- **Drag** - Move features on the map
- **Edit** - Modify feature vertices
- **Rotate** - Rotate features
- **Cut** - Cut holes in polygons
- **Delete** - Remove features

### Advanced Edit Tools (Custom Implementation)
- **Scale** - Resize features with interactive handles
- **Copy** - Duplicate features (Ctrl+C/V support)
- **Split** - Split polygons/lines with a drawn line
- **Union** - Merge multiple polygons into one
- **Difference** - Subtract one polygon from another
- **Simplify** - Reduce vertices using Douglas-Peucker algorithm
- **Lasso** - Select multiple features by drawing a polygon

## Installation

```bash
npm install maplibre-gl-geo-editor @geoman-io/maplibre-geoman-free maplibre-gl
```

## Usage

### Basic Usage (Vanilla JS/TS)

```typescript
import 'maplibre-gl/dist/maplibre-gl.css';
import '@geoman-io/maplibre-geoman-free/dist/maplibre-geoman.css';
import 'maplibre-gl-geo-editor/style.css';

import maplibregl from 'maplibre-gl';
import { Geoman } from '@geoman-io/maplibre-geoman-free';
import { GeoEditor } from 'maplibre-gl-geo-editor';

// Create the map
const map = new maplibregl.Map({
  container: 'map',
  style: 'https://demotiles.maplibre.org/style.json',
  center: [0, 0],
  zoom: 2,
});

map.on('load', () => {
  // Initialize Geoman
  const geoman = new Geoman(map, {});

  map.on('gm:loaded', () => {
    // Create GeoEditor
    const geoEditor = new GeoEditor({
      position: 'top-left',
      toolbarOrientation: 'vertical',
      drawModes: ['polygon', 'line', 'rectangle', 'circle', 'marker'],
      editModes: [
        'drag', 'change', 'rotate', 'cut', 'delete',
        'scale', 'copy', 'split', 'union', 'difference', 'simplify', 'lasso'
      ],
      onFeatureCreate: (feature) => console.log('Created:', feature),
      onSelectionChange: (features) => console.log('Selected:', features.length),
    });

    // Connect with Geoman
    geoEditor.setGeoman(geoman);

    // Add to map
    map.addControl(geoEditor, 'top-left');
  });
});
```

### React Usage

```tsx
import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import { Geoman } from '@geoman-io/maplibre-geoman-free';
import { GeoEditorReact } from 'maplibre-gl-geo-editor/react';

import 'maplibre-gl/dist/maplibre-gl.css';
import '@geoman-io/maplibre-geoman-free/dist/maplibre-geoman.css';
import 'maplibre-gl-geo-editor/style.css';

function App() {
  const mapContainer = useRef(null);
  const [map, setMap] = useState(null);
  const [geoman, setGeoman] = useState(null);

  useEffect(() => {
    const newMap = new maplibregl.Map({
      container: mapContainer.current,
      style: 'https://demotiles.maplibre.org/style.json',
      center: [0, 0],
      zoom: 2,
    });

    newMap.on('load', () => {
      const gm = new Geoman(newMap, {});
      newMap.on('gm:loaded', () => {
        setMap(newMap);
        setGeoman(gm);
      });
    });

    return () => newMap.remove();
  }, []);

  return (
    <div style={{ width: '100%', height: '100vh' }}>
      <div ref={mapContainer} style={{ width: '100%', height: '100%' }} />
      {map && geoman && (
        <GeoEditorReact
          map={map}
          geoman={geoman}
          position="top-left"
          drawModes={['polygon', 'line', 'marker']}
          editModes={['drag', 'change', 'scale', 'copy', 'union', 'split']}
        />
      )}
    </div>
  );
}
```

## API Reference

### GeoEditorOptions

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `position` | `'top-left' \| 'top-right' \| 'bottom-left' \| 'bottom-right'` | `'top-left'` | Position of the control |
| `collapsed` | `boolean` | `false` | Start with toolbar collapsed |
| `drawModes` | `DrawMode[]` | All modes | Draw modes to enable |
| `editModes` | `EditMode[]` | All modes | Edit modes to enable |
| `toolbarOrientation` | `'vertical' \| 'horizontal'` | `'vertical'` | Toolbar layout |
| `showLabels` | `boolean` | `false` | Show text labels on buttons |
| `simplifyTolerance` | `number` | `0.001` | Default simplification tolerance |
| `onFeatureCreate` | `(feature) => void` | - | Callback when feature is created |
| `onFeatureEdit` | `(feature, oldFeature) => void` | - | Callback when feature is edited |
| `onFeatureDelete` | `(featureId) => void` | - | Callback when feature is deleted |
| `onSelectionChange` | `(features) => void` | - | Callback when selection changes |
| `onModeChange` | `(mode) => void` | - | Callback when mode changes |

### Methods

```typescript
// Mode management
geoEditor.enableDrawMode('polygon');
geoEditor.enableEditMode('scale');
geoEditor.disableAllModes();

// Selection
geoEditor.selectFeatures(features);
geoEditor.clearSelection();
geoEditor.getSelectedFeatures();

// Clipboard
geoEditor.copySelectedFeatures();
geoEditor.pasteFeatures();
geoEditor.deleteSelectedFeatures();

// Get all features
geoEditor.getFeatures();

// Get state
geoEditor.getState();
```

### Events

Listen for events on the map container:

```typescript
map.getContainer().addEventListener('gm:union', (e) => {
  console.log('Union result:', e.detail);
});

map.getContainer().addEventListener('gm:split', (e) => {
  console.log('Split result:', e.detail);
});

map.getContainer().addEventListener('gm:simplify', (e) => {
  console.log('Simplify result:', e.detail);
});

map.getContainer().addEventListener('gm:lassoend', (e) => {
  console.log('Lasso selection:', e.detail);
});
```

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+C` | Copy selected features |
| `Ctrl+V` | Paste features |
| `Delete` | Delete selected features |
| `Escape` | Cancel operation / Clear selection |

## Standalone Feature Classes

You can also use the feature classes directly:

```typescript
import {
  CopyFeature,
  SimplifyFeature,
  UnionFeature,
  DifferenceFeature,
  ScaleFeature,
  SplitFeature,
} from 'maplibre-gl-geo-editor';

// Union polygons
const union = new UnionFeature();
const result = union.union([polygon1, polygon2]);

// Simplify a feature
const simplify = new SimplifyFeature();
const simplified = simplify.simplify(feature, { tolerance: 0.01 });

// Get simplification stats
const stats = simplify.getSimplificationStats(feature, 0.01);
console.log(`Reduced vertices by ${stats.reduction}%`);
```

## Development

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Run tests
npm test

# Build
npm run build
```

## Dependencies

- [MapLibre GL JS](https://maplibre.org/) - Map rendering
- [@geoman-io/maplibre-geoman-free](https://geoman.io/) - Basic drawing/editing
- [@turf/turf](https://turfjs.org/) - Geometry operations

## License

MIT License - see [LICENSE](LICENSE) for details.

## Credits

- [Geoman](https://geoman.io/) for the excellent free drawing/editing plugin
- [Turf.js](https://turfjs.org/) for powerful geometry operations
- Inspired by [maplibre-gl-layer-control](https://github.com/opengeos/maplibre-gl-layer-control)
