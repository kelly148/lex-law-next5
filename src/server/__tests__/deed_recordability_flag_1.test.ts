/**
 * deed_recordability_flag_1.test.ts — DEED-RECORDABILITY-FLAG-1 (Part A).
 *
 * One runtime switch (DEED_RECORDABILITY_ENABLED, default OFF) gates the whole deed recordability machinery —
 * the client surface (covered by documentDetail.deedRecordabilityFlag.render.test.tsx) AND the export-time D3
 * source-extracted-facts sign-off block (covered here). This proves:
 *   1. isDeedRecordabilityEnabled() is default-OFF and strict ("true" only);
 *   2. the export route computes d3Mode gated on the flag, so OFF => 'off' => BOTH the D3 observe telemetry and
 *      the D3 enforce -> D3_SIGNOFF_REQUIRED 409 skip entirely (Stage-1 export never blocks on recordability);
 *   3. the LIVE-9 DEED_EXPORT_BLOCKED guard is NOT gated on this flag (it stays on regardless);
 *   4. the ungated deedRecordability.isEnabled probe is registered so the client can read the flag.
 *
 * Convention: env-toggle unit test for the pure accessor + source-audit for the export REST route wiring (the
 * route has no HTTP harness; uat_m1_deed_gate_mount_1 / d3_observe_inc3 style).
 */
import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { isDeedRecordabilityEnabled, resolveDeedExportD3Mode } from '../config/featureFlags.js';

const ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf-8');

describe('DEED-RECORDABILITY-FLAG-1: isDeedRecordabilityEnabled accessor', () => {
  const original = process.env['DEED_RECORDABILITY_ENABLED'];
  afterEach(() => {
    if (original === undefined) delete process.env['DEED_RECORDABILITY_ENABLED'];
    else process.env['DEED_RECORDABILITY_ENABLED'] = original;
  });

  it('defaults OFF when the env var is absent', () => {
    delete process.env['DEED_RECORDABILITY_ENABLED'];
    expect(isDeedRecordabilityEnabled()).toBe(false);
  });

  it('is ON only for exactly "true"', () => {
    process.env['DEED_RECORDABILITY_ENABLED'] = 'true';
    expect(isDeedRecordabilityEnabled()).toBe(true);
  });

  it('any other value is OFF (strict, no coercion)', () => {
    for (const v of ['TRUE', '1', 'yes', 'on', 'observe', '']) {
      process.env['DEED_RECORDABILITY_ENABLED'] = v;
      expect(isDeedRecordabilityEnabled()).toBe(false);
    }
  });
});

describe('DEED-RECORDABILITY-FLAG-1: resolveDeedExportD3Mode (the export gate decision, EXECUTED)', () => {
  it('OFF suppresses the D3 sign-off entirely — every configured mode collapses to off (no observe, no 409)', () => {
    expect(resolveDeedExportD3Mode(false, 'off')).toBe('off');
    expect(resolveDeedExportD3Mode(false, 'observe')).toBe('off');
    // the load-bearing case: a Stage-1 (flag-OFF) deed export never enters the enforce -> D3_SIGNOFF_REQUIRED 409.
    expect(resolveDeedExportD3Mode(false, 'enforce')).toBe('off');
  });

  it('ON passes the configured mode through unchanged (current behavior exactly)', () => {
    expect(resolveDeedExportD3Mode(true, 'off')).toBe('off');
    expect(resolveDeedExportD3Mode(true, 'observe')).toBe('observe');
    expect(resolveDeedExportD3Mode(true, 'enforce')).toBe('enforce');
  });
});

describe('DEED-RECORDABILITY-FLAG-1: export route gates the D3 sign-off block on the flag', () => {
  const indexSrc = read('src/server/index.ts');

  it('imports isDeedRecordabilityEnabled from featureFlags', () => {
    expect(indexSrc).toContain('isDeedRecordabilityEnabled');
    expect(indexSrc).toMatch(/import \{[^}]*isDeedRecordabilityEnabled[^}]*\} from '\.\/config\/featureFlags\.js'/);
  });

  it('resolves d3Mode through resolveDeedExportD3Mode(isDeedRecordabilityEnabled(), getD3SignoffMode())', () => {
    // OFF => resolveDeedExportD3Mode returns 'off' => `d3Mode !== 'off'` (observe) and `d3Mode === 'enforce'`
    // (enforce) are both false. The decision itself is executed in the resolveDeedExportD3Mode block above.
    expect(indexSrc).toContain('const d3Mode = resolveDeedExportD3Mode(isDeedRecordabilityEnabled(), getD3SignoffMode());');
  });

  it('keeps the D3 observe + enforce blocks keyed off d3Mode (unchanged conditions)', () => {
    expect(indexSrc).toContain("if (d3Mode !== 'off' && doc.documentType === 'deed')");
    expect(indexSrc).toContain("if (d3Mode === 'enforce' && doc.documentType === 'deed')");
    expect(indexSrc).toContain("error: 'D3_SIGNOFF_REQUIRED'");
  });

  it('does NOT gate the LIVE-9 DEED_EXPORT_BLOCKED guard on the recordability flag (it stays on regardless)', () => {
    // The LIVE-9 guard is keyed only on sanctioned-deed provenance, never on recordability.
    expect(indexSrc).toContain('if (!isSanctionedAgentDeed(doc.documentType, doc.provenance)) {');
    expect(indexSrc).toContain("error: 'DEED_EXPORT_BLOCKED'");
    // Assert against the ACTUAL source region (not a self-referential literal): the LIVE-9 block — from just
    // before its guard through the DEED_EXPORT_BLOCKED return — must never reference the recordability flag, so a
    // future edit that wraps it in `if (isDeedRecordabilityEnabled())` turns this RED. (The legit flag use is the
    // d3Mode resolution well below this region, outside the slice.)
    const guardIdx = indexSrc.indexOf('if (!isSanctionedAgentDeed(doc.documentType, doc.provenance)) {');
    const blockedIdx = indexSrc.indexOf("error: 'DEED_EXPORT_BLOCKED'");
    expect(guardIdx).toBeGreaterThan(-1);
    expect(blockedIdx).toBeGreaterThan(guardIdx);
    const live9Region = indexSrc.slice(Math.max(0, guardIdx - 200), blockedIdx + 40);
    expect(live9Region).not.toContain('isDeedRecordabilityEnabled');
  });
});

describe('DEED-RECORDABILITY-FLAG-1: the client-facing probe is registered', () => {
  it('the deedRecordability router exposes an ungated isEnabled probe', () => {
    const routerFile = read('src/server/procedures/deedRecordability.ts');
    expect(routerFile).toContain('isEnabled: protectedProcedure.query(() => ({ enabled: isDeedRecordabilityEnabled() }))');
  });

  it('the root router mounts deedRecordability', () => {
    const root = read('src/server/router.ts');
    expect(root).toContain("import { deedRecordabilityRouter } from './procedures/deedRecordability.js';");
    expect(root).toContain('deedRecordability: deedRecordabilityRouter,');
  });
});
