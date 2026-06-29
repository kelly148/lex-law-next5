/**
 * kb_backbone_p2_inc1.test.ts — KNOWLEDGE-BACKBONE-PHASE2 (Increment 1: CAPTURE + SCHEMA).
 *
 * Three layers, matching the established KB test harness (no test DB; pure gates tested directly; procedures
 * exercised via createCaller with the query-wrapper layer mocked; feature flag toggled via process.env):
 *   1. PURE gates — canBecomeAutoApplyEligible (D3 lock), isPromotableToReuse (reuse lock corollary),
 *      meetsAuthoritativePromotionGate (§2 pinned-pinpoint + checkedBy).
 *   2. Zod Wall — PracticeMemoRowSchema round-trips the new scope-metadata fields; riskLevel enum is enforced.
 *   3. Procedures — captureMemo (most-private posture, cross-owner authoritySourceId refused, kb_events spine),
 *      verifyMemo (reviewBy-required; AI/capture never sets verified), authoritySourcePromote (§2 gate),
 *      and the flag-off regression (every procedure fail-closes PRECONDITION_FAILED; nothing else runs).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Request, Response } from 'express';

vi.mock('../db/queries/authoritySources.js', () => ({
  createAuthoritySource: vi.fn(),
  getAuthoritySourceById: vi.fn(),
  listAuthoritySourcesByJurisdiction: vi.fn(),
  listAuthoritySourcesApproachingReview: vi.fn(),
  updateAuthoritySource: vi.fn(),
}));
vi.mock('../db/queries/practiceMemos.js', () => ({
  insertPracticeMemo: vi.fn(),
  getPracticeMemoById: vi.fn(),
  markMemoReverified: vi.fn(),
  setMemoAutoApplyEligible: vi.fn(),
}));
vi.mock('../db/queries/kbEvents.js', () => ({
  insertKbEvent: vi.fn().mockResolvedValue('evt-1'),
}));

import { kbBackboneRouter } from '../procedures/kbBackbone.js';
import { canBecomeAutoApplyEligible, isPromotableToReuse } from '../practiceKb/gate.js';
import { meetsAuthoritativePromotionGate } from '../../shared/schemas/authoritySource.js';
import { PracticeMemoRowSchema } from '../../shared/schemas/practiceKb.js';
import {
  createAuthoritySource,
  getAuthoritySourceById,
  updateAuthoritySource,
  listAuthoritySourcesByJurisdiction,
  listAuthoritySourcesApproachingReview,
} from '../db/queries/authoritySources.js';
import { insertPracticeMemo, getPracticeMemoById, markMemoReverified, setMemoAutoApplyEligible } from '../db/queries/practiceMemos.js';
import { insertKbEvent } from '../db/queries/kbEvents.js';

const U1 = '11111111-1111-1111-1111-111111111111';
const AUTH_ID = '33333333-3333-3333-3333-333333333333';
const MEMO_ID = '44444444-4444-4444-4444-444444444444';
const caller = () => kbBackboneRouter.createCaller({ req: {} as Request, res: {} as Response, userId: U1 });

const fn = <T extends (...a: never[]) => unknown>(m: T) => m as unknown as ReturnType<typeof vi.fn>;

// A minimally-complete practice_memo row (enough for the procedures' field reads).
function memoRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: MEMO_ID,
    userId: U1,
    originMatterId: null,
    sourceAnalysisId: null,
    sourceDocumentId: null,
    title: 'Cap-rate carve-out',
    body: 'body',
    practiceArea: 'real_estate',
    jurisdiction: 'VA',
    lawReliedOn: null,
    topicTags: null,
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
    effectiveDate: null,
    reviewBy: null,
    authoritySnapshotId: null,
    negativeTreatmentFlag: null,
    documentType: null,
    riskLevel: null,
    autoApplyEligible: false,
    conflictsHook: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

function authRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: AUTH_ID,
    userId: U1,
    jurisdiction: 'VA',
    authorityType: 'statute',
    citationText: 'Va. Code § 55.1-300',
    pinpoint: null,
    sourceUrlOrLocation: null,
    sourceSnapshotHash: null,
    effectiveDate: null,
    lastCheckedDate: null,
    reviewByDate: null,
    checkedBy: null,
    notes: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  fn(insertKbEvent).mockResolvedValue('evt-1');
  process.env['KB_BACKBONE_ENABLED'] = 'true';
});
afterEach(() => {
  delete process.env['KB_BACKBONE_ENABLED'];
});

// ── 1. PURE gates ────────────────────────────────────────────────────────────────
describe('KB-BACKBONE-P2 I1 — pure gates', () => {
  it('canBecomeAutoApplyEligible (D3): only an abstracted + firm-wide entry may auto-apply', () => {
    expect(canBecomeAutoApplyEligible({ abstractionStatus: 'raw', reuseScope: 'matter_only' })).toBe(false);
    expect(canBecomeAutoApplyEligible({ abstractionStatus: 'abstracted', reuseScope: 'matter_only' })).toBe(false);
    expect(canBecomeAutoApplyEligible({ abstractionStatus: 'raw', reuseScope: 'firm_wide' })).toBe(false);
    expect(canBecomeAutoApplyEligible({ abstractionStatus: 'abstracted', reuseScope: 'firm_wide' })).toBe(true);
  });

  it('isPromotableToReuse (D3 reuse lock): a raw entry cannot reach firm-wide reuse without abstraction', () => {
    expect(isPromotableToReuse({ abstractionStatus: 'raw' })).toBe(false);
    expect(isPromotableToReuse({ abstractionStatus: 'abstracted' })).toBe(true);
  });

  it('meetsAuthoritativePromotionGate (§2): authoritative requires BOTH a pinpoint and a checkedBy signature', () => {
    expect(meetsAuthoritativePromotionGate({ pinpoint: null, checkedBy: null })).toBe(false);
    expect(meetsAuthoritativePromotionGate({ pinpoint: '§ 55.1-300(B)', checkedBy: null })).toBe(false);
    expect(meetsAuthoritativePromotionGate({ pinpoint: null, checkedBy: 'KS' })).toBe(false);
    expect(meetsAuthoritativePromotionGate({ pinpoint: '  ', checkedBy: 'KS' })).toBe(false); // whitespace is not a pin
    expect(meetsAuthoritativePromotionGate({ pinpoint: '§ 55.1-300(B)', checkedBy: 'KS' })).toBe(true);
  });
});

// ── 2. Zod Wall — schema presence + enforcement ───────────────────────────────────
describe('KB-BACKBONE-P2 I1 — scope-metadata Zod Wall', () => {
  it('PracticeMemoRowSchema round-trips documentType / riskLevel / autoApplyEligible / originMatterId / conflictsHook', () => {
    const row = memoRow({
      originMatterId: '55555555-5555-5555-5555-555555555555',
      documentType: 'deed_of_gift',
      riskLevel: 'high',
      autoApplyEligible: true,
      conflictsHook: { originMatterId: '55555555-5555-5555-5555-555555555555', adverseToPartyIds: ['p1'], note: 'adverse to X' },
    });
    const parsed = PracticeMemoRowSchema.parse(row);
    expect(parsed.documentType).toBe('deed_of_gift');
    expect(parsed.riskLevel).toBe('high');
    expect(parsed.autoApplyEligible).toBe(true);
    expect(parsed.originMatterId).toBe('55555555-5555-5555-5555-555555555555');
    expect(parsed.conflictsHook?.adverseToPartyIds).toEqual(['p1']);
  });

  it('rejects an out-of-domain riskLevel (low|medium|high only)', () => {
    expect(() => PracticeMemoRowSchema.parse(memoRow({ riskLevel: 'critical' }))).toThrow();
  });

  it('parses legacy rows that predate the migration (new fields absent)', () => {
    const legacy = memoRow();
    delete legacy['documentType'];
    delete legacy['riskLevel'];
    delete legacy['autoApplyEligible'];
    delete legacy['conflictsHook'];
    expect(() => PracticeMemoRowSchema.parse(legacy)).not.toThrow();
  });
});

// ── 3. Procedures (flag ON) ───────────────────────────────────────────────────────
describe('KB-BACKBONE-P2 I1 — captureMemo', () => {
  it('captures most-private: never passes verificationStatus / reuseScope / autoApplyEligible to the insert', async () => {
    fn(insertPracticeMemo).mockResolvedValue(memoRow());
    await caller().captureMemo({ title: 'T', body: 'B', riskLevel: 'medium', documentType: 'memo' });
    expect(fn(insertPracticeMemo)).toHaveBeenCalledTimes(1);
    const arg = fn(insertPracticeMemo).mock.calls[0]![0] as Record<string, unknown>;
    // The capture path can NOT elevate posture or set verified — those fields are not even passed (the wrapper
    // applies the most-private defaults: unverified / client_confidential / raw / matter_only / autoApply FALSE).
    expect(arg).not.toHaveProperty('verificationStatus');
    expect(arg).not.toHaveProperty('reuseScope');
    expect(arg).not.toHaveProperty('privilegeTag');
    expect(arg).not.toHaveProperty('abstractionStatus');
    expect(arg).not.toHaveProperty('autoApplyEligible');
    // scope-metadata IS carried through.
    expect(arg['riskLevel']).toBe('medium');
    expect(arg['documentType']).toBe('memo');
    // kb_events spine: capture is audited.
    expect(fn(insertKbEvent)).toHaveBeenCalledTimes(1);
    expect(fn(insertKbEvent).mock.calls[0]![0].action).toBe('memo_created');
  });

  it('refuses a cross-owner authoritySourceId reference (and never inserts)', async () => {
    fn(getAuthoritySourceById).mockResolvedValue(null); // not owned (or not found)
    await expect(
      caller().captureMemo({
        title: 'T',
        body: 'B',
        lawReliedOn: [{ jurisdiction: 'VA', citationOrSource: 'Va. Code § 55.1-300', sourceType: 'statute', authoritySourceId: AUTH_ID }],
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(fn(insertPracticeMemo)).not.toHaveBeenCalled();
  });

  it('accepts a same-owner authoritySourceId reference and writes the dormant link through to the insert', async () => {
    fn(getAuthoritySourceById).mockResolvedValue(authRow());
    fn(insertPracticeMemo).mockResolvedValue(memoRow());
    const lawReliedOn = [{ jurisdiction: 'VA', citationOrSource: 'Va. Code § 55.1-300', sourceType: 'statute', authoritySourceId: AUTH_ID }];
    await caller().captureMemo({ title: 'T', body: 'B', lawReliedOn });
    expect(fn(insertPracticeMemo)).toHaveBeenCalledTimes(1);
    // the lawReliedOn[].authoritySourceId link reaches the persistence layer (the dormant link is populated)
    expect((fn(insertPracticeMemo).mock.calls[0]![0] as Record<string, unknown>)['lawReliedOn']).toEqual(lawReliedOn);
  });
});

describe('KB-BACKBONE-P2 I1 — verifyMemo (reviewBy-required; AI never verifies)', () => {
  it('refuses attorney_verified_current with no reviewBy (on the memo or supplied)', async () => {
    fn(getPracticeMemoById).mockResolvedValue(memoRow({ reviewBy: null }));
    await expect(
      caller().verifyMemo({ memoId: MEMO_ID, verificationStatus: 'attorney_verified_current' }),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    expect(fn(markMemoReverified)).not.toHaveBeenCalled();
  });

  it('allows attorney_verified_current when a reviewBy is supplied', async () => {
    fn(getPracticeMemoById).mockResolvedValue(memoRow({ reviewBy: null }));
    fn(markMemoReverified).mockResolvedValue(memoRow({ verificationStatus: 'attorney_verified_current', reviewBy: '2026-12-31' }));
    await caller().verifyMemo({ memoId: MEMO_ID, verificationStatus: 'attorney_verified_current', reviewBy: '2026-12-31' });
    expect(fn(markMemoReverified)).toHaveBeenCalledTimes(1);
    expect(fn(markMemoReverified).mock.calls[0]![0]).toMatchObject({ reviewBy: '2026-12-31', verificationStatus: 'attorney_verified_current' });
  });

  it('does NOT require reviewBy for non-verified statuses (e.g. flagging stale)', async () => {
    fn(getPracticeMemoById).mockResolvedValue(memoRow({ reviewBy: null }));
    fn(markMemoReverified).mockResolvedValue(memoRow({ verificationStatus: 'stale' }));
    await caller().verifyMemo({ memoId: MEMO_ID, verificationStatus: 'stale' });
    expect(fn(markMemoReverified)).toHaveBeenCalledTimes(1);
  });

  it('D6: an explicit reviewBy:null can NOT clear a stored reviewBy on the verified path (persists the stored value)', async () => {
    // Regression for the gate/write null-semantics gap: gate passes on the stored reviewBy, so the WRITE must
    // persist that stored value — not the raw null — or the row lands verified with reviewBy NULL (D6 breach).
    fn(getPracticeMemoById).mockResolvedValue(memoRow({ reviewBy: '2026-12-31' }));
    fn(markMemoReverified).mockResolvedValue(memoRow({ verificationStatus: 'attorney_verified_current', reviewBy: '2026-12-31' }));
    await caller().verifyMemo({ memoId: MEMO_ID, verificationStatus: 'attorney_verified_current', reviewBy: null });
    expect(fn(markMemoReverified).mock.calls[0]![0]).toMatchObject({ reviewBy: '2026-12-31', verificationStatus: 'attorney_verified_current' });
  });
});

describe('KB-BACKBONE-P2 I1 — authority_source reads + patch (flag ON, owner-scoped delegation)', () => {
  it('list-by-jurisdiction delegates owner-scoped', async () => {
    fn(listAuthoritySourcesByJurisdiction).mockResolvedValue([authRow()]);
    const res = await caller().authoritySourceListByJurisdiction({ jurisdiction: 'VA' });
    expect(fn(listAuthoritySourcesByJurisdiction)).toHaveBeenCalledWith('VA', U1);
    expect(res).toHaveLength(1);
  });

  it('approaching-review forwards the onOrBefore worklist cutoff (and the no-arg case)', async () => {
    fn(listAuthoritySourcesApproachingReview).mockResolvedValue([authRow({ reviewByDate: '2026-09-01' })]);
    await caller().authoritySourceListApproachingReview({ onOrBefore: '2026-12-31' });
    expect(fn(listAuthoritySourcesApproachingReview)).toHaveBeenCalledWith(U1, { onOrBefore: '2026-12-31' });
    fn(listAuthoritySourcesApproachingReview).mockClear();
    await caller().authoritySourceListApproachingReview({});
    expect(fn(listAuthoritySourcesApproachingReview)).toHaveBeenCalledWith(U1, undefined);
  });

  it('update forwards a partial patch (absent keys omitted; present null preserved) and refuses NOT_FOUND on a missing row', async () => {
    fn(updateAuthoritySource).mockResolvedValue(authRow({ pinpoint: '§ 55.1-300(B)' }));
    await caller().authoritySourceUpdate({ id: AUTH_ID, pinpoint: '§ 55.1-300(B)' });
    // patch semantics: only id + userId + the present key are forwarded (no other column clobbered)
    expect(fn(updateAuthoritySource).mock.calls[0]![0]).toEqual({ id: AUTH_ID, userId: U1, pinpoint: '§ 55.1-300(B)' });

    fn(updateAuthoritySource).mockClear();
    fn(updateAuthoritySource).mockResolvedValue(authRow({ notes: null }));
    await caller().authoritySourceUpdate({ id: AUTH_ID, notes: null }); // an explicit null IS forwarded (clears)
    expect(fn(updateAuthoritySource).mock.calls[0]![0]).toEqual({ id: AUTH_ID, userId: U1, notes: null });

    fn(updateAuthoritySource).mockClear();
    fn(updateAuthoritySource).mockResolvedValue(null); // not owned / not found
    await expect(caller().authoritySourceUpdate({ id: AUTH_ID, notes: 'x' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('KB-BACKBONE-P2 I1 — authoritySource activation + §2 promotion gate', () => {
  it('create files a citation and audits it on the kb_events spine', async () => {
    fn(createAuthoritySource).mockResolvedValue(authRow());
    await caller().authoritySourceCreate({ jurisdiction: 'VA', authorityType: 'statute', citationText: 'Va. Code § 55.1-300' });
    expect(fn(createAuthoritySource)).toHaveBeenCalledTimes(1);
    expect(fn(insertKbEvent).mock.calls[0]![0].action).toBe('authority_source_created');
  });

  it('get refuses (NOT_FOUND) when the row is not owned / not found', async () => {
    fn(getAuthoritySourceById).mockResolvedValue(null);
    await expect(caller().authoritySourceGet({ id: AUTH_ID })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('promote REFUSES without a pinned pinpoint + checkedBy (and never updates)', async () => {
    fn(getAuthoritySourceById).mockResolvedValue(authRow({ pinpoint: null, checkedBy: null }));
    await expect(caller().authoritySourcePromote({ id: AUTH_ID })).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    expect(fn(updateAuthoritySource)).not.toHaveBeenCalled();
  });

  it('promote SUCCEEDS with a pinpoint + checkedBy, updates the row, and audits it', async () => {
    fn(getAuthoritySourceById).mockResolvedValue(authRow({ pinpoint: null, checkedBy: null }));
    fn(updateAuthoritySource).mockResolvedValue(authRow({ pinpoint: '§ 55.1-300(B)', checkedBy: 'KS' }));
    await caller().authoritySourcePromote({ id: AUTH_ID, pinpoint: '§ 55.1-300(B)', checkedBy: 'KS' });
    expect(fn(updateAuthoritySource)).toHaveBeenCalledTimes(1);
    expect(fn(insertKbEvent).mock.calls.at(-1)![0].action).toBe('authority_source_promoted');
  });
});

describe('KB-BACKBONE-P2 I1 — setAutoApplyEligible delegates to the D3-gated wrapper', () => {
  it('passes the flip through to setMemoAutoApplyEligible (the wrapper enforces the D3 lock)', async () => {
    fn(setMemoAutoApplyEligible).mockResolvedValue(memoRow({ autoApplyEligible: false }));
    await caller().setAutoApplyEligible({ memoId: MEMO_ID, autoApplyEligible: true });
    expect(fn(setMemoAutoApplyEligible)).toHaveBeenCalledWith({ memoId: MEMO_ID, userId: U1, autoApplyEligible: true, rationale: null });
  });
});

// ── 4. Flag-off regression ────────────────────────────────────────────────────────
describe('KB-BACKBONE-P2 I1 — flag OFF: the whole surface fail-closes and nothing else runs', () => {
  beforeEach(() => {
    delete process.env['KB_BACKBONE_ENABLED'];
  });

  it('every procedure throws PRECONDITION_FAILED with the flag off', async () => {
    const c = caller();
    await expect(c.captureMemo({ title: 'T', body: 'B' })).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    await expect(c.authoritySourceCreate({ jurisdiction: 'VA', authorityType: 'statute', citationText: 'x' })).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    await expect(c.authoritySourceGet({ id: AUTH_ID })).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    await expect(c.authoritySourceListByJurisdiction({ jurisdiction: 'VA' })).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    await expect(c.authoritySourceListApproachingReview({})).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    await expect(c.authoritySourceUpdate({ id: AUTH_ID })).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    await expect(c.authoritySourcePromote({ id: AUTH_ID })).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    await expect(c.verifyMemo({ memoId: MEMO_ID, verificationStatus: 'attorney_verified_current' })).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    await expect(c.setAutoApplyEligible({ memoId: MEMO_ID, autoApplyEligible: true })).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    await expect(c.getMemo({ memoId: MEMO_ID })).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    // No query-wrapper was touched — the flag gate is the first line of every procedure.
    expect(fn(insertPracticeMemo)).not.toHaveBeenCalled();
    expect(fn(getPracticeMemoById)).not.toHaveBeenCalled();
    expect(fn(createAuthoritySource)).not.toHaveBeenCalled();
    expect(fn(getAuthoritySourceById)).not.toHaveBeenCalled();
    expect(fn(insertKbEvent)).not.toHaveBeenCalled();
  });
});
