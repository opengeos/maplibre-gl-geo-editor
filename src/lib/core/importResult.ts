/**
 * Result returned by geoman's `features.importGeoJson`. Its shape differs across
 * geoman versions: current builds nest the per-import counters under `stats`,
 * while older builds exposed flat `success`/`failed` fields. Both are typed here
 * so callers can read the count robustly regardless of the installed version.
 */
export interface GeomanImportResult {
  stats?: {
    total?: number;
    success?: number;
    failed?: number;
    overwritten?: number;
  };
  /** Legacy flat fields (older geoman releases). */
  success?: number;
  failed?: number;
  addedFeatures?: unknown[];
}

/**
 * Resolve the number of successfully imported features from a geoman
 * `importGeoJson` result, reading `stats.success` first (current geoman) and
 * falling back to a flat `success` (older geoman), then to `fallback` when the
 * result exposes neither.
 *
 * @param result - The value returned by `geoman.features.importGeoJson`.
 * @param fallback - Count to use when the result carries no usable counter.
 * @returns The number of features geoman reported as successfully imported.
 */
export function resolveImportedCount(
  result: GeomanImportResult | undefined,
  fallback: number
): number {
  return result?.stats?.success ?? result?.success ?? fallback;
}
