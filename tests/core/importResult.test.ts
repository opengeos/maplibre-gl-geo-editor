import { describe, it, expect } from 'vitest';
import { resolveImportedCount } from '../../src/lib/core/importResult';

describe('resolveImportedCount', () => {
  it('reads the count from stats.success (current geoman)', () => {
    expect(
      resolveImportedCount({ stats: { total: 3, success: 3, failed: 0 } }, 0)
    ).toBe(3);
  });

  it('falls back to a flat success field (older geoman)', () => {
    expect(resolveImportedCount({ success: 2, failed: 1 }, 0)).toBe(2);
  });

  it('prefers stats.success over a flat success field', () => {
    expect(resolveImportedCount({ stats: { success: 5 }, success: 99 }, 0)).toBe(5);
  });

  it('uses the fallback when no counter is present', () => {
    expect(resolveImportedCount({}, 7)).toBe(7);
    expect(resolveImportedCount(undefined, 4)).toBe(4);
  });

  it('preserves an explicit zero success count', () => {
    expect(resolveImportedCount({ stats: { success: 0, failed: 2 } }, 9)).toBe(0);
  });
});
