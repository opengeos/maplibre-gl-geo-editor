# maplibre-gl-geo-editor

A powerful MapLibre GL plugin for creating and editing geometries. Extends the free [Geoman](https://geoman.io/docs/maplibre/) control with advanced editing features including Union, Split, Scale, Difference, Simplify, Copy, and Lasso selection.

[![npm version](https://img.shields.io/npm/v/maplibre-gl-geo-editor.svg)](https://www.npmjs.com/package/maplibre-gl-geo-editor)
[![npm downloads](https://img.shields.io/npm/dm/maplibre-gl-geo-editor.svg)](https://www.npmjs.com/package/maplibre-gl-geo-editor)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Open in CodeSandbox](https://img.shields.io/badge/Open%20in-CodeSandbox-blue?logo=codesandbox)](https://codesandbox.io/p/github/opengeos/maplibre-gl-geo-editor)
[![Open in StackBlitz](https://img.shields.io/badge/Open%20in-StackBlitz-blue?logo=stackblitz)](https://stackblitz.com/github/opengeos/maplibre-gl-geo-editor)

## Features

### Draw Tools
- **Polygon** - Draw polygons by clicking points; **double-click or right-click to finish**
- **Line** - Draw polylines; **double-click or right-click to finish**
- **Rectangle** - Draw rectangles
- **Circle** - Draw circles
- **Marker** - Place point markers
- **Freehand** - Draw shapes by dragging (custom implementation)

> Polygons and lines can also be completed the Geoman way — by clicking the
> first/last vertex — but a double-click or right-click ends the shape too, as
> in most drawing tools.

### Basic Edit Tools (via Geoman Free)
- **Drag** - Move features on the map
- **Edit** - Modify feature vertices
- **Rotate** - Rotate features by dragging, or double-click / right-click a feature to type an exact angle in degrees around the centroid or a chosen vertex
- **Cut** - Cut holes in polygons
- **Delete** - Remove selected features (supports multi-select)

### Advanced Edit Tools (Custom Implementation)
- **Select** - Click to select features (shows properties popup when enabled)
- **Scale** - Resize features with interactive handles
- **Copy** - Duplicate features (Ctrl+C/V support)
- **Split** - Split polygons/lines with a drawn line
- **Union** - Merge multiple polygons into one
- **Difference** - Subtract one polygon from another
- **Simplify** - Reduce vertices using Douglas-Peucker algorithm
- **Lasso** - Select multiple features by drawing a polygon (supports union/difference/drag)
- **Reset** - Clear selection and disable active tools (toolbar button)

### Attribute Editing
- **Side Panel** - Edit feature properties in a slide-out panel
- **Schema Support** - Define field types per geometry (polygon, line, point)
- **Field Types** - String, number, boolean, select, date, color, textarea
- **Default Values** - Auto-apply defaults to newly created features
- **Validation** - Required field validation with error display
- **Extra Properties** - Non-schema properties shown as read-only

### File Operations
- **Open** - Load GeoJSON file from disk (auto-zooms to extent when enabled)
- **Save** - Download current features as GeoJSON file

### History (Undo/Redo)
- **Undo** - Revert the last create, edit, or delete operation (Ctrl+Z)
- **Redo** - Reapply the last undone operation (Ctrl+Y)
- Configurable history size (default: 50 operations)

## Installation

```bash
npm install maplibre-gl-geo-editor @geoman-io/maplibre-geoman-free@^0.9.1 maplibre-gl@^6
```

Requires Geoman Free 0.9.1 (0.9.x) and MapLibre GL JS 6.x. Both dependencies
use ESM; MapLibre 6 requires named or namespace imports rather than a default import.

With Vite, configure the worker before creating any maps:

```typescript
import { setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
setWorkerUrl(workerUrl);
```

The `?worker&url` query bundles the worker's dependencies for production too.
Other bundlers require their own worker setup; see the
[MapLibre installation guide](https://maplibre.org/maplibre-gl-js/docs/#installation).


## Snap target events

Enable local snap observation to identify the feature and vertex or segment
selected by Geoman. No Geoman fork or upstream patch is required.

```typescript
const editor = new GeoEditor({
  snapEventsEnabled: true,
  onSnap: ({ coordinate, target }) => {
    if (target.kind === 'custom') return; // No feature identity for custom coordinates
    console.log(target.featureId, target.feature.properties, coordinate);
    if (target.kind === 'vertex') {
      console.log(target.coordinatePath); // e.g. ['geometry', 'coordinates', 2]
    } else {
      console.log(target.segmentPaths); // Paths to both segment endpoints
    }
  },
  onUnsnap: () => console.log('Snap target cleared'),
});
```

The same payloads are emitted as `CustomEvent.detail` on `map.getContainer()`
under `gm:snap` and `gm:unsnap`, following this editor's existing event convention.
These are not MapLibre `map.on()` events. `onSnap` fires for each resolved snap
calculation; `onUnsnap` fires when the target changes or is cleared.
`editor.getSnapTarget()` returns a copy of the latest preview or `null`.
`editor.isSnapTrackingAvailable()` reports whether an active compatible snapping
helper is being observed; it is false while the helper is disabled or unavailable.

Targets contain a snapshot of the target GeoJSON and its properties. `featureId`
is Geoman's ID, not automatically an OSM ID; use your application's identity
mapping. Paths address the snapshot Feature, including polygon ring and multipart
indices. Coincident features follow Geoman's actual selection order. Custom snaps
have no feature metadata, and temporary feature targets are marked `temporary`.

**These are preview events, not vertex-commit events.** Applications must associate
previews with their draw/edit transactions and verify the committed vertex before
changing node references. This feature does not merge nodes, preserve an OSM graph,
or generate changesets. Keep NWR IDs, versions, and relations in application state.

The observer wraps methods on the active helper instance and restores them when
Geoman is replaced or the editor is removed. Its internal integration and segment
selection assumptions are tested against Geoman Free 0.9.1. Run the snap tests
when upgrading Geoman; unsupported helper shapes leave tracking unavailable.

### Getting the identity of a snapped node

Use the selected feature **and its vertex path** to look up the node identity.
`target.featureId` identifies the Geoman feature (for example, a way), while
`target.coordinatePath` identifies the vertex within that feature. Equal
coordinates alone do not establish that two vertices are the same OSM node.

Store the original node IDs and versions alongside your geometry when loading
data. For example, a three-vertex LineString can carry these application-defined
properties, ordered exactly like its `geometry.coordinates`:

```typescript
const properties = {
  osm_id: 'way/201',
  osm_version: 7,
  node_ids: ['node/101', 'node/102', 'node/103'],
  node_versions: [2, 5, 1],
};
```

Then resolve vertex snaps in the editor callback:

```typescript
import { GeoEditor } from 'maplibre-gl-geo-editor';

const editor = new GeoEditor({
  snapEventsEnabled: true,
  onSnap: ({ target }) => {
    if (target.kind !== 'vertex') return;
    const feature = target.feature;
    if (feature.geometry.type !== 'LineString') return;

    // LineString path: ['geometry', 'coordinates', vertexIndex]
    const vertexIndex = target.coordinatePath[2];
    const { node_ids, node_versions } = feature.properties ?? {};
    if (typeof vertexIndex !== 'number' || !Array.isArray(node_ids)) return;
    if (node_ids.length !== feature.geometry.coordinates.length) return;

    console.log({
      featureId: target.featureId,
      nodeId: node_ids[vertexIndex],
      nodeVersion: Array.isArray(node_versions) && node_versions.length === node_ids.length
        ? node_versions[vertexIndex]
        : undefined,
    });
  },
});

// Connect to your existing Geoman instance and map.
editor.setGeoman(geoman);
map.addControl(editor, 'top-left');
```

The `node_ids` and `node_versions` fields above are your application's metadata;
Geoman does not fetch or populate them. A way's version is separate from each
referenced node's version. You can instead keep this information in an external
store keyed by the editor feature ID and vertex path.

For other geometries, include every part and ring index when resolving a path:

| Target geometry | Vertex path | Suggested node-ID lookup |
| --- | --- | --- |
| LineString | `['geometry', 'coordinates', vertex]` | `node_ids[vertex]` |
| MultiLineString | `['geometry', 'coordinates', part, vertex]` | `node_ids[part][vertex]` |
| Polygon | `['geometry', 'coordinates', ring, vertex]` | `node_ids[ring][vertex]` |
| MultiPolygon | `['geometry', 'coordinates', polygon, ring, vertex]` | `node_ids[polygon][ring][vertex]` |

For polygons, ring `0` is the exterior and later rings are holes. Mirror that
structure in your metadata; the closing coordinate must reference the same node
ID as the first coordinate. For a segment snap, resolve both paths in
`target.segmentPaths` to identify its endpoint nodes. A snap to the segment's
interior does not identify an existing node at the snapped position.

Keep these mappings synchronized with edits: moving a vertex retains its ID,
inserting a vertex adds a new local ID, and deleting a vertex removes its
reference. Do not simply renumber existing nodes after an insertion. Connecting
or merging nodes requires an explicit application-level topology operation when
the edit is committed, rather than updating references on every snap preview.

Try the [Snap Target Inspector](examples/snapping/index.html) on the examples
page. It displays node IDs, way versions, segment
endpoints, and the event payload. Its LineString demo preserves existing IDs
during vertex edits and assigns inserted vertices IDs such as `local/node-1`.

## Usage

### Basic Usage (Vanilla JS/TS)

```typescript
import 'maplibre-gl/dist/maplibre-gl.css';
import '@geoman-io/maplibre-geoman-free/dist/maplibre-geoman.css';
import 'maplibre-gl-geo-editor/style.css';

import * as maplibregl from 'maplibre-gl';
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
      columns: 2,  // Display buttons in 2 columns (reduces toolbar height)
      drawModes: ['polygon', 'line', 'rectangle', 'circle', 'marker', 'freehand'],
      editModes: [
        'select', 'drag', 'change', 'rotate', 'cut', 'delete',
        'scale', 'copy', 'split', 'union', 'difference', 'simplify', 'lasso'
      ],
      showFeatureProperties: true,  // Show popup with properties on selection
      fitBoundsOnLoad: true,        // Auto-zoom to extent when loading GeoJSON
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

### Attribute Editing

Enable the attribute editing panel to edit feature properties with a schema-based form:

```typescript
const geoEditor = new GeoEditor({
  position: 'top-left',
  enableAttributeEditing: true,
  attributePanelPosition: 'right',  // 'left' or 'right'
  attributePanelWidth: 300,
  attributePanelTitle: 'Feature Properties',
  attributeSchema: {
    // Fields for polygon features
    polygon: [
      { name: 'name', label: 'Name', type: 'string', required: true },
      {
        name: 'land_use',
        label: 'Land Use',
        type: 'select',
        options: [
          { value: 'residential', label: 'Residential' },
          { value: 'commercial', label: 'Commercial' },
          { value: 'industrial', label: 'Industrial' },
        ],
        defaultValue: 'residential'
      },
      { name: 'description', label: 'Description', type: 'textarea' }
    ],
    // Fields for line features
    line: [
      { name: 'name', label: 'Name', type: 'string', required: true },
      { name: 'road_type', label: 'Road Type', type: 'string' },
      { name: 'lanes', label: 'Lanes', type: 'number', min: 1, max: 8 }
    ],
    // Fields for point features
    point: [
      { name: 'name', label: 'Name', type: 'string', required: true },
      { name: 'category', label: 'Category', type: 'string' },
      { name: 'active', label: 'Active', type: 'boolean', defaultValue: true }
    ],
    // Common fields for all geometry types
    common: [
      { name: 'notes', label: 'Notes', type: 'textarea' },
      { name: 'color', label: 'Color', type: 'color', defaultValue: '#3388ff' }
    ]
  },
  onAttributeChange: (event) => {
    console.log('Feature:', event.feature);
    console.log('Previous:', event.previousProperties);
    console.log('New:', event.newProperties);
    console.log('Is new feature:', event.isNewFeature);
  }
});
```

The panel auto-appears when:
- A new geometry is drawn (after drawing completes)
- A single feature is selected in select mode

#### Field Types

| Type | Description | Additional Options |
|------|-------------|-------------------|
| `string` | Single-line text input | `placeholder` |
| `number` | Numeric input | `min`, `max`, `step` |
| `boolean` | Checkbox | - |
| `select` | Dropdown select | `options: [{value, label}]` |
| `date` | Date picker | - |
| `color` | Color picker | - |
| `textarea` | Multi-line text | `placeholder` |

#### Programmatic Control

```typescript
// Open editor for a specific feature
geoEditor.openAttributeEditor(feature);

// Close the editor
geoEditor.closeAttributeEditor();

// Toggle visibility
geoEditor.toggleAttributePanel();

// Update schema dynamically
geoEditor.setAttributeSchema(newSchema);

// Get current schema
const schema = geoEditor.getAttributeSchema();
```

### React Usage

```tsx
import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
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
          drawModes={['polygon', 'line', 'marker', 'freehand']}
          editModes={['select', 'drag', 'change', 'scale', 'copy', 'union', 'split']}
          showFeatureProperties={true}
          fitBoundsOnLoad={true}
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
| `fileModes` | `FileMode[]` | `['open', 'save']` | File operations to enable |
| `toolbarOrientation` | `'vertical' \| 'horizontal'` | `'vertical'` | Toolbar layout |
| `columns` | `number` | `1` | Number of button columns (vertical orientation only) |
| `showLabels` | `boolean` | `false` | Show text labels on buttons |
| `simplifyTolerance` | `number` | `0.001` | Default simplification tolerance |
| `saveFilename` | `string` | `'features.geojson'` | Default filename for saving |
| `showFeatureProperties` | `boolean` | `false` | Show popup with feature properties when selected |
| `fitBoundsOnLoad` | `boolean` | `true` | Auto-zoom to extent when loading GeoJSON |
| `onFeatureCreate` | `(feature) => void` | - | Callback when feature is created |
| `onFeatureEdit` | `(feature, oldFeature) => void` | - | Callback when feature is edited |
| `onFeatureDelete` | `(featureId) => void` | - | Callback when feature is deleted |
| `onSelectionChange` | `(features) => void` | - | Callback when selection changes |
| `onModeChange` | `(mode) => void` | - | Callback when mode changes |
| `onGeoJsonLoad` | `(result) => void` | - | Callback when GeoJSON is loaded |
| `onGeoJsonSave` | `(result) => void` | - | Callback when GeoJSON is saved |
| `enableAttributeEditing` | `boolean` | `false` | Enable attribute editing panel |
| `attributeSchema` | `AttributeSchema` | - | Schema defining fields per geometry type |
| `attributePanelPosition` | `'left' \| 'right'` | `'right'` | Position of the attribute panel |
| `attributePanelWidth` | `number` | `300` | Width of the attribute panel in pixels |
| `attributePanelMaxHeight` | `number \| string` | `'80vh'` | Maximum height of the attribute panel (px or CSS value) |
| `attributePanelTop` | `number` | `10` | Offset from top of map container in pixels |
| `attributePanelSideOffset` | `number` | `10` | Offset from left/right side of map container in pixels |
| `attributePanelTitle` | `string` | `'Feature Properties'` | Title of the attribute panel |
| `onAttributeChange` | `(event) => void` | - | Callback when feature attributes change |
| `enableHistory` | `boolean` | `true` | Enable undo/redo functionality |
| `maxHistorySize` | `number` | `50` | Maximum number of history entries |
| `onHistoryChange` | `(canUndo, canRedo) => void` | - | Callback when history state changes |

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
geoEditor.getSelectedFeatureCollection();

// Clipboard
geoEditor.copySelectedFeatures();
geoEditor.pasteFeatures();
geoEditor.deleteSelectedFeatures();

// Get all features
geoEditor.getFeatures();
geoEditor.getAllFeatureCollection();

// File operations
geoEditor.openFileDialog();           // Open file picker dialog
geoEditor.loadGeoJson(geoJson);       // Load GeoJSON programmatically
geoEditor.saveGeoJson('filename.geojson'); // Save/download GeoJSON

// Map view
geoEditor.fitToAllFeatures();         // Zoom map to show all features

// Operation snapshots
geoEditor.getLastCreatedFeature();
geoEditor.getLastEditedFeature();
geoEditor.getLastDeletedFeature();
geoEditor.getLastDeletedFeatureId();

// Get state
geoEditor.getState();

// Attribute editing
geoEditor.openAttributeEditor(feature);   // Open editor for a feature
geoEditor.closeAttributeEditor();         // Close the editor
geoEditor.toggleAttributePanel();         // Toggle visibility
geoEditor.setAttributeSchema(schema);     // Update schema dynamically
geoEditor.getAttributeSchema();           // Get current schema

// History (undo/redo)
geoEditor.undo();                         // Undo last operation
geoEditor.redo();                         // Redo last undone operation
geoEditor.canUndo();                      // Check if undo is available
geoEditor.canRedo();                      // Check if redo is available
geoEditor.clearHistory();                 // Clear all history
geoEditor.getHistoryState();              // Get history state object
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

map.getContainer().addEventListener('gm:rotate', (e) => {
  console.log('Rotated feature:', e.detail);
  // detail: { feature, angle }
});

map.getContainer().addEventListener('gm:geojsonload', (e) => {
  console.log('GeoJSON loaded:', e.detail);
  // detail: { features, count, filename }
});

map.getContainer().addEventListener('gm:geojsonsave', (e) => {
  console.log('GeoJSON saved:', e.detail);
  // detail: { featureCollection, count, filename }
});
```

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+C` | Copy selected features |
| `Ctrl+V` | Paste features |
| `Ctrl+Z` | Undo last operation |
| `Ctrl+Y` | Redo last undone operation |
| `Delete` | Delete selected features |
| `Escape` | Cancel operation / Clear selection |

## Logging

GeoEditor logs the current selected FeatureCollection to the console whenever a feature is selected, created, edited, or deleted.

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
  FreehandFeature,
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

## Docker

The examples can be run using Docker. The image is automatically built and published to GitHub Container Registry.

### Pull and Run

```bash
# Pull the latest image
docker pull ghcr.io/opengeos/maplibre-gl-geo-editor:latest

# Run the container
docker run -p 8080:80 ghcr.io/opengeos/maplibre-gl-geo-editor:latest
```

Then open http://localhost:8080/maplibre-gl-geo-editor/ in your browser to view the examples.

### Build Locally

```bash
# Build the image
docker build -t maplibre-gl-geo-editor .

# Run the container
docker run -p 8080:80 maplibre-gl-geo-editor
```

### Available Tags

| Tag | Description |
|-----|-------------|
| `latest` | Latest release |
| `x.y.z` | Specific version (e.g., `1.0.0`) |
| `x.y` | Minor version (e.g., `1.0`) |


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
