/**
 * CHAT-UI-1 W2a — durable provenance row mapping + tamper-evident hash chain (pure logic).
 *
 * Proves: the eventClass contract extension; that a W1 entry SURVIVES THE PERSISTENCE BOUNDARY
 * (lossless entry -> row content -> resolved triple); that an adverse-recipient record and a
 * privileged x adverse HARD record are correct and DISTINGUISHABLE; and that the per-matter hash
 * chain detects tampering (altered content, reordering).
 */
import { describe, it, expect } from 'vitest';

import { type Posture, evaluateCoherence } from '../../shared/posture/postureCoherence.js';
import { buildProvenanceEntry } from '../../shared/posture/provenance.js';
import {
  entryToContent,
  contentToResolvedTriple,
  canonicalContent,
  stableStringify,
} from '../../shared/posture/provenanceRow.js';
import { computeEntryHash, verifyChain, GENESIS_PREV_HASH } from '../db/provenanceHash.js';

const MATTER = '11111111-1111-1111-1111-111111111111';

const COUNSEL_INTERNAL: Posture = {
  issuer: { entity: 'the firm', capacity: 'counsel' },
  privilege: true,
  recipient: 'internal_client',
};
const ADVERSE_NONPRIV: Posture = {
  issuer: { entity: 'the company', capacity: 'principal' },
  privilege: false,
  recipient: 'adverse',
};
const PRIV_ADVERSE: Posture = {
  issuer: { entity: 'the firm', capacity: 'counsel' },
  privilege: true,
  recipient: 'adverse',
};

const entryFor = (next: Posture | null, over: Partial<Parameters<typeof buildProvenanceEntry>[0]> = {}) =>
  buildProvenanceEntry({
    act: next ? 'recipient' : 'lock',
    actor: 'kelly',
    sliderPosition: 'Auto-Act',
    triggerSource: 'test',
    at: '2026-06-11T00:00:00.000Z',
    nextTriple: next,
    acknowledged: next ? evaluateCoherence(next, { atEgress: false }) : [],
    ...over,
  });

describe('eventClass contract extension (W1 honored, not redefined)', () => {
  it('defaults to meaningful_accept; honors an explicit dirty_confirmed', () => {
    expect(entryFor(COUNSEL_INTERNAL).eventClass).toBe('meaningful_accept');
    expect(entryFor(COUNSEL_INTERNAL, { eventClass: 'dirty_confirmed' }).eventClass).toBe('dirty_confirmed');
  });
});

describe('an entry survives the persistence boundary (lossless)', () => {
  it('a posture entry round-trips entry -> content -> resolved triple', () => {
    const content = entryToContent(entryFor(ADVERSE_NONPRIV), { matterId: MATTER, seq: 0 });
    expect(content.recipient).toBe('adverse');
    expect(content.issuerCapacity).toBe('principal');
    expect(content.privilege).toBe('not_privileged');
    expect(contentToResolvedTriple(content)).toEqual(ADVERSE_NONPRIV);
  });

  it('a non-posture act (lock) carries a null triple both ways', () => {
    const content = entryToContent(entryFor(null), { matterId: MATTER, seq: 0 });
    expect(content.recipient).toBeNull();
    expect(content.issuerEntity).toBeNull();
    expect(content.privilege).toBeNull();
    expect(contentToResolvedTriple(content)).toBeNull();
  });
});

describe('adverse-recipient vs privileged x adverse produce distinguishable records', () => {
  it('writes correct, distinguishable verdict + privilege columns', () => {
    const adverse = entryToContent(entryFor(ADVERSE_NONPRIV), { matterId: MATTER, seq: 0 });
    const hardBlock = entryToContent(entryFor(PRIV_ADVERSE), { matterId: MATTER, seq: 1 });

    // The adverse-recipient interrupt: coherent (non-privileged), so no HARD verdict.
    expect(adverse.recipient).toBe('adverse');
    expect(adverse.privilege).toBe('not_privileged');
    expect(adverse.verdictSeverity).toBe('none');
    expect(adverse.findings).toEqual([]);

    // The privileged x adverse HARD block: same recipient, but a HARD verdict citing the row.
    expect(hardBlock.recipient).toBe('adverse');
    expect(hardBlock.privilege).toBe('privileged');
    expect(hardBlock.verdictSeverity).toBe('hard');
    expect(hardBlock.findings.map((f) => f.id)).toContain('priv-to-adverse');

    // Distinguishable.
    expect(adverse.verdictSeverity).not.toBe(hardBlock.verdictSeverity);
  });
});

describe('canonical serialization is deterministic + key-order independent', () => {
  it('stableStringify ignores property order', () => {
    expect(stableStringify({ a: 1, b: [2, { c: 3, d: 4 }] })).toBe(stableStringify({ b: [2, { d: 4, c: 3 }], a: 1 }));
  });

  it('canonicalContent is stable for equal content', () => {
    const c = entryToContent(entryFor(ADVERSE_NONPRIV), { matterId: MATTER, seq: 0 });
    expect(canonicalContent(c, 'PREV')).toBe(canonicalContent(c, 'PREV'));
  });
});

describe('per-matter hash chain is tamper-evident', () => {
  const c0 = entryToContent(entryFor(COUNSEL_INTERNAL), { matterId: MATTER, seq: 0 });
  const c1 = entryToContent(entryFor(ADVERSE_NONPRIV, { eventClass: 'dirty_confirmed' }), { matterId: MATTER, seq: 1 });
  const c2 = entryToContent(entryFor(PRIV_ADVERSE), { matterId: MATTER, seq: 2 });
  const h0 = computeEntryHash(GENESIS_PREV_HASH, c0);
  const h1 = computeEntryHash(h0, c1);
  const h2 = computeEntryHash(h1, c2);
  const l0 = { content: c0, prevHash: GENESIS_PREV_HASH, entryHash: h0 };
  const l1 = { content: c1, prevHash: h0, entryHash: h1 };
  const l2 = { content: c2, prevHash: h1, entryHash: h2 };

  it('an intact chain verifies', () => {
    expect(verifyChain([l0, l1, l2])).toEqual({ valid: true, brokenAtSeq: null, reason: null });
  });

  it('altering a row content (keeping its old hash) is detected', () => {
    const tampered = [l0, { ...l1, content: { ...c1, actor: 'mallory' } }, l2];
    const v = verifyChain(tampered);
    expect(v.valid).toBe(false);
    expect(v.brokenAtSeq).toBe(1);
  });

  it('reordering rows is detected', () => {
    const v = verifyChain([l0, l2, l1]);
    expect(v.valid).toBe(false);
  });

  it('computeEntryHash is deterministic', () => {
    expect(computeEntryHash(h0, c1)).toBe(h1);
  });
});
