/**
 * LANDING-2 — serve the landing page at the bare domain for anonymous visitors,
 * the app for logged-in users. Flag LANDING_AT_ROOT_ENABLED, default OFF.
 *
 * The GET / handler in index.ts has heavy import-time side effects (server boot,
 * SESSION_SECRET, DB), so we test the pure decision (resolveRootServe) + the flag
 * accessor + a source guard that index.ts wires it correctly (flag-gated, before
 * express.static, reusing the existing session path).
 */
import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

import { resolveRootServe } from '../landingRoot.js';
import { isLandingAtRootEnabled } from '../config/featureFlags.js';

describe('LANDING-2 resolveRootServe — pure decision', () => {
  it('flag OFF -> passthrough (byte-identical to today), regardless of auth', () => {
    expect(resolveRootServe(false, null)).toBe('passthrough');
    expect(resolveRootServe(false, 'user-123')).toBe('passthrough');
  });

  it('flag ON + anonymous -> landing', () => {
    expect(resolveRootServe(true, null)).toBe('landing');
    expect(resolveRootServe(true, undefined)).toBe('landing');
  });

  it('flag ON + authenticated -> spa', () => {
    expect(resolveRootServe(true, 'user-123')).toBe('spa');
  });
});

describe('LANDING-2 flag default', () => {
  beforeEach(() => {
    delete process.env['LANDING_AT_ROOT_ENABLED'];
  });

  it('defaults OFF when the env var is unset', () => {
    expect(isLandingAtRootEnabled()).toBe(false);
  });

  it('is true only for the exact string "true"', () => {
    process.env['LANDING_AT_ROOT_ENABLED'] = 'true';
    expect(isLandingAtRootEnabled()).toBe(true);
    process.env['LANDING_AT_ROOT_ENABLED'] = 'TRUE';
    expect(isLandingAtRootEnabled()).toBe(false);
    process.env['LANDING_AT_ROOT_ENABLED'] = '1';
    expect(isLandingAtRootEnabled()).toBe(false);
    delete process.env['LANDING_AT_ROOT_ENABLED'];
  });
});

describe('LANDING-2 index.ts wiring — source guard', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '../index.ts'), 'utf8');

  it('registers a flag-gated GET / that reuses the session path and can serve the landing page', () => {
    expect(src).toContain("app.get('/'");
    expect(src).toContain('isLandingAtRootEnabled()');
    expect(src).toContain('resolveRootServe');
    expect(src).toContain('getSession');
    expect(src).toContain('extractUserId');
    expect(src).toContain("'landing.html'");
    expect(src).toContain("'index.html'");
  });

  it('registers GET / BEFORE express.static so it intercepts the bare domain', () => {
    const getRootIdx = src.indexOf("app.get('/'");
    const staticIdx = src.indexOf('express.static(distPath)');
    expect(getRootIdx).toBeGreaterThan(-1);
    expect(staticIdx).toBeGreaterThan(-1);
    expect(getRootIdx).toBeLessThan(staticIdx);
  });
});
