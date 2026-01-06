import React, { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import { Geoman } from '@geoman-io/maplibre-geoman-free';
import { GeoEditorReact } from '../../src/react';
import type { GeomanInstance } from '../../src/lib/core/types';

import 'maplibre-gl/dist/maplibre-gl.css';
import '@geoman-io/maplibre-geoman-free/dist/maplibre-geoman.css';
import '../../src/lib/styles/geo-editor.css';

function App() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [map, setMap] = useState<maplibregl.Map | null>(null);
  const [geoman, setGeoman] = useState<GeomanInstance | null>(null);
  const [featureCount, setFeatureCount] = useState(0);
  const [selectedCount, setSelectedCount] = useState(0);

  // Initialize map
  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return;

    const newMap = new maplibregl.Map({
      container: mapContainer.current,
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
      center: [-122.4194, 37.7749],
      zoom: 12,
    });

    mapRef.current = newMap;

    newMap.on('load', () => {
      // Initialize Geoman
      const gm = new Geoman(newMap, {});

      newMap.on('gm:loaded', () => {
        setMap(newMap);
        setGeoman(gm as unknown as GeomanInstance);

        // Add sample features
        gm.features.importGeoJsonFeature({
          type: 'Feature',
          id: 'sample-1',
          properties: { name: 'Sample 1' },
          geometry: {
            type: 'Polygon',
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
        });

        gm.features.importGeoJsonFeature({
          type: 'Feature',
          id: 'sample-2',
          properties: { name: 'Sample 2' },
          geometry: {
            type: 'Polygon',
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
        });

        updateFeatureCount(gm);
      });
    });

    return () => {
      newMap.remove();
      mapRef.current = null;
    };
  }, []);

  const updateFeatureCount = (gm: Geoman) => {
    const features = gm.features.getFeatures();
    setFeatureCount(features.features.length);
  };

  const handleFeatureCreate = () => {
    if (geoman) {
      updateFeatureCount(geoman as unknown as Geoman);
    }
  };

  const handleFeatureDelete = () => {
    if (geoman) {
      updateFeatureCount(geoman as unknown as Geoman);
    }
  };

  const handleSelectionChange = (features: unknown[]) => {
    setSelectedCount(features.length);
  };

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <div ref={mapContainer} style={{ width: '100%', height: '100%' }} />

      {map && geoman && (
        <GeoEditorReact
          map={map}
          geoman={geoman}
          position="top-left"
          collapsed={false}
          toolbarOrientation="vertical"
          drawModes={['polygon', 'line', 'rectangle', 'circle', 'marker']}
          editModes={[
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
          ]}
          onFeatureCreate={handleFeatureCreate}
          onFeatureDelete={handleFeatureDelete}
          onSelectionChange={handleSelectionChange}
        />
      )}

      {/* Info Panel */}
      <div
        style={{
          position: 'absolute',
          top: 10,
          right: 10,
          background: 'white',
          padding: 16,
          borderRadius: 8,
          boxShadow: '0 2px 10px rgba(0,0,0,0.1)',
          maxWidth: 280,
          zIndex: 1000,
        }}
      >
        <h3 style={{ marginBottom: 12, fontSize: 14 }}>GeoEditor React Demo</h3>

        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, color: '#666' }}>
            Features: <strong>{featureCount}</strong>
          </div>
          <div style={{ fontSize: 12, color: '#666' }}>
            Selected: <strong>{selectedCount}</strong>
          </div>
        </div>

        <div style={{ fontSize: 11, color: '#888' }}>
          <p style={{ marginBottom: 8 }}>
            <strong>Draw:</strong> Click tools to draw shapes
          </p>
          <p style={{ marginBottom: 8 }}>
            <strong>Edit:</strong> Select shapes then use edit tools
          </p>
          <p style={{ marginBottom: 8 }}>
            <strong>Advanced:</strong> Union, Split, Simplify, etc.
          </p>
          <p>
            <strong>Shortcuts:</strong> Ctrl+C (copy), Ctrl+V (paste), Del
            (delete)
          </p>
        </div>
      </div>
    </div>
  );
}

export default App;
