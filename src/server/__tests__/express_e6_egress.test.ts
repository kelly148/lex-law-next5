/**
 * EXPRESS-AUTO-REVIEW-LOOP-1 E6 — the FAIL-CLOSED EGRESS increment tests.
 *
 * E6 supplies the REAL, egress-backed ports for the E5 loop (through the EXISTING broker, surface 'reviewer',
 * enforceProviderAllowlist TRUE) + the flag-gated tRPC procedure that runs the loop. These tests MOCK the
 * broker (no real LLM): the port unit-tests drive makeReviewPort/applyAdoptedEdits via the injectable `send`
 * seam; the procedure tests mock the broker module + the DB query reads and run the REAL procedure through the
 * appRouter caller.
 *
 * Blocking acceptance bar (the egress guardrails + the build spec §E6):
 *  - FAIL-CLOSED: the broker throws DocumentEgressBlockedError -> the procedure returns { status:'blocked' },
 *    NO candidate, NO adopt.
 *  - FLAG OFF -> the procedure refuses (PRECONDITION_FAILED); NO broker call.
 *  - the ReviewPort adapts mock feedback -> RoutableSuggestion[]; an un-locatable BEFORE span -> ESCALATE
 *    (never auto_adopt).
 *  - enforceProviderAllowlist is TRUE on every broker call (asserted on the captured param).
 *  - the candidate is returned NON-FINAL; nothing is finalized/sent/persisted-as-final.
 *  - the deterministic RegeneratePort applies the adopted edits to the original correctly (+ fail-closed on a
 *    drifted anchor).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Request, Response } from 'express';

// ── Mocks: the EXISTING egress broker (keep the real DocumentEgressBlockedError) + the DB query reads. ──
vi.mock('../egress/documentEgress.js', async (orig) => ({
  ...(await orig<typeof import('../egress/documentEgress.js')>()),
  documentEgressSend: vi.fn(),
}));
vi.mock('../db/queries/matters.js', async (orig) => ({
  ...(await orig<typeof import('../db/queries/matters.js')>()),
  getMatterById: vi.fn(),
}));
vi.mock('../db/queries/documents.js', async (orig) => ({
  ...(await orig<typeof import('../db/queries/documents.js')>()),
  getDocumentById: vi.fn(),
}));
vi.mock('../db/queries/versions.js', async (orig) => ({
  ...(await orig<typeof import('../db/queries/versions.js')>()),
  getLatestVersionForDocument: vi.fn(),
}));

import { documentEgressSend, DocumentEgressBlockedError, type DocumentEgressParams } from '../egress/documentEgress.js';
import { getMatterById } from '../db/queries/matters.js';
import { getDocumentById } from '../db/queries/documents.js';
import { getLatestVersionForDocument } from '../db/queries/versions.js';
import { appRouter } from '../router.js';
import type { LlmGenerateResult } from '../llm/types.js';
import type { MatterRow, DocumentRow, VersionRow } from '../../shared/schemas/matters.js';
import {
  makeReviewPort,
  makeRegeneratePort,
  applyAdoptedEdits,
  RegenerateAnchorError,
  adaptFeedbackItemToSuggestion,
  adaptFeedbackToSuggestions,
  locateUniqueSpan,
  type ExpressReviewerOutput,
} from '../express/expressPorts.js';
import type { LoopContext, AdoptedChange } from '../express/reviewLoop.js';
import { routeSuggestion, createImmutabilityTracker, routeWithImmutability } from '../express/adoptRouter.js';

const U1 = '11111111-1111-1111-1111-111111111111';
const MATTER_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const DOC_A = 'd0000000-0000-0000-0000-00000000000a';
const VER_A = 'e0000000-0000-0000-0000-00000000000a';

const caller = (userId: string) => appRouter.createCaller({ req: {} as Request, res: {} as Response, userId });

/** Build a mock LlmGenerateResult whose content is the given reviewer output JSON. */
function reviewerResult(output: ExpressReviewerOutput): LlmGenerateResult {
  return { content: JSON.stringify(output), tokensPrompt: 1, tokensCompletion: 1, providerMetadata: {} };
}

const CTX: LoopContext = { documentType: 'deed', originalMaterials: 'ORIGINAL' };

// A plain working note with a known whitespace-fixable double space (locus-clean text, no protected spans).
const PLAIN = 'This is  a plain working note with no operative legal language in it whatsoever.';

afterEach(() => {
  vi.clearAllMocks();
});

// ── PORT UNIT TESTS — drive the ports via the injectable `send` seam (no DB, no real LLM). ──────────────

describe('E6 ports — makeReviewPort fail-closed + allowlist + span-derivation', () => {
  it('FAIL-CLOSED: a DocumentEgressBlockedError from the broker PROPAGATES out of the ReviewPort', async () => {
    const send = vi.fn(async (_p: DocumentEgressParams): Promise<LlmGenerateResult> => {
      throw new DocumentEgressBlockedError('hold_no_external', 'evt-1');
    });
    const port = makeReviewPort({
      subject: { type: 'document', subjectId: VER_A, matterId: MATTER_A, userId: U1, documentId: DOC_A, documentVersionId: VER_A },
      modelString: 'openai:gpt-5',
      send: send as unknown as typeof documentEgressSend,
    });
    await expect(port(PLAIN, CTX)).rejects.toBeInstanceOf(DocumentEgressBlockedError);
    // The broker WAS called, with enforceProviderAllowlist TRUE.
    expect(send).toHaveBeenCalledTimes(1);
    const arg = send.mock.calls[0]![0];
    expect(arg.enforceProviderAllowlist).toBe(true);
    expect(arg.surface).toBe('reviewer');
  });

  it('enforceProviderAllowlist is TRUE + surface is reviewer on every broker call', async () => {
    const send = vi.fn(async (_p: DocumentEgressParams): Promise<LlmGenerateResult> => reviewerResult([]));
    const port = makeReviewPort({
      subject: { type: 'document', subjectId: VER_A, matterId: MATTER_A, userId: U1, documentId: DOC_A, documentVersionId: VER_A },
      modelString: 'openai:gpt-5',
      send: send as unknown as typeof documentEgressSend,
    });
    await port(PLAIN, CTX);
    const arg = send.mock.calls[0]![0];
    expect(arg.enforceProviderAllowlist).toBe(true);
    expect(arg.surface).toBe('reviewer');
    // store-by-reference: the serializedPayload is the prompt bundle (hashed by the broker), never persisted here.
    expect(typeof arg.serializedPayload).toBe('string');
  });

  it('adapts a locatable anchored edit -> a routable suggestion with REAL offsets + the Class-A claim', async () => {
    const output: ExpressReviewerOutput = [
      { title: 'spacing', body: 'Normalize: BEFORE: "is  a" AFTER: "is a" CLASS_A: whitespace_spacing', severity: 'minor' },
    ];
    const send = vi.fn(async () => reviewerResult(output));
    const port = makeReviewPort({
      subject: { type: 'document', subjectId: VER_A, matterId: MATTER_A, userId: U1, documentId: DOC_A, documentVersionId: VER_A },
      modelString: 'openai:gpt-5',
      send: send as unknown as typeof documentEgressSend,
    });
    const suggestions = await port(PLAIN, CTX);
    expect(suggestions).toHaveLength(1);
    const s = suggestions[0]!;
    expect(s.beforeText).toBe('is  a');
    expect(s.afterText).toBe('is a');
    expect(s.claimedClassA).toBe('whitespace_spacing');
    // the located offsets point at the real "is  a" run in PLAIN.
    expect(PLAIN.slice(s.targetStart, s.targetEnd)).toBe('is  a');
    // and it ROUTES auto_adopt in locus-clean text (a verified Class-A whitespace fix).
    expect(routeSuggestion(s, { protectedSpans: [], documentText: PLAIN }).route).toBe('auto_adopt');
  });

  it('an UN-LOCATABLE BEFORE span (absent OR ambiguous OR no quote) -> a claim-less ESCALATE suggestion', async () => {
    // (a) absent: the BEFORE text is not in the candidate.
    const absent = adaptFeedbackItemToSuggestion(
      { title: 'x', body: 'BEFORE: "NOT IN THE DOC" AFTER: "y" CLASS_A: typo_fix', severity: 'minor' },
      PLAIN,
    );
    // (b) ambiguous: "a " occurs more than once -> un-locatable.
    const ambiguous = adaptFeedbackItemToSuggestion(
      { title: 'x', body: 'BEFORE: "a " AFTER: "a" CLASS_A: whitespace_spacing', severity: 'minor' },
      'a a a a',
    );
    // (c) no BEFORE quote at all.
    const noQuote = adaptFeedbackItemToSuggestion({ title: 'x', body: 'Just prose, no envelope.', severity: 'major' }, PLAIN);

    for (const s of [absent, ambiguous, noQuote]) {
      // degenerate, claim-less: zero-width at 0, no Class-A claim -> ESCALATE (never auto_adopt).
      expect(s.targetStart).toBe(0);
      expect(s.targetEnd).toBe(0);
      expect(s.claimedClassA).toBeUndefined();
      expect(routeSuggestion(s, { protectedSpans: [], documentText: PLAIN }).route).toBe('escalate');
    }
  });

  it('a malformed reviewer reply yields NO suggestions (a no-adopt round; never fabricates/auto-adopts)', async () => {
    const send = vi.fn(async () => ({ content: 'not json at all', tokensPrompt: 1, tokensCompletion: 1, providerMetadata: {} } as LlmGenerateResult));
    const port = makeReviewPort({
      subject: { type: 'document', subjectId: VER_A, matterId: MATTER_A, userId: U1, documentId: DOC_A, documentVersionId: VER_A },
      modelString: 'openai:gpt-5',
      send: send as unknown as typeof documentEgressSend,
    });
    expect(await port(PLAIN, CTX)).toEqual([]);
  });

  it('locateUniqueSpan is fail-closed: absent -> null, ambiguous -> null, unique -> the span', () => {
    expect(locateUniqueSpan('abc', 'z')).toBeNull();
    expect(locateUniqueSpan('a a a', 'a ')).toBeNull(); // ambiguous
    expect(locateUniqueSpan('hello world', 'world')).toEqual({ start: 6, end: 11 });
    expect(locateUniqueSpan('abc', '')).toBeNull(); // empty needle un-locatable
  });
});

describe('E6 ports — makeRegeneratePort: deterministic apply-adopted-edits (no egress, fail-closed)', () => {
  function adopt(beforeText: string, afterText: string, offsetStart: number, round = 1, ledgerId = 'e1-1'): AdoptedChange {
    return { round, ledgerId, beforeText, afterText, offsetStart, offsetEnd: offsetStart + beforeText.length };
  }

  it('applies a single adopted edit at its recorded offset', () => {
    const out = applyAdoptedEdits(PLAIN, [adopt('is  a', 'is a', PLAIN.indexOf('is  a'))]);
    expect(out).toBe(PLAIN.replace('is  a', 'is a'));
  });

  it('applies MULTIPLE adopted edits descending-by-offset so earlier splices never shift later offsets', () => {
    const text = 'alpha  beta   gamma'; // two double/triple spaces
    const a1 = adopt('alpha  beta', 'alpha beta', text.indexOf('alpha  beta'), 1, 'e1-1');
    const a2 = adopt('beta   gamma', 'beta gamma', text.indexOf('beta   gamma'), 1, 'e1-2');
    const out = applyAdoptedEdits(text, [a1, a2]);
    expect(out).toBe('alpha beta gamma');
  });

  it('falls back to a UNIQUE content match when a cross-round offset has drifted', () => {
    // round-2 adopt's offset is stale (into round-2's candidate), but its beforeText is uniquely locatable.
    const text = 'one two three four';
    const stale = { round: 2, ledgerId: 'e2-1', beforeText: 'three', afterText: 'THREE', offsetStart: 999, offsetEnd: 1004 };
    expect(applyAdoptedEdits(text, [stale])).toBe('one two THREE four');
  });

  it('FAIL-CLOSED: a drifted anchor that is NOT uniquely locatable THROWS RegenerateAnchorError (no blind splice)', () => {
    const text = 'aaa';
    const bad = { round: 1, ledgerId: 'e1-1', beforeText: 'a', afterText: 'X', offsetStart: 50, offsetEnd: 51 };
    expect(() => applyAdoptedEdits(text, [bad])).toThrow(RegenerateAnchorError); // 'a' is ambiguous + offset wrong
  });

  it('the RegeneratePort rebuilds from the ORIGINAL text + the adopted set (anti-drift)', async () => {
    const port = makeRegeneratePort();
    const out = await port(PLAIN, [adopt('is  a', 'is a', PLAIN.indexOf('is  a'))], CTX);
    expect(out).toBe(PLAIN.replace('is  a', 'is a'));
  });
});

// A real deed protected span ("legal_description") immutability sanity for the adapter -> route path.
describe('E6 ports — an adapted suggestion landing in a protected span ESCALATES (E1 preserved)', () => {
  it('a locatable edit inside a protected span escalates even with a Class-A claim', () => {
    const DEED = 'Header text. BEGIN LEGAL Lot 12 CEDAR RUN ESTATES END LEGAL. Footer.';
    const legalStart = DEED.indexOf('Lot 12');
    const legalEnd = DEED.indexOf(' END');
    const tracker = createImmutabilityTracker();
    const item = { title: 'x', body: 'BEFORE: "Lot 12" AFTER: "Lot 13" CLASS_A: numbering', severity: 'major' as const };
    const s = adaptFeedbackItemToSuggestion(item, DEED);
    const res = routeWithImmutability(s, tracker, {
      protectedSpans: [{ start: legalStart, end: legalEnd, label: 'legal_description' }],
      documentText: DEED,
    });
    expect(res.route).toBe('escalate');
  });
});

// ── PROCEDURE TESTS — the REAL flag/ownership/fail-closed gating through the appRouter caller. ──────────

describe('E6 procedure — expressReviewLoop.run flag/ownership/fail-closed gating', () => {
  beforeEach(() => {
    process.env['AUTO_REVIEW_LOOP_ENABLED'] = 'true';
    vi.mocked(getMatterById).mockResolvedValue({ id: MATTER_A, userId: U1 } as unknown as MatterRow);
    vi.mocked(getDocumentById).mockResolvedValue({ id: DOC_A, matterId: MATTER_A, documentType: 'deed' } as unknown as DocumentRow);
    vi.mocked(getLatestVersionForDocument).mockResolvedValue({ id: VER_A, content: PLAIN } as unknown as VersionRow);
  });
  afterEach(() => {
    delete process.env['AUTO_REVIEW_LOOP_ENABLED'];
  });

  it('FLAG OFF -> refuses with PRECONDITION_FAILED; NO broker call', async () => {
    delete process.env['AUTO_REVIEW_LOOP_ENABLED'];
    await expect(caller(U1).expressReviewLoop.run({ matterId: MATTER_A, documentId: DOC_A })).rejects.toThrow(
      /AUTO_REVIEW_LOOP_DISABLED/,
    );
    expect(vi.mocked(documentEgressSend)).not.toHaveBeenCalled();
  });

  it('the isEnabled probe reflects the flag', async () => {
    expect((await caller(U1).expressReviewLoop.isEnabled()).enabled).toBe(true);
    delete process.env['AUTO_REVIEW_LOOP_ENABLED'];
    expect((await caller(U1).expressReviewLoop.isEnabled()).enabled).toBe(false);
  });

  it('FAIL-CLOSED: the broker throws DocumentEgressBlockedError -> { status:"blocked" }, NO candidate/adopt', async () => {
    vi.mocked(documentEgressSend).mockRejectedValue(new DocumentEgressBlockedError('hold_no_external', 'evt-1'));
    const res = await caller(U1).expressReviewLoop.run({ matterId: MATTER_A, documentId: DOC_A });
    expect(res.status).toBe('blocked');
    if (res.status === 'blocked') expect(res.reason).toBe('hold_no_external');
    // every broker call was allowlist-enforced (the one dispatch before it threw).
    const arg = vi.mocked(documentEgressSend).mock.calls[0]![0];
    expect(arg.enforceProviderAllowlist).toBe(true);
    expect(arg.surface).toBe('reviewer');
  });

  it('a clean run returns a NON-FINAL candidate + ledger + escalations; nothing finalized/sent', async () => {
    // round 1: one locatable Class-A whitespace adopt; round 2: nothing -> converge.
    let call = 0;
    vi.mocked(documentEgressSend).mockImplementation(async () => {
      call += 1;
      if (call === 1) {
        return reviewerResult([
          { title: 'spacing', body: 'BEFORE: "is  a" AFTER: "is a" CLASS_A: whitespace_spacing', severity: 'minor' },
        ]);
      }
      return reviewerResult([]); // converge
    });
    const res = await caller(U1).expressReviewLoop.run({ matterId: MATTER_A, documentId: DOC_A, maxRounds: 3 });
    expect(res.status).toBe('completed');
    if (res.status === 'completed') {
      expect(res.isFinal).toBe(false); // NON-FINAL by construction
      expect(res.converged).toBe(true);
      // the adopted whitespace fix is reflected in the regenerated candidate.
      expect(res.candidate).toBe(PLAIN.replace('is  a', 'is a'));
      expect(res.adopted.length).toBe(1);
      expect(Array.isArray(res.ledger)).toBe(true);
      expect(Array.isArray(res.escalations)).toBe(true);
    }
    // every broker call carried the allowlist enforcement + reviewer surface.
    for (const c of vi.mocked(documentEgressSend).mock.calls) {
      expect(c[0]!.enforceProviderAllowlist).toBe(true);
      expect(c[0]!.surface).toBe('reviewer');
    }
  });

  it('an UN-LOCATABLE suggestion is ESCALATED end-to-end (never auto-adopted) in a clean run', async () => {
    vi.mocked(documentEgressSend).mockImplementation(async () =>
      reviewerResult([
        { title: 'risky', body: 'Reword the whole thing (no anchor).', severity: 'major' },
      ]),
    );
    const res = await caller(U1).expressReviewLoop.run({ matterId: MATTER_A, documentId: DOC_A });
    expect(res.status).toBe('completed');
    if (res.status === 'completed') {
      expect(res.adopted.length).toBe(0); // nothing auto-adopted
      expect(res.escalations.length).toBe(1); // the un-locatable suggestion escalated
      expect(res.escalations[0]!.round).toBe(1);
    }
  });

  it('refuses an unsupported document type (no protected-span recognizer set) — fail-closed', async () => {
    vi.mocked(getDocumentById).mockResolvedValue({ id: DOC_A, matterId: MATTER_A, documentType: 'Durable_poa' } as unknown as DocumentRow);
    await expect(caller(U1).expressReviewLoop.run({ matterId: MATTER_A, documentId: DOC_A })).rejects.toThrow(
      /EXPRESS_UNSUPPORTED_DOCUMENT_TYPE/,
    );
    expect(vi.mocked(documentEgressSend)).not.toHaveBeenCalled();
  });

  it('refuses a document not in the matter (ownership) — NO broker call', async () => {
    vi.mocked(getDocumentById).mockResolvedValue({ id: DOC_A, matterId: 'ffffffff-ffff-ffff-ffff-ffffffffffff', documentType: 'deed' } as unknown as DocumentRow);
    await expect(caller(U1).expressReviewLoop.run({ matterId: MATTER_A, documentId: DOC_A })).rejects.toThrow(/Document not found/);
    expect(vi.mocked(documentEgressSend)).not.toHaveBeenCalled();
  });

  it('type-only sanity: adaptFeedbackToSuggestions maps a whole array', () => {
    const out = adaptFeedbackToSuggestions(
      [{ title: 't', body: 'BEFORE: "world" AFTER: "World" CLASS_A: casing_non_operative', severity: 'minor' }],
      'hello world',
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.beforeText).toBe('world');
  });
});
