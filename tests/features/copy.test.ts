import { describe, it, expect } from 'vitest';
import * as turf from '@turf/turf';
import { CopyFeature } from '../../src/lib/features/CopyFeature';

describe('CopyFeature', () => {
  const copyFeature = new CopyFeature();

  describe('copy', () => {
    it('creates a clone of the feature', () => {
      const original = turf.polygon([
        [
          [0, 0],
          [0, 1],
          [1, 1],
          [1, 0],
          [0, 0],
        ],
      ]);
      original.properties = { name: 'test' };

      const copied = copyFeature.copy(original, [0, 0]);

      expect(copied).not.toBe(original);
      expect(copied.geometry.type).toBe(original.geometry.type);
    });

    it('generates new ID for copied feature', () => {
      const original = turf.polygon([
        [
          [0, 0],
          [0, 1],
          [1, 1],
          [1, 0],
          [0, 0],
        ],
      ]);
      original.id = 'original-id';

      const copied = copyFeature.copy(original);

      expect(copied.id).not.toBe('original-id');
      expect(typeof copied.id).toBe('string');
    });

    it('applies offset when provided', () => {
      const original = turf.polygon([
        [
          [0, 0],
          [0, 1],
          [1, 1],
          [1, 0],
          [0, 0],
        ],
      ]);

      const copied = copyFeature.copy(original, [0.01, 0.01]);
      const originalCenter = turf.centroid(original);
      const copiedCenter = turf.centroid(copied);

      // Copied feature should be offset
      expect(copiedCenter.geometry.coordinates[0]).not.toBe(
        originalCenter.geometry.coordinates[0]
      );
      expect(copiedCenter.geometry.coordinates[1]).not.toBe(
        originalCenter.geometry.coordinates[1]
      );
    });
  });

  describe('copyMultiple', () => {
    it('copies all features in array', () => {
      const features = [
        turf.polygon([
          [
            [0, 0],
            [0, 1],
            [1, 1],
            [1, 0],
            [0, 0],
          ],
        ]),
        turf.polygon([
          [
            [2, 2],
            [2, 3],
            [3, 3],
            [3, 2],
            [2, 2],
          ],
        ]),
      ];

      const copied = copyFeature.copyMultiple(features);

      expect(copied.length).toBe(2);
      expect(copied[0].id).not.toBe(features[0].id);
      expect(copied[1].id).not.toBe(features[1].id);
    });
  });

  describe('copyToLocation', () => {
    it('centers features at the target location', () => {
      const features = [
        turf.polygon([
          [
            [0, 0],
            [0, 1],
            [1, 1],
            [1, 0],
            [0, 0],
          ],
        ]),
      ];

      const targetCenter: [number, number] = [10, 10];
      const copied = copyFeature.copyToLocation(features, targetCenter);

      const copiedCenter = turf.centroid(turf.featureCollection(copied));

      // Should be close to target center
      expect(
        Math.abs(copiedCenter.geometry.coordinates[0] - targetCenter[0])
      ).toBeLessThan(0.1);
      expect(
        Math.abs(copiedCenter.geometry.coordinates[1] - targetCenter[1])
      ).toBeLessThan(0.1);
    });

    it('returns empty array for empty input', () => {
      const copied = copyFeature.copyToLocation([], [0, 0]);
      expect(copied).toEqual([]);
    });
  });

  describe('setOffset / getOffset', () => {
    it('updates the default offset', () => {
      const copy = new CopyFeature();
      const newOffset: [number, number] = [0.01, 0.02];

      copy.setOffset(newOffset);

      expect(copy.getOffset()).toEqual(newOffset);
    });
  });
});
