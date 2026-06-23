/**
 * DEED-DRAFT-AGENT-1 Inc 3 — the createEngagementLetter wiring procedure + the deed-aware default resolver.
 *
 * (1) resolveEngagementLetterInput: pure default logic (client = grantors, recipients = grantees not in the
 * client set, grantees = the resulting owners). (2) createEngagementLetter via a tRPC caller with the DB/gate
 * leaves mocked — the three fail-closed gates (flag, ownership, conflicts) and the happy-path persistence as a
 * documentType 'engagement_letter' draft carrying the verbatim letter text.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Request, Response } from 'express';

vi.mock('../db/queries/matters.js', () => ({ getMatterById: vi.fn() }));
vi.mock('../db/queries/materials.js', () => ({ listMaterialsForMatter: vi.fn() }));
vi.mock('../db/queries/documents.js', () => ({ insertDocument: vi.fn(), updateDocumentCurrentVersion: vi.fn() }));
vi.mock('../db/queries/versions.js', () => ({ getNextVersionNumber: vi.fn(), insertVersion: vi.fn() }));
vi.mock('../conflicts/postureGate.js', () => ({ resolvePostureDraftingGate: vi.fn() }));
vi.mock('../db/queries/conflicts.js', () => ({ hasUndispositionedBlocker: vi.fn() }));

import { deedDraftAgentRouter, resolveEngagementLetterInput, buildEngagementLetterDraft } from '../procedures/deedDraftAgent.js';
import { getMatterById } from '../db/queries/matters.js';
import { listMaterialsForMatter } from '../db/queries/materials.js';
import { insertDocument, updateDocumentCurrentVersion } from '../db/queries/documents.js';
import { getNextVersionNumber, insertVersion } from '../db/queries/versions.js';
import { resolvePostureDraftingGate } from '../conflicts/postureGate.js';
import { hasUndispositionedBlocker } from '../db/queries/conflicts.js';

const U1 = '11111111-1111-1111-1111-111111111111';
const M1 = '22222222-2222-2222-2222-222222222222';
const caller = () => deedDraftAgentRouter.createCaller({ req: {} as Request, res: {} as Response, userId: U1 });

function fullLetterCall() {
  return {
    matterId: M1,
    grantors: [{ name: 'Harold V. Greer' }],
    grantees: [{ name: 'Harold V. Greer' }, { name: 'Marie A. Bien-Aime' }],
    locality: 'Prince William County',
    letter: {
      date: 'June 18, 2026',
      clientAddress: '108 Maple Avenue\nManassas, Virginia 20110',
      salutation: 'Dear Mr. Greer:',
      propertyAddress: '500 Cedar Run Lane, Manassas, Virginia 20109',
      reAction: 'Addition of Marie A. Bien-Aime to Title',
      feeAmount: '350.00',
      recipientPronoun: { subject: 'she', possessive: 'her' },
    },
  };
}

// ── pure default resolver ─────────────────────────────────────────────────────────

describe('resolveEngagementLetterInput — deed-aware defaults', () => {
  it('client = grantors; recipients = grantees not in the client set; grantees = resulting owners', () => {
    const resolved = resolveEngagementLetterInput(
      { grantors: [{ name: 'Harold V. Greer' }], grantees: [{ name: 'Harold V. Greer' }, { name: 'Marie A. Bien-Aime' }] },
      {},
    );
    expect(resolved.clientNames).toEqual(['Harold V. Greer']);
    expect(resolved.recipientNames).toEqual(['Marie A. Bien-Aime']);
    expect(resolved.granteeNames).toEqual(['Harold V. Greer', 'Marie A. Bien-Aime']);
  });

  it('an explicit client list overrides the grantor default and recomputes recipients', () => {
    const resolved = resolveEngagementLetterInput(
      { grantors: [{ name: 'A' }], grantees: [{ name: 'A' }, { name: 'B' }] },
      { clientNames: ['A', 'B'] },
    );
    expect(resolved.clientNames).toEqual(['A', 'B']);
    expect(resolved.recipientNames).toEqual([]); // both grantees are clients -> no separate-rep recipient
  });

  it('recordingCounty falls back to the gift locality', () => {
    const resolved = resolveEngagementLetterInput(
      { grantors: [{ name: 'A' }], grantees: [{ name: 'B' }], locality: 'Fairfax County' },
      {},
    );
    expect(resolved.recordingCounty).toBe('Fairfax County');
  });
});

describe('buildEngagementLetterDraft — re-derives the SAME deed (cross-link consistency)', () => {
  it('the letter vesting equals the deed vesting (deterministic re-derivation)', () => {
    const gift = { grantors: [{ name: 'Harold V. Greer' }], grantees: [{ name: 'Harold V. Greer' }, { name: 'Marie A. Bien-Aime' }] };
    const letterInput = resolveEngagementLetterInput(gift, { feeAmount: '350.00', recipientPronoun: { subject: 'she', possessive: 'her' } });
    const { deed, letter } = buildEngagementLetterDraft([], gift, letterInput);
    expect(letter.crossLink.vesting).toBe(deed.vesting.language);
    expect(letter.crossLink.deedType).toBe('Deed of Gift');
  });
});

// ── procedure: gates + persistence ─────────────────────────────────────────────────

describe('deedDraftAgent.createEngagementLetter — fail-closed gates + persistence', () => {
  const origDeed = process.env['DEED_DRAFT_AGENT_ENABLED'];
  const origConflict = process.env['CONFLICT_GATE_ENABLED'];

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env['DEED_DRAFT_AGENT_ENABLED'];
    delete process.env['CONFLICT_GATE_ENABLED'];
  });
  afterEach(() => {
    if (origDeed === undefined) delete process.env['DEED_DRAFT_AGENT_ENABLED'];
    else process.env['DEED_DRAFT_AGENT_ENABLED'] = origDeed;
    if (origConflict === undefined) delete process.env['CONFLICT_GATE_ENABLED'];
    else process.env['CONFLICT_GATE_ENABLED'] = origConflict;
  });

  it('refuses when the flag is OFF — nothing is created', async () => {
    await expect(caller().createEngagementLetter(fullLetterCall())).rejects.toThrow(/DEED_DRAFT_AGENT_DISABLED/);
    expect(insertDocument).not.toHaveBeenCalled();
  });

  it('NOT_FOUND when the matter is not owned/absent', async () => {
    process.env['DEED_DRAFT_AGENT_ENABLED'] = 'true';
    (getMatterById as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await expect(caller().createEngagementLetter(fullLetterCall())).rejects.toThrow(/Matter not found/);
    expect(insertDocument).not.toHaveBeenCalled();
  });

  it('fail-closed on the conflicts-at-intake gate — no document created', async () => {
    process.env['DEED_DRAFT_AGENT_ENABLED'] = 'true';
    process.env['CONFLICT_GATE_ENABLED'] = 'true';
    (getMatterById as ReturnType<typeof vi.fn>).mockResolvedValue({ id: M1, userId: U1, archivedAt: null });
    (resolvePostureDraftingGate as ReturnType<typeof vi.fn>).mockResolvedValue({ allowed: false, blockingReasons: ['no_client_party'] });
    await expect(caller().createEngagementLetter(fullLetterCall())).rejects.toThrow(/CONFLICTS_NOT_CLEARED/);
    expect(insertDocument).not.toHaveBeenCalled();
  });

  it('happy path: creates an "engagement_letter" draft carrying the VERBATIM letter text + cross-link', async () => {
    process.env['DEED_DRAFT_AGENT_ENABLED'] = 'true';
    (getMatterById as ReturnType<typeof vi.fn>).mockResolvedValue({ id: M1, userId: U1, archivedAt: null });
    (hasUndispositionedBlocker as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    (listMaterialsForMatter as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (insertDocument as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'doc-1', documentType: 'engagement_letter', draftingMode: 'iterative', title: 'Engagement Letter — Deed of Gift' });
    (getNextVersionNumber as ReturnType<typeof vi.fn>).mockResolvedValue(1);
    (insertVersion as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'ver-1', versionNumber: 1 });
    (updateDocumentCurrentVersion as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'doc-1' });

    const res = await caller().createEngagementLetter(fullLetterCall());

    expect(insertDocument).toHaveBeenCalledWith(expect.objectContaining({ matterId: M1, documentType: 'engagement_letter', workflowState: 'drafting', currentVersionId: null }));
    const versionArg = (insertVersion as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(versionArg.documentId).toBe('doc-1');
    // verbatim disclaimer + separate-rep + the deed's exemption recital are all in the persisted version
    expect(versionArg.content).toContain('A title search was not requested or performed in conjunction with drafting this Deed.');
    expect(versionArg.content).toContain('the recipient of an interest in the Property');
    expect(versionArg.content).toContain('pursuant to Va. Code § 58.1-811(D).');
    expect(updateDocumentCurrentVersion).toHaveBeenCalledWith('doc-1', U1, 'ver-1');
    expect(res.documentId).toBe('doc-1');
    expect(res.crossLink.deedType).toBe('Deed of Gift');
    expect(res.separateRepIncluded).toBe(true);
    expect(res.spineIntact).toBe(true);
    expect(res.placeholders).toEqual([]);
  });

  it('happy path with no fee: still creates the draft, surfaces the [[ ]] placeholder, spineIntact=false', async () => {
    process.env['DEED_DRAFT_AGENT_ENABLED'] = 'true';
    (getMatterById as ReturnType<typeof vi.fn>).mockResolvedValue({ id: M1, userId: U1, archivedAt: null });
    (hasUndispositionedBlocker as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    (listMaterialsForMatter as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (insertDocument as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'doc-2', documentType: 'engagement_letter', draftingMode: 'iterative', title: 'Engagement Letter — Deed of Gift' });
    (getNextVersionNumber as ReturnType<typeof vi.fn>).mockResolvedValue(1);
    (insertVersion as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'ver-2', versionNumber: 1 });
    (updateDocumentCurrentVersion as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'doc-2' });

    const call = fullLetterCall();
    delete (call.letter as { feeAmount?: string }).feeAmount;
    const res = await caller().createEngagementLetter(call);
    expect(res.spineIntact).toBe(false);
    expect(res.placeholders.some((p) => p.field === 'fee amount')).toBe(true);
    expect(insertDocument).toHaveBeenCalled(); // the draft IS created — the attorney fills the fee
  });
});
