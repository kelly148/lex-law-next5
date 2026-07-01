/**
 * deed_quick_intake_l2.test.ts — DEED-DRAFT-AGENT-1 Quick Deed LAYER 2 (E3): AI FREE-ASSOCIATE INTAKE.
 *
 * The ONE LLM step on the deed track: quickDeed.proposeIntake PARSES the attorney's free-text deal into ONLY
 * the irreducible intake fields and PROPOSES them for confirmation. It NEVER generates, persists, records, or
 * sends, and NEVER authors a legal/property description. The LLM call runs through the EXISTING egress control
 * plane (documentEgressSend), which is MOCKED here so NO real LLM call happens.
 *
 * Two layers: (1) the PURE validateProposeIntakeOutput helper (fail-closed normalization + the VA_VESTING_OPTIONS
 * check, no schema for a legal field); (2) the proposeIntake procedure via a tRPC caller with the egress + DB/gate
 * leaves mocked — asserting the egress params (surface 'intake', a matter subject, enforceProviderAllowlist true),
 * the propose/needs-clarification branching, the flag-OFF gate, and that generate/persist are NEVER reached.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Request, Response } from 'express';

// ── mock the egress broker (so NO real LLM call happens) + the DB/gate leaves the gate touches ──
vi.mock('../egress/documentEgress.js', () => {
  class DocumentEgressBlockedError extends Error {
    readonly blockReason: string;
    readonly egressEventId: string;
    constructor(blockReason: string, egressEventId: string) {
      super(`DOCUMENT_EGRESS_BLOCKED: ${blockReason}`);
      this.blockReason = blockReason;
      this.egressEventId = egressEventId;
    }
  }
  return { documentEgressSend: vi.fn(), DocumentEgressBlockedError };
});
vi.mock('../db/queries/matters.js', () => ({ getMatterById: vi.fn(), insertMatter: vi.fn() }));
vi.mock('../db/queries/materials.js', () => ({ listMaterialsForMatter: vi.fn() }));
vi.mock('../db/queries/documents.js', () => ({
  insertDocument: vi.fn(),
  updateDocumentCurrentVersion: vi.fn(),
  updateDocumentNotes: vi.fn(),
  getDocumentById: vi.fn(),
}));
vi.mock('../db/queries/versions.js', () => ({
  getNextVersionNumber: vi.fn(),
  insertVersion: vi.fn(),
  getLatestVersionForDocument: vi.fn(),
}));
vi.mock('../db/queries/conflictPolicy.js', () => ({ getFirmConflictPolicy: vi.fn(), setFirmConflictPolicy: vi.fn() }));

import {
  quickDeedRouter,
  validateProposeIntakeOutput,
  ProposeIntakeOutputSchema,
  buildProposeIntakeSystemPrompt,
} from '../procedures/deedDraftAgent.js';
import { documentEgressSend, DocumentEgressBlockedError } from '../egress/documentEgress.js';
import { LlmProviderError } from '../llm/types.js';
import { ProposeSellerSideOutputSchema, ProposeIntoLlcOutputSchema } from '../deed/deedProposeIntakeCategories.js';
import { getMatterById } from '../db/queries/matters.js';
import { insertDocument } from '../db/queries/documents.js';
import { insertVersion } from '../db/queries/versions.js';

const U1 = '11111111-1111-1111-1111-111111111111';
const M1 = '22222222-2222-2222-2222-222222222222';
const caller = () => quickDeedRouter.createCaller({ req: {} as Request, res: {} as Response, userId: U1 });

const egressMock = documentEgressSend as unknown as ReturnType<typeof vi.fn>;
/** Make documentEgressSend return a model "structured output" (the LlmGenerateResult.content). */
function mockModelOutput(content: unknown) {
  egressMock.mockResolvedValue({ content, tokensPrompt: 1, tokensCompletion: 1, providerMetadata: {} });
}

// ── pure helper: validateProposeIntakeOutput (fail-closed normalization + VA vesting check) ──────────────────

describe('validateProposeIntakeOutput (pure: fail-closed normalization)', () => {
  it('a well-formed proposal normalizes to status:proposed with the irreducible fields', () => {
    const r = validateProposeIntakeOutput({
      grantees: [{ name: 'Hannah R. Ellison', relationship: "the Grantors' daughter" }],
      granteesAreMarriedCouple: false,
      vestingOverride: 'sole_owner',
      fileNumber: '36-2026-7777',
      derivationReference: 'in Deed Book 5500 at Page 12',
      locality: 'Prince William County',
      confident: true,
      clarifyingQuestions: [],
    });
    expect(r.status).toBe('proposed');
    if (r.status !== 'proposed') throw new Error('expected proposed');
    expect(r.proposal.grantees).toEqual([{ name: 'Hannah R. Ellison', relationship: "the Grantors' daughter" }]);
    expect(r.proposal.granteesAreMarriedCouple).toBe(false);
    expect(r.proposal.vestingOverride).toBe('sole_owner');
    expect(r.proposal.overrides).toEqual({
      fileNumber: '36-2026-7777',
      derivationReference: 'in Deed Book 5500 at Page 12',
      locality: 'Prince William County',
    });
  });

  it('the proposal carries NO legal-description / property-description field', () => {
    const r = validateProposeIntakeOutput({ grantees: [{ name: 'A' }], confident: true });
    expect(r.status).toBe('proposed');
    if (r.status !== 'proposed') throw new Error('expected proposed');
    const keys = Object.keys(r.proposal);
    expect(keys).not.toContain('legalDescription');
    expect(keys).not.toContain('propertyDescription');
    expect(keys).not.toContain('legal');
    // overrides also carries no legal/property slot
    expect(Object.keys(r.proposal.overrides)).not.toContain('legalDescription');
  });

  it('low confidence (model confident=false) → needs_clarification, NO proposal', () => {
    const r = validateProposeIntakeOutput({
      grantees: [{ name: 'Jordan' }],
      confident: false,
      clarifyingQuestions: ['Which Jordan — Jordan Lee or Jordan Pak?'],
    });
    expect(r.status).toBe('needs_clarification');
    if (r.status !== 'needs_clarification') throw new Error('expected needs_clarification');
    expect(r.questions).toContain('Which Jordan — Jordan Lee or Jordan Pak?');
    expect(r).not.toHaveProperty('proposal');
  });

  it('a vestingOverride that is NOT a VA_VESTING_OPTIONS key → needs_clarification (never passed through)', () => {
    const r = validateProposeIntakeOutput({
      grantees: [{ name: 'Hannah R. Ellison' }],
      vestingOverride: 'community_property', // not a VA key
      confident: true,
    });
    expect(r.status).toBe('needs_clarification');
    if (r.status !== 'needs_clarification') throw new Error('expected needs_clarification');
    expect(r.questions.join(' ')).toMatch(/not a recognized Virginia vesting option/i);
  });

  it('no donees → needs_clarification (a gift deed needs at least one grantee; never default-filled)', () => {
    const r = validateProposeIntakeOutput({ grantees: [], confident: true });
    expect(r.status).toBe('needs_clarification');
  });

  it('a schema-invalid model output (extra field / wrong type) → needs_clarification', () => {
    expect(validateProposeIntakeOutput({ grantees: [{ name: 'A' }], legalDescription: 'Lot 1...' }).status).toBe(
      'needs_clarification',
    );
    expect(validateProposeIntakeOutput({ grantees: 'not-an-array' }).status).toBe('needs_clarification');
    expect(validateProposeIntakeOutput(null).status).toBe('needs_clarification');
  });

  // PROPOSE-INTAKE-PARSE-FIX-1 — the egress broker returns structured-output `content` as a STRING
  // (llm/anthropic.ts normalizes to `content: string`). validateProposeIntakeOutput must coerce that
  // JSON string to an object before schema validation; before the fix, safeParse(<string>) failed on
  // EVERY valid response and surfaced the misleading "could not be parsed" notice on a clean deal.
  it('PARSE-FIX: a JSON STRING (the broker content shape) parses to status:proposed', () => {
    const payload = JSON.stringify({
      grantees: [{ name: 'Hannah R. Ellison', relationship: "the Grantors' daughter" }],
      confident: true,
    });
    const r = validateProposeIntakeOutput(payload);
    expect(r.status).toBe('proposed');
    if (r.status !== 'proposed') throw new Error('expected proposed');
    expect(r.proposal.grantees).toEqual([{ name: 'Hannah R. Ellison', relationship: "the Grantors' daughter" }]);
  });

  it('PARSE-FIX: a markdown-fenced JSON string still parses (fence-stripped) → proposed', () => {
    const payload = '```json\n' + JSON.stringify({ grantees: [{ name: 'A' }], confident: true }) + '\n```';
    expect(validateProposeIntakeOutput(payload).status).toBe('proposed');
  });

  it('PARSE-FIX: a non-JSON string fails closed → needs_clarification (never a guessed proposal)', () => {
    expect(validateProposeIntakeOutput('the donee is my daughter').status).toBe('needs_clarification');
  });

  it('PARSE-FIX: .strict() still enforced through the string path — a model-authored legal description is rejected', () => {
    const payload = JSON.stringify({ grantees: [{ name: 'A' }], legalDescription: 'Lot 1, being...', confident: true });
    expect(validateProposeIntakeOutput(payload).status).toBe('needs_clarification');
  });

  // ── LIVE-6 (live UAT 2026-06-26): align with the model contract, never a raw Zod dump ──
  it('LIVE-6: a donee left UNNAMED (null name) → needs_clarification (fill-the-gap), never a thrown error', () => {
    const r = validateProposeIntakeOutput({ grantees: [{ name: null, relationship: 'my kid' }], confident: true });
    expect(r.status).toBe('needs_clarification');
    if (r.status !== 'needs_clarification') throw new Error('expected needs_clarification');
    expect(r.questions.join(' ')).toMatch(/without a name|full legal name/i);
  });

  it('LIVE-6: an extra "grantor" key the model echoes is accepted + IGNORED (the proposal still maps the grantee)', () => {
    const r = validateProposeIntakeOutput({
      grantees: [{ name: 'Hannah Okonkwo', relationship: 'his daughter' }],
      grantor: 'Daniel Okonkwo',
      vestingOverride: 'sole_owner',
      confident: true,
    });
    expect(r.status).toBe('proposed');
    if (r.status !== 'proposed') throw new Error('expected proposed');
    expect(r.proposal.grantees).toEqual([{ name: 'Hannah Okonkwo', relationship: 'his daughter' }]);
    expect(r.proposal).not.toHaveProperty('grantor');
    expect(r.proposal.vestingOverride).toBe('sole_owner');
  });

  it('LIVE-6: the SCHEMA accepts a null name + an extra grantor, but STILL rejects a model-authored legal (safety)', () => {
    expect(ProposeIntakeOutputSchema.safeParse({ grantees: [{ name: null }], grantor: 'D', confident: true }).success).toBe(true);
    expect(ProposeIntakeOutputSchema.safeParse({ grantees: [{ name: 'A' }], legalDescription: 'Lot 1, ...' }).success).toBe(false);
  });
});

describe('ProposeIntakeOutputSchema — the structured-output contract carries NO legal-description field', () => {
  it('has no legal/property-description property in its shape', () => {
    // The Zod object shape is the source of truth for what the model may emit.
    const shape = (ProposeIntakeOutputSchema as unknown as { shape: Record<string, unknown> }).shape;
    const keys = Object.keys(shape);
    expect(keys).not.toContain('legalDescription');
    expect(keys).not.toContain('propertyDescription');
    expect(keys).not.toContain('legal');
    expect(keys).toContain('grantees');
    expect(keys).toContain('vestingOverride');
  });

  it('the system prompt forbids authoring a legal description and tells the model to ask when ambiguous', () => {
    const sys = buildProposeIntakeSystemPrompt();
    expect(sys).toMatch(/do NOT author/i);
    expect(sys).toMatch(/legal description/i);
    expect(sys).toMatch(/NEVER guess/i);
  });
});

// ── procedure: gates + egress params + propose/clarify branching ─────────────────────────────────────────────

describe('quickDeed.proposeIntake — gates, egress params, propose-only', () => {
  const origDeed = process.env['DEED_DRAFT_AGENT_ENABLED'];

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env['DEED_DRAFT_AGENT_ENABLED'];
    (getMatterById as ReturnType<typeof vi.fn>).mockResolvedValue({ id: M1, userId: U1, archivedAt: null });
  });
  afterEach(() => {
    if (origDeed === undefined) delete process.env['DEED_DRAFT_AGENT_ENABLED'];
    else process.env['DEED_DRAFT_AGENT_ENABLED'] = origDeed;
  });

  const FREE_TEXT = 'Gift from Marcus and Priya Ellison to their daughter Hannah; she takes as sole owner.';

  it('flag OFF → DEED_DRAFT_AGENT_DISABLED; NO egress call', async () => {
    await expect(caller().proposeIntake({ matterId: M1, freeText: FREE_TEXT })).rejects.toThrow(
      /DEED_DRAFT_AGENT_DISABLED/,
    );
    expect(documentEgressSend).not.toHaveBeenCalled();
  });

  it('happy path: a well-formed model proposal → status:proposed; egress called with surface intake + allowlist + matter subject', async () => {
    process.env['DEED_DRAFT_AGENT_ENABLED'] = 'true';
    mockModelOutput({
      grantees: [{ name: 'Hannah R. Ellison', relationship: "the Grantors' daughter" }],
      vestingOverride: 'sole_owner',
      confident: true,
    });

    const res = await caller().proposeIntake({ matterId: M1, freeText: FREE_TEXT });

    expect(res.status).toBe('proposed');
    if (res.status !== 'proposed') throw new Error('expected proposed');
    expect(res.proposal.grantees[0]?.name).toBe('Hannah R. Ellison');
    expect(res.proposal.vestingOverride).toBe('sole_owner');

    // the egress params: surface 'intake', a matter subject, enforceProviderAllowlist truthy
    const params = egressMock.mock.calls[0]?.[0];
    expect(params.surface).toBe('intake');
    expect(params.subject.type).toBe('matter');
    expect(params.subject.subjectId).toBe(M1);
    expect(params.subject.matterId).toBe(M1);
    expect(params.subject.userId).toBe(U1);
    expect(params.enforceProviderAllowlist).toBe(true);
    expect(params.modelString).toBeTruthy();
    // store-by-reference: the payload is the prompt bundle (hashed by the plane), not stored raw here
    expect(typeof params.serializedPayload).toBe('string');
    // the structured-output schema is the propose-intake contract (no legal field)
    expect(params.llmParams.structuredOutputSchema).toBe(ProposeIntakeOutputSchema);

    // PROPOSE-ONLY: nothing was generated or persisted
    expect(insertDocument).not.toHaveBeenCalled();
    expect(insertVersion).not.toHaveBeenCalled();
  });

  it('an ambiguous (low-confidence) model output → needs_clarification; NO proposal; nothing persisted', async () => {
    process.env['DEED_DRAFT_AGENT_ENABLED'] = 'true';
    mockModelOutput({
      grantees: [{ name: 'Jordan' }],
      confident: false,
      clarifyingQuestions: ['Which Jordan did you mean?'],
    });

    const res = await caller().proposeIntake({ matterId: M1, freeText: 'Gift to Jordan.' });
    expect(res.status).toBe('needs_clarification');
    if (res.status !== 'needs_clarification') throw new Error('expected needs_clarification');
    expect(res.questions).toContain('Which Jordan did you mean?');
    expect(res).not.toHaveProperty('proposal');
    expect(insertDocument).not.toHaveBeenCalled();
    expect(insertVersion).not.toHaveBeenCalled();
  });

  it('a schema-invalid model output → needs_clarification; nothing persisted', async () => {
    process.env['DEED_DRAFT_AGENT_ENABLED'] = 'true';
    mockModelOutput({ grantees: 'oops', legalDescription: 'Lot 1, ...' });
    const res = await caller().proposeIntake({ matterId: M1, freeText: FREE_TEXT });
    expect(res.status).toBe('needs_clarification');
    expect(insertVersion).not.toHaveBeenCalled();
  });

  it('an invalid vestingOverride from the model is rejected to needs_clarification (never passed through)', async () => {
    process.env['DEED_DRAFT_AGENT_ENABLED'] = 'true';
    mockModelOutput({ grantees: [{ name: 'Hannah R. Ellison' }], vestingOverride: 'joint_bananas', confident: true });
    const res = await caller().proposeIntake({ matterId: M1, freeText: FREE_TEXT });
    expect(res.status).toBe('needs_clarification');
  });

  it('a DocumentEgressBlockedError from the broker → a clean blocked result, NO proposal', async () => {
    process.env['DEED_DRAFT_AGENT_ENABLED'] = 'true';
    egressMock.mockRejectedValue(new DocumentEgressBlockedError('hold_no_external', 'evt-1'));
    const res = await caller().proposeIntake({ matterId: M1, freeText: FREE_TEXT });
    expect(res.status).toBe('blocked');
    if (res.status !== 'blocked') throw new Error('expected blocked');
    expect(res.reason).toBe('hold_no_external');
    expect(res).not.toHaveProperty('proposal');
    expect(insertDocument).not.toHaveBeenCalled();
    expect(insertVersion).not.toHaveBeenCalled();
  });

  it('LIVE-6: a model output with a null donee name → needs_clarification end-to-end (no throw, nothing persisted)', async () => {
    process.env['DEED_DRAFT_AGENT_ENABLED'] = 'true';
    mockModelOutput({ grantees: [{ name: null, relationship: 'my kid' }], confident: true });
    const res = await caller().proposeIntake({ matterId: M1, freeText: 'add my kid' });
    expect(res.status).toBe('needs_clarification');
    expect(insertVersion).not.toHaveBeenCalled();
  });

  it('LIVE-6: a structured-output parse_error from the broker → needs_clarification (never a raw Zod dump)', async () => {
    process.env['DEED_DRAFT_AGENT_ENABLED'] = 'true';
    egressMock.mockRejectedValue(new LlmProviderError('parse_error', 'structured output failed Zod validation: invalid_type'));
    const res = await caller().proposeIntake({ matterId: M1, freeText: FREE_TEXT });
    expect(res.status).toBe('needs_clarification');
    if (res.status !== 'needs_clarification') throw new Error('expected needs_clarification');
    expect(res).not.toHaveProperty('proposal');
    expect(insertDocument).not.toHaveBeenCalled();
    expect(insertVersion).not.toHaveBeenCalled();
  });
});

// ── EXPRESS-FANOUT-1: seller-side proposeIntake procedure (category-aware dispatch + gates + blocked/parse) ──

describe('quickDeed.proposeIntakeSellerSide — category-aware dispatch, gates, propose-only', () => {
  const origDeed = process.env['DEED_DRAFT_AGENT_ENABLED'];

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env['DEED_DRAFT_AGENT_ENABLED'];
    (getMatterById as ReturnType<typeof vi.fn>).mockResolvedValue({ id: M1, userId: U1, archivedAt: null });
  });
  afterEach(() => {
    if (origDeed === undefined) delete process.env['DEED_DRAFT_AGENT_ENABLED'];
    else process.env['DEED_DRAFT_AGENT_ENABLED'] = origDeed;
  });

  const SELLER_TEXT = 'Sale to Marcus and Renee Bell for $450,000, general warranty.';

  it('flag OFF → DEED_DRAFT_AGENT_DISABLED; NO egress call', async () => {
    await expect(caller().proposeIntakeSellerSide({ matterId: M1, freeText: SELLER_TEXT })).rejects.toThrow(
      /DEED_DRAFT_AGENT_DISABLED/,
    );
    expect(documentEgressSend).not.toHaveBeenCalled();
  });

  it('happy path → proposed; egress uses surface intake + allowlist + the SELLER-SIDE schema (not gift)', async () => {
    process.env['DEED_DRAFT_AGENT_ENABLED'] = 'true';
    mockModelOutput({
      grantees: [{ name: 'Marcus T. Bell' }, { name: 'Renee Bell' }],
      warrantyType: 'General Warranty',
      consideration: '$450,000.00',
      confident: true,
    });
    const res = await caller().proposeIntakeSellerSide({ matterId: M1, freeText: SELLER_TEXT });
    expect(res.status).toBe('proposed');
    if (res.status !== 'proposed') throw new Error('expected proposed');
    expect(res.proposal.grantees[0]?.name).toBe('Marcus T. Bell');
    expect(res.proposal.warrantyType).toBe('General Warranty');
    const params = egressMock.mock.calls[0]?.[0];
    expect(params.surface).toBe('intake');
    expect(params.subject.type).toBe('matter');
    expect(params.subject.userId).toBe(U1);
    expect(params.enforceProviderAllowlist).toBe(true);
    // the dispatch used the SELLER-SIDE structured-output contract, not the gift one
    expect(params.llmParams.structuredOutputSchema).toBe(ProposeSellerSideOutputSchema);
    expect(insertDocument).not.toHaveBeenCalled();
    expect(insertVersion).not.toHaveBeenCalled();
  });

  it('CONTRACT: a STRING model output (the broker content shape) still → proposed', async () => {
    process.env['DEED_DRAFT_AGENT_ENABLED'] = 'true';
    mockModelOutput(JSON.stringify({ grantees: [{ name: 'A. Buyer' }], confident: true }));
    const res = await caller().proposeIntakeSellerSide({ matterId: M1, freeText: SELLER_TEXT });
    expect(res.status).toBe('proposed');
  });

  it('a DocumentEgressBlockedError from the broker → clean blocked result, nothing persisted', async () => {
    process.env['DEED_DRAFT_AGENT_ENABLED'] = 'true';
    egressMock.mockRejectedValue(new DocumentEgressBlockedError('provider_not_allowlisted', 'evt-2'));
    const res = await caller().proposeIntakeSellerSide({ matterId: M1, freeText: SELLER_TEXT });
    expect(res.status).toBe('blocked');
    if (res.status !== 'blocked') throw new Error('expected blocked');
    expect(res.reason).toBe('provider_not_allowlisted');
    expect(insertVersion).not.toHaveBeenCalled();
  });

  it('a structured-output parse_error → needs_clarification (never a raw Zod dump)', async () => {
    process.env['DEED_DRAFT_AGENT_ENABLED'] = 'true';
    egressMock.mockRejectedValue(new LlmProviderError('parse_error', 'bad shape'));
    const res = await caller().proposeIntakeSellerSide({ matterId: M1, freeText: SELLER_TEXT });
    expect(res.status).toBe('needs_clarification');
    expect(insertVersion).not.toHaveBeenCalled();
  });

  it('SAFETY: a model-authored vestingRecital is rejected end-to-end → needs_clarification, nothing persisted', async () => {
    process.env['DEED_DRAFT_AGENT_ENABLED'] = 'true';
    mockModelOutput({ grantees: [{ name: 'A. Buyer' }], vestingRecital: 'BEING the same property conveyed...', confident: true });
    const res = await caller().proposeIntakeSellerSide({ matterId: M1, freeText: SELLER_TEXT });
    expect(res.status).toBe('needs_clarification');
    expect(insertVersion).not.toHaveBeenCalled();
  });
});

describe('quickDeed.proposeIntakeIntoLlc — category-aware dispatch, gates, propose-only', () => {
  const origDeed = process.env['DEED_DRAFT_AGENT_ENABLED'];

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env['DEED_DRAFT_AGENT_ENABLED'];
    (getMatterById as ReturnType<typeof vi.fn>).mockResolvedValue({ id: M1, userId: U1, archivedAt: null });
  });
  afterEach(() => {
    if (origDeed === undefined) delete process.env['DEED_DRAFT_AGENT_ENABLED'];
    else process.env['DEED_DRAFT_AGENT_ENABLED'] = origDeed;
  });

  const LLC_TEXT = 'Dana Ortiz is transferring her home into Ridgeline Holdings LLC for $10.';

  it('happy path → proposed with the bare LLC name; egress uses the INTO-LLC schema (not gift/seller)', async () => {
    process.env['DEED_DRAFT_AGENT_ENABLED'] = 'true';
    mockModelOutput({ granteeLlc: 'Ridgeline Holdings', grantors: [{ name: 'Dana Ortiz' }], consideration: '$10.00', confident: true });
    const res = await caller().proposeIntakeIntoLlc({ matterId: M1, freeText: LLC_TEXT });
    expect(res.status).toBe('proposed');
    if (res.status !== 'proposed') throw new Error('expected proposed');
    expect(res.proposal.granteeLlc).toBe('Ridgeline Holdings');
    expect(egressMock.mock.calls[0]?.[0].llmParams.structuredOutputSchema).toBe(ProposeIntoLlcOutputSchema);
    expect(insertVersion).not.toHaveBeenCalled();
  });

  it('no destination LLC named → needs_clarification', async () => {
    process.env['DEED_DRAFT_AGENT_ENABLED'] = 'true';
    mockModelOutput({ grantors: [{ name: 'Dana Ortiz' }], confident: true });
    const res = await caller().proposeIntakeIntoLlc({ matterId: M1, freeText: LLC_TEXT });
    expect(res.status).toBe('needs_clarification');
  });

  it('a DocumentEgressBlockedError → clean blocked result, nothing persisted', async () => {
    process.env['DEED_DRAFT_AGENT_ENABLED'] = 'true';
    egressMock.mockRejectedValue(new DocumentEgressBlockedError('provider_not_allowlisted', 'evt-3'));
    const res = await caller().proposeIntakeIntoLlc({ matterId: M1, freeText: LLC_TEXT });
    expect(res.status).toBe('blocked');
    expect(insertVersion).not.toHaveBeenCalled();
  });

  it('SAFETY: a model-authored derivation/legal is rejected end-to-end → needs_clarification', async () => {
    process.env['DEED_DRAFT_AGENT_ENABLED'] = 'true';
    mockModelOutput({ granteeLlc: 'Acme', derivationOfTitle: 'For derivation, see Deed Book...', confident: true });
    const res = await caller().proposeIntakeIntoLlc({ matterId: M1, freeText: LLC_TEXT });
    expect(res.status).toBe('needs_clarification');
    expect(insertVersion).not.toHaveBeenCalled();
  });
});
