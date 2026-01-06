import 'maplibre-gl/dist/maplibre-gl.css';
import '@geoman-io/maplibre-geoman-free/dist/maplibre-geoman.css';
import '../../src/lib/styles/geo-editor.css';

import maplibregl from 'maplibre-gl';
import { Geoman } from '@geoman-io/maplibre-geoman-free';
import { GeoEditor } from '../../src/lib/core/GeoEditor';

// Create the map
const map = new maplibregl.Map({
  container: 'map',
  style: {
    version: 8,
    sources: {
      osm: {
        type: 'raster',
        tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
        tileSize: 256,
        attribution: '&copy; OpenStreetMap contributors',
      },
    },
    layers: [
      {
        id: 'osm',
        type: 'raster',
        source: 'osm',
      },
    ],
  },
  center: [-122.4194, 37.7749], // San Francisco
  zoom: 12,
});

// Wait for map to load
map.on('load', () => {
  // Initialize Geoman (free version)
  const geoman = new Geoman(map, {
    // Geoman options
  });

  // Wait for Geoman to load
  map.on('gm:loaded', () => {
    console.log('Geoman loaded');

    // Create GeoEditor control with advanced features
    const geoEditor = new GeoEditor({
      position: 'top-left',
      collapsed: false,
      toolbarOrientation: 'vertical',
      columns: 2,
      showLabels: false,
      showFeatureProperties: true,
      drawModes: [
        'polygon',
        'line',
        'rectangle',
        'circle',
        'marker',
        'circle_marker',
        'ellipse',
        'freehand',
      ],
      editModes: [
        'select',
        'drag',
        'change',
        'rotate',
        'cut',
        'delete',
        'scale',
        'copy',
        'split',
        'union',
        'difference',
        'simplify',
        'lasso',
      ],
      fileModes: ['open', 'save'],
      saveFilename: 'my-features.geojson',
      onFeatureCreate: (feature) => {
        console.log('Feature created:', feature);
      },
      onFeatureEdit: (feature, oldFeature) => {
        console.log('Feature edited:', feature, 'was:', oldFeature);
      },
      onFeatureDelete: (featureId) => {
        console.log('Feature deleted:', featureId);
      },
      onSelectionChange: (features) => {
        console.log('Selection changed:', features.length, 'features');
      },
      onModeChange: (mode) => {
        console.log('Mode changed:', mode);
      },
      onGeoJsonLoad: (result) => {
        console.log(`Loaded ${result.count} features from ${result.filename}`);
      },
      onGeoJsonSave: (result) => {
        console.log(`Saved ${result.count} features to ${result.filename}`);
      },
    });

    // Connect GeoEditor with Geoman
    geoEditor.setGeoman(geoman);

    // Add the control to the map
    map.addControl(geoEditor, 'top-left');

    // Listen for GeoEditor events
    const container = map.getContainer();

    container.addEventListener('gm:copy', (e) => {
      console.log('Copy event:', (e as CustomEvent).detail);
    });

    container.addEventListener('gm:paste', (e) => {
      console.log('Paste event:', (e as CustomEvent).detail);
    });

    container.addEventListener('gm:union', (e) => {
      console.log('Union event:', (e as CustomEvent).detail);
    });

    container.addEventListener('gm:difference', (e) => {
      console.log('Difference event:', (e as CustomEvent).detail);
    });

    container.addEventListener('gm:split', (e) => {
      console.log('Split event:', (e as CustomEvent).detail);
    });

    container.addEventListener('gm:simplify', (e) => {
      console.log('Simplify event:', (e as CustomEvent).detail);
    });

    container.addEventListener('gm:lassoend', (e) => {
      console.log('Lasso selection:', (e as CustomEvent).detail);
    });

    container.addEventListener('gm:geojsonload', (e) => {
      console.log('GeoJSON loaded:', (e as CustomEvent).detail);
    });

    container.addEventListener('gm:geojsonsave', (e) => {
      console.log('GeoJSON saved:', (e as CustomEvent).detail);
    });

    // Add some sample features for demonstration
    const samplePolygon = {
      type: 'Feature' as const,
      id: 'sample-polygon',
      properties: { name: 'Sample Polygon' },
      geometry: {
        type: 'Polygon' as const,
        coordinates: [
          [
            [-122.43, 37.79],
            [-122.43, 37.77],
            [-122.41, 37.77],
            [-122.41, 37.79],
            [-122.43, 37.79],
          ],
        ],
      },
    };

    const samplePolygon2 = {
      type: 'Feature' as const,
      id: 'sample-polygon-2',
      properties: { name: 'Sample Polygon 2' },
      geometry: {
        type: 'Polygon' as const,
        coordinates: [
          [
            [-122.42, 37.78],
            [-122.42, 37.76],
            [-122.40, 37.76],
            [-122.40, 37.78],
            [-122.42, 37.78],
          ],
        ],
      },
    };

    // Import sample features
    geoman.features.importGeoJsonFeature(samplePolygon);
    geoman.features.importGeoJsonFeature(samplePolygon2);

    console.log('GeoEditor initialized with sample features');
  });
});

// Handle errors
map.on('error', (e) => {
  console.error('Map error:', e);
});
