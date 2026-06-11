/**
 * CHAT-UI-1 W3a — matter-identity ingestion confirm + the provenance `subject` extension.
 *
 * The trigger truth table (set / change / ambiguous -> confirm; same unambiguous identity -> no
 * over-prompt), and proof that the W3 `subject` (the non-posture act's target) survives the durable
 * boundary through the Zod Wall and is hash-protected by the per-matter chain.
 */
import { describe, it, expect } from 'vitest';

import {
  matterIdentityRequiresConfirm,
  type MatterResolution,
} from '../../shared/posture/matterIdentity.js';
import { buildProvenanceEntry, type ProvenanceSubject } from '../../shared/posture/provenance.js';
import { entryToContent, canonicalContent } from '../../shared/posture/provenanceRow.js';
import { buildProvenanceRow } from '../db/queries/postureProvenance.js';
import { PostureProvenanceRowSchema } from '../../shared/schemas/postureProvenance.js';

const USER = '22222222-2222-2222-2222-222222222222';
const MATTER = '11111111-1111-1111-1111-111111111111';

describe('matterIdentityRequiresConfirm — trigger truth table', () => {
  const res = (over: Partial<MatterResolution> = {}): MatterResolution => ({
    matterId: 'A',
    candidates: ['A'],
    ambiguous: false,
    ...over,
  });

  it('set (no prior identity) -> confirm', () => {
    expect(matterIdentityRequiresConfirm(null, res())).toBe(true);
  });
  it('same unambiguous identity -> NO confirm (no over-prompt on re-ingestion)', () => {
    expect(matterIdentityRequiresConfirm({ matterId: 'A' }, res({ matterId: 'A' }))).toBe(false);
  });
  it('changed identity -> confirm', () => {
    expect(matterIdentityRequiresConfirm({ matterId: 'A' }, res({ matterId: 'B', candidates: ['B'] }))).toBe(true);
  });
  it('ambiguous -> confirm even when a prior exists', () => {
    expect(matterIdentityRequiresConfirm({ matterId: 'A' }, res({ ambiguous: true, candidates: ['A', 'C'] }))).toBe(true);
  });
  it('unresolved (matterId null) -> confirm', () => {
    expect(matterIdentityRequiresConfirm(null, res({ matterId: null, candidates: [], ambiguous: true }))).toBe(true);
  });
});

describe('provenance `subject` (W3) survives the boundary + is hash-protected', () => {
  const subject: ProvenanceSubject = { type: 'matter', id: 'B', label: 'Brown EP', detail: 'rebind from A' };
  const entry = buildProvenanceEntry({
    act: 'matter_identity',
    actor: 'kelly',
    sliderPosition: 'Propose-and-Confirm',
    triggerSource: 'ingestion',
    at: '2026-06-11T00:00:00.000Z',
    subject,
  });

  it('subject persists entry -> row -> Zod Wall; the act carries no triple', () => {
    const row = buildProvenanceRow(entry, { userId: USER, matterId: MATTER }, null);
    const parsed = PostureProvenanceRowSchema.parse({ ...row, createdAt: new Date() });
    expect(parsed.act).toBe('matter_identity');
    expect(parsed.subject).toEqual(subject);
    expect(parsed.recipient).toBeNull(); // non-posture act
    expect(parsed.priorTriple).toBeNull();
  });

  it('changing the subject changes the hashed canonical content (tamper-evident)', () => {
    const c1 = entryToContent(entry, { matterId: MATTER, seq: 0 });
    const c2 = entryToContent(
      buildProvenanceEntry({
        act: 'matter_identity',
        actor: 'kelly',
        sliderPosition: 'Propose-and-Confirm',
        triggerSource: 'ingestion',
        at: '2026-06-11T00:00:00.000Z',
        subject: { ...subject, id: 'C' },
      }),
      { matterId: MATTER, seq: 0 },
    );
    expect(canonicalContent(c1, 'PREV')).not.toBe(canonicalContent(c2, 'PREV'));
  });
});
