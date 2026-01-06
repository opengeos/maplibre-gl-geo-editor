import { describe, it, expect } from 'vitest';
import * as turf from '@turf/turf';
import { SimplifyFeature } from '../../src/lib/features/SimplifyFeature';

describe('SimplifyFeature', () => {
  const simplifyFeature = new SimplifyFeature();

  describe('simplify', () => {
    it('reduces vertices in a complex polygon', () => {
      // Create a polygon with many vertices
      const coords: [number, number][] = [];
      for (let i = 0; i <= 100; i++) {
        const angle = (i / 100) * 2 * Math.PI;
        const r = 1 + 0.1 * Math.sin(10 * angle);
        coords.push([r * Math.cos(angle), r * Math.sin(angle)]);
      }
      coords.push(coords[0]); // Close the polygon

      const complex = turf.polygon([coords]);
      const simplified = simplifyFeature.simplify(complex, { tolerance: 0.1 });

      const originalVertices = turf.coordAll(complex).length;
      const simplifiedVertices = turf.coordAll(simplified).length;

      expect(simplifiedVertices).toBeLessThan(originalVertices);
    });

    it('preserves simple polygons', () => {
      const simple = turf.polygon([
        [
          [0, 0],
          [0, 1],
          [1, 1],
          [1, 0],
          [0, 0],
        ],
      ]);

      const simplified = simplifyFeature.simplify(simple, { tolerance: 0.01 });

      const originalVertices = turf.coordAll(simple).length;
      const simplifiedVertices = turf.coordAll(simplified).length;

      // Simple polygon should not lose vertices
      expect(simplifiedVertices).toBe(originalVertices);
    });
  });

  describe('simplifyWithStats', () => {
    it('returns correct statistics', () => {
      const coords: [number, number][] = [];
      for (let i = 0; i <= 50; i++) {
        const angle = (i / 50) * 2 * Math.PI;
        coords.push([Math.cos(angle), Math.sin(angle)]);
      }
      coords.push(coords[0]);

      const circle = turf.polygon([coords]);
      const result = simplifyFeature.simplifyWithStats(circle, {
        tolerance: 0.1,
      });

      expect(result.verticesBefore).toBeGreaterThan(0);
      expect(result.verticesAfter).toBeLessThanOrEqual(result.verticesBefore);
      expect(result.reductionPercent).toBeGreaterThanOrEqual(0);
      expect(result.reductionPercent).toBeLessThanOrEqual(100);
    });
  });

  describe('getSimplificationStats', () => {
    it('calculates correct reduction percentage', () => {
      const coords: [number, number][] = [];
      for (let i = 0; i <= 100; i++) {
        const angle = (i / 100) * 2 * Math.PI;
        coords.push([Math.cos(angle), Math.sin(angle)]);
      }
      coords.push(coords[0]);

      const circle = turf.polygon([coords]);
      const stats = simplifyFeature.getSimplificationStats(circle, 0.1);

      expect(stats.before).toBeGreaterThan(stats.after);
      expect(stats.reduction).toBeGreaterThan(0);
    });
  });

  describe('getSuggestedTolerances', () => {
    it('returns higher tolerances for complex features', () => {
      const coords: [number, number][] = [];
      for (let i = 0; i <= 1000; i++) {
        const angle = (i / 1000) * 2 * Math.PI;
        coords.push([Math.cos(angle), Math.sin(angle)]);
      }
      coords.push(coords[0]);

      const complex = turf.polygon([coords]);
      const tolerances = simplifyFeature.getSuggestedTolerances(complex);

      expect(tolerances.length).toBe(5);
      expect(tolerances[0]).toBeGreaterThanOrEqual(0.001);
    });

    it('returns lower tolerances for simple features', () => {
      const simple = turf.polygon([
        [
          [0, 0],
          [0, 1],
          [1, 1],
          [1, 0],
          [0, 0],
        ],
      ]);

      const tolerances = simplifyFeature.getSuggestedTolerances(simple);

      expect(tolerances.length).toBe(5);
      expect(tolerances[0]).toBeLessThanOrEqual(0.0005);
    });
  });
});
