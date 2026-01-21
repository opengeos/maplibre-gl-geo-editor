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
      // Enable attribute editing panel instead of popup
      enableAttributeEditing: true,
      attributePanelPosition: 'right',
      attributePanelWidth: 320,
      attributePanelMaxHeight: '70vh', // Limit panel height (can also use pixels like 500)
      attributePanelTop: 10, // Offset from top (useful to avoid other controls)
      attributePanelSideOffset: 10, // Offset from right/left edge
      attributePanelTitle: 'Feature Properties',
      // Define attribute schema for different geometry types
      attributeSchema: {
        polygon: [
          { name: 'name', label: 'Name', type: 'string', required: true, placeholder: 'Enter name...' },
          {
            name: 'land_use',
            label: 'Land Use',
            type: 'select',
            options: [
              { value: 'residential', label: 'Residential' },
              { value: 'commercial', label: 'Commercial' },
              { value: 'industrial', label: 'Industrial' },
              { value: 'park', label: 'Park/Recreation' },
            ],
            defaultValue: 'residential',
          },
          { name: 'area_sqm', label: 'Area (sq m)', type: 'number', min: 0 },
          { name: 'description', label: 'Description', type: 'textarea', placeholder: 'Enter description...' },
        ],
        line: [
          { name: 'name', label: 'Name', type: 'string', required: true },
          {
            name: 'road_type',
            label: 'Road Type',
            type: 'select',
            options: [
              { value: 'highway', label: 'Highway' },
              { value: 'main', label: 'Main Road' },
              { value: 'residential', label: 'Residential Street' },
              { value: 'path', label: 'Path/Trail' },
            ],
          },
          { name: 'lanes', label: 'Lanes', type: 'number', min: 1, max: 8, step: 1 },
          { name: 'speed_limit', label: 'Speed Limit (km/h)', type: 'number', min: 5, max: 130, step: 5 },
        ],
        point: [
          { name: 'name', label: 'Name', type: 'string', required: true },
          {
            name: 'category',
            label: 'Category',
            type: 'select',
            options: [
              { value: 'poi', label: 'Point of Interest' },
              { value: 'landmark', label: 'Landmark' },
              { value: 'facility', label: 'Facility' },
              { value: 'other', label: 'Other' },
            ],
            defaultValue: 'poi',
          },
          { name: 'active', label: 'Active', type: 'boolean', defaultValue: true },
        ],
        common: [
          { name: 'notes', label: 'Notes', type: 'textarea' },
          { name: 'color', label: 'Color', type: 'color', defaultValue: '#3388ff' },
          { name: 'created_date', label: 'Created Date', type: 'date' },
        ],
      },
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
      onAttributeChange: (event) => {
        console.log('Attribute changed:', {
          isNew: event.isNewFeature,
          previous: event.previousProperties,
          new: event.newProperties,
        });
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
      properties: {
        name: 'Downtown District',
        land_use: 'commercial',
        area_sqm: 45000,
        description: 'Main commercial district with shops and offices',
        notes: 'High foot traffic area',
        color: '#ff6b6b',
      },
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
      properties: {
        name: 'Residential Area',
        land_use: 'residential',
        area_sqm: 32000,
        description: 'Quiet residential neighborhood',
        color: '#4ecdc4',
      },
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
