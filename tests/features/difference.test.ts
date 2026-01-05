import { describe, it, expect } from 'vitest';
import * as turf from '@turf/turf';
import { DifferenceFeature } from '../../src/lib/features/DifferenceFeature';

describe('DifferenceFeature', () => {
  const differenceFeature = new DifferenceFeature();

  describe('difference', () => {
    it('returns clone for empty subtract array', () => {
      const base = turf.polygon([
        [
          [0, 0],
          [0, 2],
          [2, 2],
          [2, 0],
          [0, 0],
        ],
      ]);

      const result = differenceFeature.difference(base, []);

      expect(result.success).toBe(true);
      expect(result.result).not.toBeNull();
      expect(result.result?.geometry.type).toBe('Polygon');
    });

    it('subtracts overlapping polygon', () => {
      const base = turf.polygon([
        [
          [0, 0],
          [0, 4],
          [4, 4],
          [4, 0],
          [0, 0],
        ],
      ]);
      const subtract = turf.polygon([
        [
          [1, 1],
          [1, 3],
          [3, 3],
          [3, 1],
          [1, 1],
        ],
      ]);

      const result = differenceFeature.difference(base, [subtract]);

      expect(result.success).toBe(true);
      expect(result.result).not.toBeNull();
      // Result should have a hole
      expect(result.result?.geometry.type).toBe('Polygon');
    });

    it('returns null for complete subtraction', () => {
      const base = turf.polygon([
        [
          [1, 1],
          [1, 2],
          [2, 2],
          [2, 1],
          [1, 1],
        ],
      ]);
      const subtract = turf.polygon([
        [
          [0, 0],
          [0, 3],
          [3, 3],
          [3, 0],
          [0, 0],
        ],
      ]);

      const result = differenceFeature.difference(base, [subtract]);

      expect(result.success).toBe(true);
      expect(result.result).toBeNull();
    });
  });

  describe('canSubtract', () => {
    it('returns true for overlapping polygons', () => {
      const base = turf.polygon([
        [
          [0, 0],
          [0, 4],
          [4, 4],
          [4, 0],
          [0, 0],
        ],
      ]);
      const subtract = turf.polygon([
        [
          [1, 1],
          [1, 3],
          [3, 3],
          [3, 1],
          [1, 1],
        ],
      ]);

      const result = differenceFeature.canSubtract(base, subtract);

      expect(result.canSubtract).toBe(true);
      expect(result.overlap).toBe(true);
    });

    it('returns false for non-overlapping polygons', () => {
      const base = turf.polygon([
        [
          [0, 0],
          [0, 1],
          [1, 1],
          [1, 0],
          [0, 0],
        ],
      ]);
      const subtract = turf.polygon([
        [
          [5, 5],
          [5, 6],
          [6, 6],
          [6, 5],
          [5, 5],
        ],
      ]);

      const result = differenceFeature.canSubtract(base, subtract);

      expect(result.canSubtract).toBe(false);
      expect(result.overlap).toBe(false);
    });
  });

  describe('getSubtractedArea', () => {
    it('returns the intersection area', () => {
      const base = turf.polygon([
        [
          [0, 0],
          [0, 2],
          [2, 2],
          [2, 0],
          [0, 0],
        ],
      ]);
      const subtract = turf.polygon([
        [
          [1, 1],
          [1, 3],
          [3, 3],
          [3, 1],
          [1, 1],
        ],
      ]);

      const area = differenceFeature.getSubtractedArea(base, subtract);

      expect(area).not.toBeNull();
      expect(area).toBeGreaterThan(0);
    });

    it('returns 0 for non-overlapping polygons', () => {
      const base = turf.polygon([
        [
          [0, 0],
          [0, 1],
          [1, 1],
          [1, 0],
          [0, 0],
        ],
      ]);
      const subtract = turf.polygon([
        [
          [5, 5],
          [5, 6],
          [6, 6],
          [6, 5],
          [5, 5],
        ],
      ]);

      const area = differenceFeature.getSubtractedArea(base, subtract);

      expect(area).toBe(0);
    });
  });
});
