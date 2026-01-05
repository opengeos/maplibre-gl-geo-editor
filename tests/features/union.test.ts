import { describe, it, expect } from 'vitest';
import * as turf from '@turf/turf';
import { UnionFeature } from '../../src/lib/features/UnionFeature';

describe('UnionFeature', () => {
  const unionFeature = new UnionFeature();

  describe('union', () => {
    it('returns null for empty input', () => {
      const result = unionFeature.union([]);
      expect(result.success).toBe(false);
      expect(result.result).toBeNull();
    });

    it('returns cloned feature for single input', () => {
      const poly = turf.polygon([
        [
          [0, 0],
          [0, 2],
          [2, 2],
          [2, 0],
          [0, 0],
        ],
      ]);

      const result = unionFeature.union([poly]);
      expect(result.success).toBe(true);
      expect(result.result).not.toBeNull();
      expect(result.result?.geometry.type).toBe('Polygon');
    });

    it('merges two overlapping polygons', () => {
      const poly1 = turf.polygon([
        [
          [0, 0],
          [0, 2],
          [2, 2],
          [2, 0],
          [0, 0],
        ],
      ]);
      const poly2 = turf.polygon([
        [
          [1, 1],
          [1, 3],
          [3, 3],
          [3, 1],
          [1, 1],
        ],
      ]);

      const result = unionFeature.union([poly1, poly2]);

      expect(result.success).toBe(true);
      expect(result.result).not.toBeNull();
      expect(result.result?.geometry.type).toBe('Polygon');
    });

    it('creates MultiPolygon for non-overlapping polygons', () => {
      const poly1 = turf.polygon([
        [
          [0, 0],
          [0, 1],
          [1, 1],
          [1, 0],
          [0, 0],
        ],
      ]);
      const poly2 = turf.polygon([
        [
          [5, 5],
          [5, 6],
          [6, 6],
          [6, 5],
          [5, 5],
        ],
      ]);

      const result = unionFeature.union([poly1, poly2]);

      expect(result.success).toBe(true);
      expect(result.result?.geometry.type).toBe('MultiPolygon');
    });

    it('assigns new ID to result', () => {
      const poly1 = turf.polygon([
        [
          [0, 0],
          [0, 2],
          [2, 2],
          [2, 0],
          [0, 0],
        ],
      ]);
      poly1.id = 'original-id';

      const result = unionFeature.union([poly1]);

      expect(result.result?.id).not.toBe('original-id');
      expect(typeof result.result?.id).toBe('string');
    });
  });

  describe('canMerge', () => {
    it('returns false for less than 2 features', () => {
      const result = unionFeature.canMerge([]);
      expect(result.canMerge).toBe(false);
    });

    it('returns true for 2 or more polygons', () => {
      const poly1 = turf.polygon([
        [
          [0, 0],
          [0, 1],
          [1, 1],
          [1, 0],
          [0, 0],
        ],
      ]);
      const poly2 = turf.polygon([
        [
          [2, 2],
          [2, 3],
          [3, 3],
          [3, 2],
          [2, 2],
        ],
      ]);

      const result = unionFeature.canMerge([poly1, poly2]);
      expect(result.canMerge).toBe(true);
    });
  });

  describe('hasOverlap', () => {
    it('returns true for overlapping polygons', () => {
      const poly1 = turf.polygon([
        [
          [0, 0],
          [0, 2],
          [2, 2],
          [2, 0],
          [0, 0],
        ],
      ]);
      const poly2 = turf.polygon([
        [
          [1, 1],
          [1, 3],
          [3, 3],
          [3, 1],
          [1, 1],
        ],
      ]);

      expect(unionFeature.hasOverlap([poly1, poly2])).toBe(true);
    });

    it('returns false for non-overlapping polygons', () => {
      const poly1 = turf.polygon([
        [
          [0, 0],
          [0, 1],
          [1, 1],
          [1, 0],
          [0, 0],
        ],
      ]);
      const poly2 = turf.polygon([
        [
          [5, 5],
          [5, 6],
          [6, 6],
          [6, 5],
          [5, 5],
        ],
      ]);

      expect(unionFeature.hasOverlap([poly1, poly2])).toBe(false);
    });
  });
});
