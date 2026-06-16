/**
 * parseEnvInt — CONFIG-VALIDATION-HARDENING-1
 *
 * Parse a base-10 integer environment variable with a NaN/range guard and a safe fallback. Before this,
 * numeric env vars were parsed with a bare `parseInt(process.env[x] ?? 'default', 10)`, so a malformed
 * value (e.g. PORT='abc', DISPATCHER_POLL_INTERVAL_MS='2s') silently became NaN — which Node's
 * app.listen treats as a random port, and setTimeout treats as 0 (a CPU-spinning poll loop). This
 * guard keeps a typo'd value from silently degrading runtime behavior: an invalid value falls back to
 * the documented default rather than NaN.
 *
 * @param raw       the raw env value (process.env[name]); may be undefined.
 * @param fallback  the default to use when raw is absent OR fails validation.
 * @param opts.min  inclusive lower bound (default 1 — these are positive quantities: ports, intervals).
 * @returns a finite integer >= min.
 */
export function parseEnvInt(
  raw: string | undefined,
  fallback: number,
  opts?: { min?: number },
): number {
  const min = opts?.min ?? 1;
  if (raw === undefined) return fallback;
  const trimmed = raw.trim();
  // STRICT: require a clean integer. Unlike bare parseInt, a value with trailing garbage ('2s',
  // '2000ms', '3001abc') is REJECTED to the fallback rather than leniently truncated — a typo'd
  // interval should not silently become a tiny spin loop.
  if (!/^-?\d+$/.test(trimmed)) return fallback;
  const parsed = parseInt(trimmed, 10);
  if (!Number.isFinite(parsed) || parsed < min) return fallback;
  return parsed;
}
