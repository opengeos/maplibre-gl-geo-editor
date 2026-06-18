import { describe, it, expect, beforeEach } from 'vitest';
import { GeoEditor } from '../../src/lib/core/GeoEditor';
import type { Feature } from 'geojson';

/**
 * Build a fake Geoman draw instance whose `lineDrawer` mimics the internals
 * that `finishActiveLineOrPolygonDraw` drives: the committed vertices
 * (`shapeLngLats`), the click-event data factory, and the `lineFinished` /
 * `polygonFinished` completion methods (recorded as spies).
 */
function makeGeoman(
  mode: 'polygon' | 'line',
  shapeLngLats: Array<[number, number] | { lng: number; lat: number }>
) {
  const calls: { method: string; eventData: unknown }[] = [];

  const toPair = (p: [number, number] | { lng: number; lat: number }): [number, number] =>
    Array.isArray(p) ? p : [p.lng, p.lat];

  const lineDrawer = {
    shapeLngLats,
    getMarkerClickEventData(markerIndex: number) {
      const coordinates = shapeLngLats.map(toPair);
      const geoJson: Feature = {
        type: 'Feature',
        properties: { shape: 'line' },
        geometry: { type: 'LineString', coordinates },
      };
      return { markerIndex, shapeCoordinates: coordinates, geoJson, bounds: null };
    },
  };

  const instance = {
    lineDrawer,
    lineFinished(eventData: unknown) {
      calls.push({ method: 'lineFinished', eventData });
    },
    polygonFinished(eventData: unknown) {
      calls.push({ method: 'polygonFinished', eventData });
    },
  };

  return {
    geoman: { actionInstances: { [`draw__${mode}`]: instance } },
    calls,
  };
}

function makeEditor(mode: 'polygon' | 'line' | null, geoman: unknown) {
  const editor = new GeoEditor();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (editor as any).geoman = geoman;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (editor as any).state.activeDrawMode = mode;
  return editor;
}

function finish(editor: GeoEditor): boolean {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (editor as any).finishActiveLineOrPolygonDraw();
}

describe('finishActiveLineOrPolygonDraw', () => {
  it('finishes a polygon and drops the double-click duplicate vertex', () => {
    // p0, p1, p2, then a duplicate p2 from the second click of the double-click.
    const { geoman, calls } = makeGeoman('polygon', [
      [0, 0],
      [1, 0],
      [1, 1],
      [1, 1],
    ]);
    const editor = makeEditor('polygon', geoman);

    expect(finish(editor)).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('polygonFinished');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ring = (calls[0].eventData as any).geoJson.geometry.coordinates;
    expect(ring).toEqual([
      [0, 0],
      [1, 0],
      [1, 1],
    ]);
  });

  it('finishes a polygon without a duplicate (e.g. right-click)', () => {
    const { geoman, calls } = makeGeoman('polygon', [
      [0, 0],
      [1, 0],
      [1, 1],
    ]);
    const editor = makeEditor('polygon', geoman);

    expect(finish(editor)).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ring = (calls[0].eventData as any).geoJson.geometry.coordinates;
    expect(ring).toEqual([
      [0, 0],
      [1, 0],
      [1, 1],
    ]);
  });

  it('does not finish a polygon with fewer than three vertices', () => {
    const { geoman, calls } = makeGeoman('polygon', [
      [0, 0],
      [0, 0],
    ]);
    const editor = makeEditor('polygon', geoman);

    expect(finish(editor)).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('finishes a line at the last real vertex, dropping the duplicate', () => {
    const { geoman, calls } = makeGeoman('line', [
      [0, 0],
      [1, 1],
      [1, 1],
    ]);
    const editor = makeEditor('line', geoman);

    expect(finish(editor)).toBe(true);
    expect(calls[0].method).toBe('lineFinished');
    // count = 3, duplicate present -> endIndex = count - 2 = 1
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((calls[0].eventData as any).markerIndex).toBe(1);
  });

  it('keeps all line vertices when there is no duplicate', () => {
    const { geoman, calls } = makeGeoman('line', [
      [0, 0],
      [1, 1],
    ]);
    const editor = makeEditor('line', geoman);

    expect(finish(editor)).toBe(true);
    // count = 2, no duplicate -> endIndex = count - 1 = 1
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((calls[0].eventData as any).markerIndex).toBe(1);
  });

  it('does not finish a line with fewer than two distinct vertices', () => {
    const { geoman, calls } = makeGeoman('line', [
      [0, 0],
      [0, 0],
    ]);
    const editor = makeEditor('line', geoman);

    expect(finish(editor)).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('treats LngLat objects and tuples as the same vertex', () => {
    const { geoman, calls } = makeGeoman('polygon', [
      [0, 0],
      [1, 0],
      [1, 1],
      { lng: 1, lat: 1 },
    ]);
    const editor = makeEditor('polygon', geoman);

    expect(finish(editor)).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ring = (calls[0].eventData as any).geoJson.geometry.coordinates;
    expect(ring).toHaveLength(3);
  });

  it('does nothing when no draw mode is active', () => {
    const { geoman, calls } = makeGeoman('polygon', [
      [0, 0],
      [1, 0],
      [1, 1],
    ]);
    const editor = makeEditor(null, geoman);

    expect(finish(editor)).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('bails out gracefully on an incompatible Geoman build', () => {
    const editor = makeEditor('polygon', { actionInstances: {} });
    expect(finish(editor)).toBe(false);
  });
});
