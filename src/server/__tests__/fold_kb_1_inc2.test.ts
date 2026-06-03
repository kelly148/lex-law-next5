/**
 * FOLD-KB-1 Increment 2 — adoption provenance + surfacing.
 *
 *   A. evaluateMemoSurfaceMatch — PURE deterministic conservative matcher (Fork F).
 *   B. adoptMemoIntoMatter — the access gate BLOCKS a raw/matter_only memo into another
 *      matter (Fork A/B); the block happens before any DB write (mock the memo read).
 *   C. KbAdoptionRowSchema parses a provenance row.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TRPCError } from '@trpc/server';
import { evaluateMemoSurfaceMatch } from '../practiceKb/surface.js';
import { KbAdoptionRowSchema, type PracticeMemoRow } from '../../shared/schemas/practiceKb.js';

import * as memoQueries from '../db/queries/practiceMemos.js';
vi.mock('../db/queries/practiceMemos.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../db/queries/practiceMemos.js')>();
  return { ...actual, getPracticeMemoById: vi.fn() };
});
import { adoptMemoIntoMatter } from '../practiceKb/adopt.js';

const MATTER_A = '00000000-0000-0000-0000-0000000000a1';
const MATTER_B = '00000000-0000-0000-0000-0000000000b2';

function rawMatterOnlyMemo(): PracticeMemoRow {
  return {
    id: '00000000-0000-0000-0000-0000000000f0',
    userId: '00000000-0000-0000-0000-0000000000d4',
    originMatterId: MATTER_A,
    sourceAnalysisId: null,
    sourceDocumentId: null,
    title: 'Client-specific 1031 analysis',
    body: '…',
    practiceArea: 'real_estate',
    jurisdiction: 'VA',
    lawReliedOn: null,
    topicTags: ['1031'],
    writtenOn: null,
    verificationStatus: 'unverified',
    lastVerifiedAt: null,
    verifiedThroughDate: null,
    verificationMethod: null,
    verificationNote: null,
    privilegeTag: 'client_confidential',
    abstractionStatus: 'raw',
    abstractionAttestedByEventId: null,
    abstractedAt: null,
    abstractedBy: null,
    reuseScope: 'matter_only',
    abstractedFromMemoId: null,
    supersededById: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

// ============================================================
// A. evaluateMemoSurfaceMatch (Fork F)
// ============================================================
describe('FOLD-KB-1 Inc2 — evaluateMemoSurfaceMatch', () => {
  const memo = { practiceArea: 'Real_Estate', jurisdiction: 'VA', topicTags: ['1031', 'related-party'] };

  it('matches practice area case-insensitively', () => {
    expect(evaluateMemoSurfaceMatch(memo, { practiceArea: 'real_estate' })).toContain('practice_area');
  });
  it('matches jurisdiction', () => {
    expect(evaluateMemoSurfaceMatch(memo, { jurisdiction: 'va' })).toContain('jurisdiction');
  });
  it('matches a topic tag overlap', () => {
    expect(evaluateMemoSurfaceMatch(memo, { tags: ['1031'] })).toContain('topic:1031');
  });
  it('returns no reasons when nothing overlaps (conservative)', () => {
    expect(evaluateMemoSurfaceMatch(memo, { practiceArea: 'estate_planning', jurisdiction: 'MD', tags: ['probate'] })).toEqual([]);
  });
});

// ============================================================
// B. adoptMemoIntoMatter — gate blocks cross-matter raw memo (Fork A/B)
// ============================================================
describe('FOLD-KB-1 Inc2 — adoptMemoIntoMatter access gate', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('BLOCKS a raw/matter_only memo into a different matter (no DB write)', async () => {
    vi.mocked(memoQueries.getPracticeMemoById).mockResolvedValue(rawMatterOnlyMemo());
    await expect(
      adoptMemoIntoMatter({ memoId: rawMatterOnlyMemo().id, targetMatterId: MATTER_B, userId: '00000000-0000-0000-0000-0000000000d4' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('throws NOT_FOUND when the memo is not owned', async () => {
    vi.mocked(memoQueries.getPracticeMemoById).mockResolvedValue(null);
    await expect(
      adoptMemoIntoMatter({ memoId: rawMatterOnlyMemo().id, targetMatterId: MATTER_A, userId: '00000000-0000-0000-0000-0000000000d4' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('the block carries the gate reason', async () => {
    vi.mocked(memoQueries.getPracticeMemoById).mockResolvedValue(rawMatterOnlyMemo());
    try {
      await adoptMemoIntoMatter({ memoId: rawMatterOnlyMemo().id, targetMatterId: MATTER_B, userId: '00000000-0000-0000-0000-0000000000d4' });
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(TRPCError);
      expect((err as TRPCError).message).toContain('blocked_matter_only');
    }
  });
});

// ============================================================
// C. KbAdoptionRowSchema
// ============================================================
describe('FOLD-KB-1 Inc2 — KbAdoptionRowSchema', () => {
  it('parses a provenance row', () => {
    const row = {
      id: '00000000-0000-0000-0000-0000000000c1',
      userId: '00000000-0000-0000-0000-0000000000d4',
      matterId: MATTER_B,
      documentId: null,
      kbMemoId: '00000000-0000-0000-0000-0000000000f0',
      kbMemoUpdatedAtAtAdoption: new Date(),
      verificationStatusAtAdoption: 'unverified',
      lastVerifiedAtAtAdoption: null,
      kbDerived: true,
      currencyVerifiedForOutbound: false,
      adoptedByEventId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    expect(KbAdoptionRowSchema.parse(row).currencyVerifiedForOutbound).toBe(false);
  });
});
