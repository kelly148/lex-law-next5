/**
 * deedProposeIntakeCategories — EXPRESS-FANOUT-1: category-aware "describe the deal" parse configs.
 *
 * Extends the Gift Express `proposeIntake` (deedDraftAgent.ts) to the OTHER deed categories. Each
 * category exposes a schema + system prompt + validator that PROPOSES ONLY that category's routine,
 * irreducible intake fields for the attorney to CONFIRM — and NEVER the attorney-verbatim, load-bearing
 * fields. The legal/property description is EXTRACTION-ONLY everywhere; and per category the model must
 * never author: seller-side `vestingRecital`, TOD `revocationBlock`, Confirmation chain-of-title, and
 * Into-Trust `trusteesRecital` + `beingRecital` + derivation. Fail-closed: schema-invalid / low-confidence
 * / missing-required all collapse to `needs_clarification` (never a partial/guessed proposal). PROPOSE-ONLY:
 * these never draft, record, or send.
 *
 * Contract note (mirrors deedDraftAgent.validateProposeIntakeOutput): the egress broker returns
 * structured-output `content` as a STRING, so each validator coerces a JSON string to an object BEFORE
 * schema validation. `.strict()` rejects any model-authored forbidden field (a smuggled legal description
 * or a fabricated verbatim recital) -> needs_clarification, so the safety guard travels with the parse.
 */
import { z } from 'zod';

/** Coerce a structured-output content string (optionally markdown-fenced) to the JSON value it represents;
 *  returns null on non-JSON so schema validation fails closed. Same idiom as
 *  deedDraftAgent.tryParseProposeIntakeJson and expressPorts.coerceJson. */
export function coerceStructuredJson(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw;
  const stripped = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  try {
    return JSON.parse(stripped) as unknown;
  } catch {
    return null;
  }
}

/** Normalize a parsed grantee/party array into trimmed { name, relationship? } entries. */
function normalizeParties(
  raw: readonly { name?: string | null; relationship?: string | null }[],
): { name: string; relationship?: string }[] {
  return raw.map((g) => {
    const name = (g.name ?? '').trim();
    const r = (g.relationship ?? '').trim();
    return r === '' ? { name } : { name, relationship: r };
  });
}

// ── Seller-side conveyance ──────────────────────────────────────────────────────────────────────────────
//
// Routine (proposable): the grantee(s) (BUYERS), the warranty type (a closed set), the consideration (price).
// NEVER proposed: the legal/property description (extraction-only) and the `vestingRecital` (the BEING /
// authority-recital clause travels VERBATIM as attorney-supplied — deedSellerSideAssembler keeps it "exactly
// as supplied"). The grantor party is the current owner (from the prior deed / extraction), never the model.

/** The closed warranty set for a seller-side conveyance (matches the assembler's parameterized warranty). */
export const SELLER_WARRANTY_OPTIONS = new Set(['General Warranty', 'Special Warranty', 'Fiduciary']);

export interface ProposeSellerSideProposal {
  grantees: { name: string; relationship?: string }[];
  warrantyType?: string;
  consideration?: string;
}

export type ProposeSellerSideResult =
  | { status: 'proposed'; proposal: ProposeSellerSideProposal }
  | { status: 'needs_clarification'; questions: string[] };

export const ProposeSellerSideOutputSchema = z
  .object({
    grantees: z
      .array(
        z.object({
          name: z.string().max(200).nullable().optional(),
          relationship: z.string().max(200).nullable().optional(),
        }),
      )
      .max(20)
      .default([]),
    /** A stated warranty ONLY (validated against SELLER_WARRANTY_OPTIONS below); omitted otherwise. */
    warrantyType: z.string().max(200).nullable().optional(),
    /** The sale price EXACTLY as stated; omitted otherwise. */
    consideration: z.string().max(120).nullable().optional(),
    /** The model's own confidence gate — false ⇒ fail closed to needs_clarification. */
    confident: z.boolean().default(true),
    clarifyingQuestions: z.array(z.string().min(1).max(400)).max(20).default([]),
    // The model commonly ECHOES the grantor(s) even though the grantor is the current owner (extraction /
    // prior deed), never the model. Accept + IGNORE these benign extras so a normal parse does not fail.
    // .strict() is KEPT so a FORBIDDEN field (a model-authored legal description or vesting recital) is
    // still rejected -> needs_clarification.
    grantor: z.unknown().optional(),
    grantors: z.unknown().optional(),
  })
  .strict();

export function buildProposeSellerSideSystemPrompt(): string {
  return [
    "You are a deed-intake PARSER for a Virginia attorney handling a SELLER-SIDE (arm's-length sale) conveyance.",
    'The attorney has free-associated the facts of the deal in one text box. Extract ONLY the irreducible intake',
    'fields the attorney EXPLICITLY stated:',
    '  - grantees: the BUYER(s) — each a { name, relationship } where relationship is stated ONLY if the attorney',
    '    stated it.',
    '  - warrantyType: a warranty the attorney explicitly chose, one of exactly: General Warranty, Special Warranty,',
    '    Fiduciary. Omit it unless the attorney stated the warranty.',
    '  - consideration: the sale price EXACTLY as the attorney stated it (e.g. "$450,000.00"). Omit if not stated.',
    '',
    'HARD RULES:',
    '  - Do NOT author, paraphrase, infer, or emit any legal or property description. There is NO field for it; the',
    '    verbatim legal is taken from the uploaded documents only, never from you.',
    '  - Do NOT author, paraphrase, or infer the VESTING / AUTHORITY RECITAL (the "BEING …" derivation-of-title',
    '    clause). It is attorney-supplied VERBATIM; there is NO field for it.',
    '  - Do NOT invent, default, or guess ANY field. A field you are unsure about must be OMITTED, not filled.',
    '  - If anything load-bearing is ambiguous (who the buyers are, which warranty), set confident=false and put a',
    '    specific question in clarifyingQuestions. NEVER guess.',
    '  - You only PROPOSE the parse for the attorney to confirm. You never draft, record, file, or send anything.',
    'Return ONLY the structured object.',
  ].join('\n');
}

/** PURE: validate + normalize the model's seller-side structured output into a propose result. Fail-closed:
 *  schema-invalid, the model's own confident=false, a present-but-invalid warranty, or NO grantees all collapse
 *  to needs_clarification (NEVER a partial/default-filled proposal). Exported for direct (no-LLM) testing. */
export function validateProposeSellerSideOutput(raw: unknown): ProposeSellerSideResult {
  const parsed = ProposeSellerSideOutputSchema.safeParse(coerceStructuredJson(raw));
  if (!parsed.success) {
    return {
      status: 'needs_clarification',
      questions: ['I could not read the deal into the seller-side intake fields. Please confirm or fill the buyer(s), warranty, and price below.'],
    };
  }
  const out = parsed.data;
  const questions: string[] = [...out.clarifyingQuestions];
  let needsClarification = out.confident === false;

  const warranty = (out.warrantyType ?? '').trim();
  if (warranty !== '' && !SELLER_WARRANTY_OPTIONS.has(warranty)) {
    needsClarification = true;
    questions.push(
      `The stated warranty "${warranty}" is not a recognized option (${[...SELLER_WARRANTY_OPTIONS].join(', ')}). Which did you mean?`,
    );
  }

  const grantees = normalizeParties(out.grantees);
  if (grantees.length === 0) {
    needsClarification = true;
    questions.push('Who are the grantee(s) (the buyer(s)) of this conveyance?');
  } else if (grantees.some((g) => g.name === '')) {
    needsClarification = true;
    questions.push('One or more grantees were described without a name. What is the full legal name of each grantee?');
  }

  if (needsClarification) {
    return {
      status: 'needs_clarification',
      questions: questions.length > 0 ? questions : ['The seller-side intake is ambiguous; please clarify the buyer(s), warranty, and price.'],
    };
  }

  const proposal: ProposeSellerSideProposal = { grantees };
  if (warranty !== '') proposal.warrantyType = warranty;
  const consideration = (out.consideration ?? '').trim();
  if (consideration !== '') proposal.consideration = consideration;
  return { status: 'proposed', proposal };
}

// ── Deed INTO an LLC ────────────────────────────────────────────────────────────────────────────────────
//
// Routine (proposable): the grantee LLC's BARE legal name (the ", a Virginia Limited Liability Company"
// designator is appended server-side — the model must NOT add it), the consideration. The grantor(s) are the
// current individual owner(s) transferring in — auto-seeded from the prior deed, confirmed by the attorney;
// accepted as a proposal hint but never required from the model. NEVER proposed: the derivation-of-title, the
// notary jurisdiction, the subject-to block (attorney-supplied), and the legal description (extraction-only).

export interface ProposeIntoLlcProposal {
  granteeLlc?: string;
  grantors?: { name: string }[];
  consideration?: string;
}

export type ProposeIntoLlcResult =
  | { status: 'proposed'; proposal: ProposeIntoLlcProposal }
  | { status: 'needs_clarification'; questions: string[] };

export const ProposeIntoLlcOutputSchema = z
  .object({
    /** The grantee LLC's BARE legal name (WITHOUT the VA designator — appended server-side). */
    granteeLlc: z.string().max(300).nullable().optional(),
    grantors: z.array(z.object({ name: z.string().max(200).nullable().optional() })).max(20).default([]),
    consideration: z.string().max(120).nullable().optional(),
    confident: z.boolean().default(true),
    clarifyingQuestions: z.array(z.string().min(1).max(400)).max(20).default([]),
  })
  .strict();

export function buildProposeIntoLlcSystemPrompt(): string {
  return [
    'You are a deed-intake PARSER for a Virginia attorney conveying property INTO a Limited Liability Company.',
    'Extract ONLY the irreducible intake fields the attorney EXPLICITLY stated:',
    '  - granteeLlc: the LLC\'s legal name EXACTLY as stated but WITHOUT any entity designator — do NOT append',
    '    ", a Virginia Limited Liability Company" or "LLC"; the designator is added automatically.',
    '  - grantors: the current individual owner(s) transferring the property in — each { name } — ONLY if stated.',
    '  - consideration: the consideration EXACTLY as stated (often nominal, e.g. "$10.00"); omit if not stated.',
    'HARD RULES:',
    '  - Do NOT author, paraphrase, or infer any legal/property description, the DERIVATION-OF-TITLE clause, the',
    '    NOTARY jurisdiction, or any SUBJECT-TO block. Those are attorney-supplied / extraction-only; no field exists.',
    '  - Do NOT invent, default, or guess ANY field. Omit anything not explicitly stated.',
    '  - If the destination LLC is ambiguous, set confident=false with a specific clarifyingQuestions entry.',
    '  - You only PROPOSE the parse for the attorney to confirm. You never draft, record, file, or send anything.',
    'Return ONLY the structured object.',
  ].join('\n');
}

/** PURE: validate + normalize the Deed-INTO-LLC structured output. Fail-closed: schema-invalid, confident=false,
 *  or NO destination LLC named collapse to needs_clarification. Exported for direct (no-LLM) testing. */
export function validateProposeIntoLlcOutput(raw: unknown): ProposeIntoLlcResult {
  const parsed = ProposeIntoLlcOutputSchema.safeParse(coerceStructuredJson(raw));
  if (!parsed.success) {
    return {
      status: 'needs_clarification',
      questions: ['I could not read the deal into the into-LLC intake fields. Please confirm or fill the destination LLC and any grantor(s) below.'],
    };
  }
  const out = parsed.data;
  const questions: string[] = [...out.clarifyingQuestions];
  let needsClarification = out.confident === false;

  const granteeLlc = (out.granteeLlc ?? '').trim();
  if (granteeLlc === '') {
    needsClarification = true;
    questions.push('What is the name of the LLC the property is being conveyed INTO (the grantee)?');
  }

  const grantors = normalizeParties(out.grantors).filter((g) => g.name !== '');

  if (needsClarification) {
    return {
      status: 'needs_clarification',
      questions: questions.length > 0 ? questions : ['The into-LLC intake is ambiguous; please clarify the destination LLC.'],
    };
  }

  const proposal: ProposeIntoLlcProposal = { granteeLlc };
  if (grantors.length > 0) proposal.grantors = grantors.map((g) => ({ name: g.name }));
  const consideration = (out.consideration ?? '').trim();
  if (consideration !== '') proposal.consideration = consideration;
  return { status: 'proposed', proposal };
}

// ── Deed OUT OF an LLC ──────────────────────────────────────────────────────────────────────────────────
//
// Routine (proposable): the signing member(s) of the grantor LLC (names — signatureTitle defaults to "Member"),
// the consideration, the file number, and the execution month/year. The grantor LLC name defaults from the
// extracted LLC facts. NEVER proposed: the notary locality, the derivation-instrument number, the return-to
// block (attorney-supplied verbatim), and the legal description (extraction-only).

export interface ProposeOutOfLlcProposal {
  members?: { name: string }[];
  consideration?: string;
  fileNumber?: string;
  executionMonth?: string;
  executionYear?: string;
}

export type ProposeOutOfLlcResult =
  | { status: 'proposed'; proposal: ProposeOutOfLlcProposal }
  | { status: 'needs_clarification'; questions: string[] };

export const ProposeOutOfLlcOutputSchema = z
  .object({
    members: z.array(z.object({ name: z.string().max(200).nullable().optional() })).max(20).default([]),
    consideration: z.string().max(120).nullable().optional(),
    fileNumber: z.string().max(120).nullable().optional(),
    executionMonth: z.string().max(60).nullable().optional(),
    executionYear: z.string().max(20).nullable().optional(),
    confident: z.boolean().default(true),
    clarifyingQuestions: z.array(z.string().min(1).max(400)).max(20).default([]),
    // The grantor LLC name is extraction-derived; a benign echo is accepted + ignored.
    grantorLlc: z.unknown().optional(),
  })
  .strict();

export function buildProposeOutOfLlcSystemPrompt(): string {
  return [
    'You are a deed-intake PARSER for a Virginia attorney conveying property OUT OF a Limited Liability Company.',
    'Extract ONLY the irreducible intake fields the attorney EXPLICITLY stated:',
    '  - members: the LLC member(s) who will SIGN for the grantor LLC — each { name } — ONLY if stated.',
    '  - consideration: the consideration EXACTLY as stated; omit if not stated.',
    '  - fileNumber: the file/matter number ONLY if stated.',
    '  - executionMonth / executionYear: the execution month and year ONLY if stated.',
    'HARD RULES:',
    '  - Do NOT author, paraphrase, or infer any legal/property description, the NOTARY locality, the',
    '    DERIVATION-instrument number, or the RETURN-TO block. Those are attorney-supplied / extraction-only.',
    '  - Do NOT invent, default, or guess ANY field. Omit anything not explicitly stated.',
    '  - If the signing members are ambiguous, set confident=false with a specific clarifyingQuestions entry.',
    '  - You only PROPOSE the parse for the attorney to confirm. You never draft, record, file, or send anything.',
    'Return ONLY the structured object.',
  ].join('\n');
}

/** PURE: validate + normalize the Deed-OUT-OF-LLC structured output. Fail-closed: schema-invalid or
 *  confident=false collapse to needs_clarification. The member set may also come from extracted LLC facts, so
 *  an empty member proposal is allowed (the extractor/attorney supplies it). Exported for direct testing. */
export function validateProposeOutOfLlcOutput(raw: unknown): ProposeOutOfLlcResult {
  const parsed = ProposeOutOfLlcOutputSchema.safeParse(coerceStructuredJson(raw));
  if (!parsed.success) {
    return {
      status: 'needs_clarification',
      questions: ['I could not read the deal into the out-of-LLC intake fields. Please confirm or fill the signing member(s) and details below.'],
    };
  }
  const out = parsed.data;
  if (out.confident === false) {
    return {
      status: 'needs_clarification',
      questions: out.clarifyingQuestions.length > 0 ? out.clarifyingQuestions : ['The out-of-LLC intake is ambiguous; please clarify the signing member(s).'],
    };
  }
  const members = normalizeParties(out.members).filter((g) => g.name !== '');

  const proposal: ProposeOutOfLlcProposal = {};
  if (members.length > 0) proposal.members = members.map((g) => ({ name: g.name }));
  const consideration = (out.consideration ?? '').trim();
  if (consideration !== '') proposal.consideration = consideration;
  const fileNumber = (out.fileNumber ?? '').trim();
  if (fileNumber !== '') proposal.fileNumber = fileNumber;
  const executionMonth = (out.executionMonth ?? '').trim();
  if (executionMonth !== '') proposal.executionMonth = executionMonth;
  const executionYear = (out.executionYear ?? '').trim();
  if (executionYear !== '') proposal.executionYear = executionYear;
  return { status: 'proposed', proposal };
}
