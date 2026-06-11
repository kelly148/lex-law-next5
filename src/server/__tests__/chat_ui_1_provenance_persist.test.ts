/**
 * CHAT-UI-1 W2b — durable provenance persistence path (DB-free via an in-memory writer).
 *
 * CI has no test database, so the persistence boundary is exercised at the query seam: a fake
 * in-memory ProvenanceWriter stands in for the table. Proves: an appended entry SURVIVES THE BOUNDARY
 * (the written row parses back through the Zod Wall), consecutive appends extend the hash chain
 * (seq + prevHash linkage), an adverse-recipient record and a privileged x adverse HARD record are
 * correct + distinguishable, and the chain verifier detects tampering. The live DB round-trip is
 * verified at deploy-time (post-migration), like every DB feature here.
 */
import { describe, it, expect } from 'vitest';

import { type Posture, evaluateCoherence } from '../../shared/posture/postureCoherence.js';
import { buildProvenanceEntry } from '../../shared/posture/provenance.js';
import { PostureProvenanceRowSchema } from '../../shared/schemas/postureProvenance.js';
import { verifyChain } from '../db/provenanceHash.js';
import {
  insertPostureProvenanceEntry,
  rowToContent,
  type ProvenanceWriter,
} from '../db/queries/postureProvenance.js';
import type { NewPostureProvenance } from '../db/schema.js';

const USER = '22222222-2222-2222-2222-222222222222';
const MATTER = '11111111-1111-1111-1111-111111111111';

const COUNSEL_INTERNAL: Posture = { issuer: { entity: 'the firm', capacity: 'counsel' }, privilege: true, recipient: 'internal_client' };
const ADVERSE_NONPRIV: Posture = { issuer: { entity: 'the company', capacity: 'principal' }, privilege: false, recipient: 'adverse' };
const PRIV_ADVERSE: Posture = { issuer: { entity: 'the firm', capacity: 'counsel' }, privilege: true, recipient: 'adverse' };

const entryFor = (next: Posture, over: Partial<Parameters<typeof buildProvenanceEntry>[0]> = {}) =>
  buildProvenanceEntry({
    act: 'recipient',
    actor: 'kelly',
    sliderPosition: 'Auto-Act',
    triggerSource: 'test',
    at: '2026-06-11T00:00:00.000Z',
    nextTriple: next,
    acknowledged: evaluateCoherence(next, { atEgress: false }),
    ...over,
  });

function makeFakeWriter(): { rows: NewPostureProvenance[]; writer: ProvenanceWriter } {
  const rows: NewPostureProvenance[] = [];
  const writer: ProvenanceWriter = {
    readLast: async (matterId, userId) => {
      const mine = rows.filter((r) => r.matterId === matterId && r.userId === userId);
      if (mine.length === 0) return null;
      const last = mine.reduce((a, b) => (b.seq > a.seq ? b : a));
      return { seq: last.seq, entryHash: last.entryHash };
    },
    insert: async (row) => {
      rows.push(row);
    },
  };
  return { rows, writer };
}

/** Simulate a read-back: the DB adds createdAt; parse through the Zod Wall. */
const readBack = (row: NewPostureProvenance) => PostureProvenanceRowSchema.parse({ ...row, createdAt: new Date() });

describe('append path — survives the boundary + extends the chain', () => {
  it('two appends chain (seq 0,1; prevHash links) and each row parses back through the Zod Wall', async () => {
    const { rows, writer } = makeFakeWriter();
    const ctx = { userId: USER, matterId: MATTER };
    await insertPostureProvenanceEntry(entryFor(COUNSEL_INTERNAL), ctx, writer);
    await insertPostureProvenanceEntry(entryFor(ADVERSE_NONPRIV, { eventClass: 'dirty_confirmed' }), ctx, writer);

    expect(rows.length).toBe(2);
    expect(rows[0]!.seq).toBe(0);
    expect(rows[1]!.seq).toBe(1);
    expect(rows[1]!.prevHash).toBe(rows[0]!.entryHash); // chained

    const parsed0 = readBack(rows[0]!);
    const parsed1 = readBack(rows[1]!);
    expect(parsed0.eventClass).toBe('meaningful_accept');
    expect(parsed1.eventClass).toBe('dirty_confirmed'); // the two §3 classes, distinguishable
    expect(parsed1.recipient).toBe('adverse');

    // The verifier accepts the intact, parsed chain.
    const links = [parsed0, parsed1].map((row) => ({ content: rowToContent(row), prevHash: row.prevHash, entryHash: row.entryHash }));
    expect(verifyChain(links).valid).toBe(true);
  });
});

describe('adverse-recipient vs privileged x adverse write distinguishable rows', () => {
  it('the HARD block carries a hard verdict citing priv-to-adverse; the coherent adverse does not', async () => {
    const { rows, writer } = makeFakeWriter();
    const ctx = { userId: USER, matterId: MATTER };
    await insertPostureProvenanceEntry(entryFor(ADVERSE_NONPRIV), ctx, writer);
    await insertPostureProvenanceEntry(entryFor(PRIV_ADVERSE), ctx, writer);

    const adverse = readBack(rows[0]!);
    const hardBlock = readBack(rows[1]!);

    expect(adverse.recipient).toBe('adverse');
    expect(adverse.privilege).toBe('not_privileged');
    expect(adverse.verdictSeverity).toBe('none');

    expect(hardBlock.recipient).toBe('adverse');
    expect(hardBlock.privilege).toBe('privileged');
    expect(hardBlock.verdictSeverity).toBe('hard');
    expect(hardBlock.findings.map((f) => f.id)).toContain('priv-to-adverse');

    expect(adverse.verdictSeverity).not.toBe(hardBlock.verdictSeverity);
  });
});

describe('tampering with a persisted row is detected', () => {
  it('altering a stored row content (keeping its hash) breaks chain verification', async () => {
    const { rows, writer } = makeFakeWriter();
    const ctx = { userId: USER, matterId: MATTER };
    await insertPostureProvenanceEntry(entryFor(COUNSEL_INTERNAL), ctx, writer);
    await insertPostureProvenanceEntry(entryFor(ADVERSE_NONPRIV), ctx, writer);

    const parsed = rows.map(readBack);
    const links = parsed.map((row) => ({ content: rowToContent(row), prevHash: row.prevHash, entryHash: row.entryHash }));
    expect(verifyChain(links).valid).toBe(true);

    // Tamper: change the actor on row 1's content, keep its stored entryHash.
    links[1]!.content = { ...links[1]!.content, actor: 'mallory' };
    const v = verifyChain(links);
    expect(v.valid).toBe(false);
    expect(v.brokenAtSeq).toBe(1);
  });
});
