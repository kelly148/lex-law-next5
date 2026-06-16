/**
 * CONFIG-VALIDATION-HARDENING-1 — guard numeric env vars against silently becoming NaN.
 *
 * Audit (outputs/MONSTER_UAT_FINDINGS_2026-06-15.md, LOW + sweep): PORT and DISPATCHER_POLL_INTERVAL_MS
 * were parsed with a bare parseInt(... ?? 'default', 10), so a malformed value became NaN — Node binds a
 * random port for a NaN port, and setTimeout(NaN) spins the poll loop. parseEnvInt falls back to the
 * documented default on an absent/blank/non-numeric/non-positive value.
 */
import { describe, it, expect } from 'vitest';
import { parseEnvInt } from '../config/parseEnvInt.js';

describe('CONFIG-VALIDATION-HARDENING-1 — parseEnvInt', () => {
  it('returns the parsed integer for a valid value', () => {
    expect(parseEnvInt('3001', 3001)).toBe(3001);
    expect(parseEnvInt('8080', 3001)).toBe(8080);
    expect(parseEnvInt('500', 2000)).toBe(500);
  });

  it('falls back when the value is absent or blank', () => {
    expect(parseEnvInt(undefined, 3001)).toBe(3001);
    expect(parseEnvInt('', 2000)).toBe(2000);
    expect(parseEnvInt('   ', 2000)).toBe(2000);
  });

  it('falls back on a non-numeric value instead of returning NaN', () => {
    expect(parseEnvInt('abc', 3001)).toBe(3001);
    expect(parseEnvInt('not-a-number', 2000)).toBe(2000);
    expect(Number.isNaN(parseEnvInt('not-a-number', 2000))).toBe(false);
  });

  it('STRICT: rejects a value with trailing garbage to the fallback (not a lenient parseInt truncation)', () => {
    expect(parseEnvInt('2s', 2000)).toBe(2000); // would be 2 under bare parseInt — a 2ms spin loop
    expect(parseEnvInt('2000ms', 2000)).toBe(2000);
    expect(parseEnvInt('3001abc', 3001)).toBe(3001);
  });

  it('falls back on a value below the minimum (default min = 1; rejects 0 and negatives)', () => {
    expect(parseEnvInt('0', 2000)).toBe(2000);
    expect(parseEnvInt('-5', 3001)).toBe(3001);
  });

  it('honors a custom minimum', () => {
    expect(parseEnvInt('50', 100, { min: 100 })).toBe(100); // 50 < min -> fallback
    expect(parseEnvInt('150', 100, { min: 100 })).toBe(150);
    expect(parseEnvInt('0', 100, { min: 0 })).toBe(0); // min 0 allows 0
  });

});
