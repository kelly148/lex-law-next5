/**
 * CHAT-UI-1 W2c — provenance query/export API (pure serializer + flag-gating source guard).
 *
 * The procedure logic hits the DB (no test DB here), so it is guarded structurally: every provenance
 * procedure is gated behind assertEnabled(), the server stamps the authenticated actor (Ch 35.2), and
 * the router is registered. The portable export serializer is pure and tested directly.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

import { serializeProvenanceExport, PROVENANCE_EXPORT_FORMAT } from '../../shared/posture/provenanceExport.js';

describe('serializeProvenanceExport — portable export', () => {
  it('wraps the bundle in a versioned, self-describing envelope', () => {
    const json = serializeProvenanceExport({
      matterId: 'm-1',
      count: 2,
      chain: { valid: true, brokenAtSeq: null, reason: null },
      entries: [{ id: 'a' }, { id: 'b' }],
    });
    const parsed = JSON.parse(json);
    expect(parsed.format).toBe(PROVENANCE_EXPORT_FORMAT);
    expect(parsed.matterId).toBe('m-1');
    expect(parsed.count).toBe(2);
    expect(parsed.chainVerified).toBe(true);
    expect(parsed.entries).toHaveLength(2);
  });

  it('surfaces a broken chain in the export', () => {
    const json = serializeProvenanceExport({
      matterId: 'm-1',
      count: 1,
      chain: { valid: false, brokenAtSeq: 1, reason: 'entryHash mismatch (row content was altered)' },
      entries: [{ id: 'a' }],
    });
    const parsed = JSON.parse(json);
    expect(parsed.chainVerified).toBe(false);
    expect(parsed.chain.brokenAtSeq).toBe(1);
  });
});

describe('chatUi provenance API — flag-gating source guard', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '../procedures/chatUi.ts'), 'utf8');
  const root = fs.readFileSync(path.resolve(__dirname, '../router.ts'), 'utf8');

  it('exposes record / list / export provenance procedures', () => {
    expect(src).toContain('recordProvenance');
    expect(src).toContain('listProvenance');
    expect(src).toContain('exportProvenance');
  });

  it('gates every provenance procedure behind assertEnabled()', () => {
    // One assertEnabled definition + a call in each of the 3 provenance procedures.
    expect(src).toContain('function assertEnabled');
    expect((src.match(/assertEnabled\(\)/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });

  it('stamps the authenticated actor (Ch 35.2), not a client-supplied one', () => {
    expect(src).toContain('actor: ctx.userId');
  });

  it('the root router registers chatUi', () => {
    expect(root).toContain('chatUi: chatUiRouter');
  });
});
