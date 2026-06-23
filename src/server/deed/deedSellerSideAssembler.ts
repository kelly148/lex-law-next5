/**
 * deedSellerSideAssembler.ts — DEED-DRAFT-AGENT-1: DETERMINISTIC house-style SELLER-SIDE deed assembler.
 *
 * PURE + deterministic + NO-EGRESS — NO LLM anywhere. Takes a §2.1.2 source-field set (the structured facts a
 * caller has already extracted/reconciled) and renders the Mason seller-side deed body per the §2.1.1 skeleton
 * (DEED_KB_SEED §2.1). Output is an UNEXECUTED draft (date/notary blank) that is then run through the
 * recordability gates (deedDraftGates C1/C2/B6 + format) — it never bypasses them, never finalizes/records/sends.
 *
 * Rides the parent DEED-DRAFT-AGENT-1 FIRE disposition; honors every §2.1 ruling:
 *  - LEGAL DESCRIPTION VERBATIM — inserted exactly as given; never paraphrased. A truncated legal (lost its
 *    closing boundary) is WITHHELD and fail-closed (NEG-6) — never emitted as a false "verbatim" into C1.
 *  - NO FABRICATED FACTS — the assembler renders only what it is given; it never invents a party, fee, or cite.
 *  - WARRANTY parameterized — `warrantyType` defaults to "General Warranty" (FIRE-B1; override-able to Special/
 *    Fiduciary, which conforms the granting clause; the authority recital travels verbatim in `vestingRecital`).
 *  - B2 FAIL-CLOSED ESTATE SCOPE — the estate branch renders ONLY the grounded path (testate + qualified
 *    fiduciary + express power of sale + estate-as-seller). Any other estate pattern refuses + escalates.
 *  - STRUCTURED NAME FIELDS — capacity / a/k/a / "formerly of record as" / labels are SEPARATE fields and are
 *    composed into the clause; a name field that smuggles them in is rejected fail-closed (NEG-4).
 *
 * The body uses NO markdown (no hash/asterisk/pipe/bracket): a fact-complete deed passes the B6 annotation-leak
 * floor (deedDraftGates.checkAnnotationLeak); a stray marker/markup char fails it. Execution fields (date,
 * notary, signature lines) intentionally remain blank underscores — a draft is not executed; underscores
 * legitimately pass B6.
 *
 * STATUS: flag-dark Phase-1 infrastructure (release-gate domino #6). Consumes a PROVIDED field set; wiring to
 * the live ingest (OCR-B1) + the gate run is domino #7 (gated). NOT imported by any live agent/UI path.
 */

import {
  checkAnnotationLeak,
  checkFormatLints,
  type GateResult,
} from './deedDraftGates.js';

/** Mason house default warranty for a taxable seller-side conveyance (FIRE-B1; override-able to Special/Fiduciary). */
export const DEFAULT_SELLER_WARRANTY = 'General Warranty';

/** Signature/execution rule line — a draft is unexecuted, so these stay blank. Underscores pass B6. */
const SIG_LINE = '______________________________';

/** A party on the seller-side deed. Identity composition is STRUCTURED — capacity / variants / formerly-of-record
 *  / descriptor are separate fields composed into the clause, never baked into `name` (NEG-4 fail-closed). */
export interface SellerSidePartyInput {
  /** Full current legal name exactly as it should print (NO label/capacity/aka/newline — those are separate). */
  name: string;
  /** Per-member descriptor placed verbatim after the name ("unmarried"). Distinct from a group descriptor. */
  descriptor?: string | undefined;
  /** Grantor name-change: renders ", formerly of record as <X>" in the clause (B4 — attorney-corroborated). */
  formerlyOfRecord?: string | undefined;
  /** a/k/a variants (e.g. a fiduciary's name variants); those differing from `name` render ", a/k/a <v>". */
  variants?: string[] | undefined;
  /** Fiduciary capacity, full form "Executor of Estate of <decedent>" — present ONLY on an estate grantor. */
  capacity?: string | undefined;
}

export type SellerType = 'individual' | 'estate';

/** The §2.1.2 source-field set the assembler renders. A caller (domino #7) supplies these after extraction +
 *  reconciliation; here they are provided directly. */
export interface SellerSideDeedInput {
  /** Granting-clause warranty; default "General Warranty" (FIRE-B1). */
  warrantyType?: string | undefined;
  fileNumber: string;
  granteeAddress: string;
  titleInsurer: string;
  taxId: string;
  /** Consideration figures, "$438,000.00" — prints in the header AND as the granting-clause amount figures. */
  considerationFigs: string;
  /** Consideration in words for the granting clause, "FOUR HUNDRED THIRTY EIGHT THOUSAND AND 00/100". */
  amountWords: string;
  assessedValue: string;
  grantors: SellerSidePartyInput[];
  /** Group descriptor placed after the joined grantor set ("a married couple"). */
  grantorDescriptor?: string | undefined;
  grantees: SellerSidePartyInput[];
  /** Group descriptor placed after the joined grantee set ("a married couple"). */
  granteeDescriptor?: string | undefined;
  /** Tenancy phrase verbatim ("as sole owner" | "as tenants by the entirety with the full common law right of
   *  survivorship"). Inserted as given. */
  tenancy: string;
  /** Recording locality WITHOUT the trailing "County" (the template appends " County"). */
  county: string;
  /** Legal description, VERBATIM (multi-line preserved). */
  legalDescription: string;
  /** "BEING the same property…" vesting/derivation recital, VERBATIM (carries any estate-authority recital). */
  vestingRecital: string;
  /** Notary venue line ("CITY OF ALEXANDRIA" | "COUNTY OF FAIRFAX"). */
  venue: string;
  returnTo: string;
  /** 'estate' renders the fiduciary signature block + requires the grounded B2 branch; default 'individual'.
   *  When omitted, inferred 'estate' iff a grantor carries `capacity`. */
  sellerType?: SellerType | undefined;
  /** Estate branch hard gate (B2): the express power of sale. Required true for the estate branch to render. */
  powerOfSale?: boolean | undefined;
}

/** Structured rendered components — exposed for EXACT (non-substring) targeted assertions. */
export interface SellerSideDeedParts {
  headerBlock: string;
  /** "by and between <grantors>, (the "Grantor[s]"), and <grantees>, (the "Grantee[s]")," */
  partiesClause: string;
  /** The full "For and in consideration…to wit:" granting clause. */
  grantingClause: string;
  tenancy: string;
  /** The legal description exactly as supplied (=== input.legalDescription). */
  legalBlock: string;
  /** The vesting recital exactly as supplied (=== input.vestingRecital). */
  vestingRecital: string;
  /** The signature block (individual lines, or the estate "The Estate of …/By:" form). */
  signatureBlock: string;
  /** "COMMONWEALTH OF VIRGINIA\n<venue>" */
  venueBlock: string;
  venue: string;
  /** The notary "…subscribed and sworn…by <signers>." */
  signers: string;
  grantorLabel: 'Grantor' | 'Grantors';
  granteeLabel: 'Grantee' | 'Grantees';
}

export interface SellerSideDeedDraft {
  /** true when a hard gate (NEG-4 name bleed, NEG-6 truncated legal, or the B2 estate scope) blocked emission. */
  failedClosed: boolean;
  /** Why it failed closed (empty when ok). */
  failures: string[];
  /** The assembled deed body (plain text). '' when failedClosed. */
  text: string;
  /** Structured parts for exact assertions. null when failedClosed. */
  parts: SellerSideDeedParts | null;
  sellerType: SellerType;
  warranty: string;
  /** The B6 annotation-leak verdict over the assembled body (the recordability floor). */
  b6: GateResult;
  /** The format/typo-lint verdict over the assembled body. */
  format: GateResult;
  /** true only when emission succeeded AND the body passes B6 + format (the text-only recordability floor; C1/C2
   *  reconciliation are run by the caller with the commitment + prior-deed sources — domino #7). */
  recordableFloorOk: boolean;
  notes: string[];
  warnings: string[];
}

// ── normalization (local; mirrors deedDraftGates for the a/k/a self-equality test) ──
function normName(s: string): string {
  return s.replace(/\s+/g, ' ').trim().toLowerCase().replace(/[.,]+$/, '');
}

/** NEG-4: a name field must be a bare name — never a label, capacity, variant/alias join, or multi-party run.
 *  Case-insensitive, word-bounded; covers the corpus fiduciary/agency roles (not just Executor/Administrator),
 *  any a/k/a · f/k/a · n/k/a alias, a parenthesized party label, and a bare " and " co-party run. A real bare
 *  legal name never contains a parenthesis, an alias slash-token, or a standalone "and"/capacity word, so this
 *  is fail-closed-safe; a coincidental surname match escalates to human review (the safe direction). */
export const NAME_BLEED_RE =
  /[()]|[afn]\/k\/a|\b(co-?)?(execut(or|rix)|administrat(or|rix)|trustee|attorney-in-fact|personal\s+representative|guardian|conservator)\b|\bestate\s+of\b|\btrust\b|\band\b|\n/i;

/** NEG-6: a legal description that lost its closing boundary (no recordable terminus, or ends on a dangling
 *  connective/article) must be WITHHELD — emitting it would feed C1 a false "verbatim". A recordable legal ends
 *  in a sentence period (optionally a closing quote/bracket) OR a closing parenthesis (metes-and-bounds
 *  parentheticals) — anything else reads mid-clause. */
function isLegalTruncated(legal: string): boolean {
  const t = legal.trim();
  if (t === '') return true;
  if (!/(?:[.]["')\]]?|\))\s*$/.test(t)) return true; // no recordable terminus -> mid-clause
  // Even with a terminus, a dangling connective/article immediately before it signals a lost tail
  // (e.g. "…recorded thereto among the." with an OCR-appended period).
  const core = t.replace(/(?:[.]["')\]]?|\))\s*$/, '').trim();
  if (/\b(among|in|of|to|the|and|a|an|at|on|with|by|as|for)$/i.test(core)) return true;
  return false;
}

/** Render one party member: name + ", formerly of record as X" + ", a/k/a V" (variants ≠ name) + ", capacity"
 *  + ", descriptor". The group descriptor is applied by renderPartySet, not here. */
function renderPartyMember(p: SellerSidePartyInput): string {
  let s = p.name.trim();
  const formerly = (p.formerlyOfRecord ?? '').trim();
  if (formerly) s += `, formerly of record as ${formerly}`;
  const akas = (p.variants ?? [])
    .map((v) => v.trim())
    .filter((v) => v !== '' && normName(v) !== normName(p.name));
  for (const a of akas) s += `, a/k/a ${a}`;
  const capacity = (p.capacity ?? '').trim();
  if (capacity) s += `, ${capacity}`;
  const descriptor = (p.descriptor ?? '').trim();
  if (descriptor) s += `, ${descriptor}`;
  return s;
}

function renderPartySet(members: SellerSidePartyInput[], groupDescriptor?: string): string {
  let s = members.map(renderPartyMember).join(' and ');
  const gd = (groupDescriptor ?? '').trim();
  if (gd) s += `, ${gd}`;
  return s;
}

/** The signer rendering for the notary clause: individuals sign as their bare name; a fiduciary signs in the
 *  full capacity (name + a/k/a + "Executor of Estate of …"). No descriptor. */
function renderSigner(p: SellerSidePartyInput, isEstate: boolean): string {
  if (!isEstate) return p.name.trim();
  let s = p.name.trim();
  const akas = (p.variants ?? []).map((v) => v.trim()).filter((v) => v !== '' && normName(v) !== normName(p.name));
  for (const a of akas) s += `, a/k/a ${a}`;
  const capacity = (p.capacity ?? '').trim();
  if (capacity) s += `, ${capacity}`;
  return s;
}

/** Parse a grounded fiduciary capacity "Executor of [the] Estate of <decedent>" -> { role, estateName }.
 *  Returns null if it is not the grounded executor/administrator-with-an-estate form (-> fail closed). */
function parseFiduciaryCapacity(capacity: string): { role: string; estateName: string } | null {
  const m = capacity.trim().match(/^(?<role>[A-Za-z][A-Za-z\s-]*?)\s+of\s+(?:the\s+)?Estate\s+of\s+(?<estate>.+)$/i);
  if (!m || !m.groups) return null;
  const role = (m.groups['role'] ?? '').trim();
  const estateName = (m.groups['estate'] ?? '').trim();
  if (role === '' || estateName === '') return null;
  return { role, estateName };
}

/**
 * PURE: deterministically assemble the Mason seller-side deed body from a §2.1.2 field set. Never throws.
 * Fails closed (no body emitted) on a smuggled name field (NEG-4), a truncated legal (NEG-6), or a non-grounded
 * estate pattern (B2). The verbatim legal + vesting recital are inserted exactly.
 */
export function assembleSellerSideDeed(input: SellerSideDeedInput): SellerSideDeedDraft {
  const failures: string[] = [];
  const notes: string[] = [];
  const warnings: string[] = [];

  const warranty = (input.warrantyType ?? '').trim() || DEFAULT_SELLER_WARRANTY;
  // A present fiduciary `capacity` ALWAYS routes through the estate B2 gate — an explicit sellerType:'individual'
  // can NOT suppress it (that would convey estate property as an individual deed with no power-of-sale/testate
  // check, signed personally, the capacity bleeding into the parties clause). Capacity is the load-bearing signal.
  const hasFiduciaryCapacity = input.grantors.some((g) => (g.capacity ?? '').trim() !== '');
  const isEstate: boolean = input.sellerType === 'estate' || hasFiduciaryCapacity;
  const sellerType: SellerType = isEstate ? 'estate' : 'individual';

  const failClosed = (): SellerSideDeedDraft => ({
    failedClosed: true,
    failures,
    text: '',
    parts: null,
    sellerType,
    warranty,
    b6: { gate: 'B6', ok: false, failures: ['not assembled — fail-closed'] },
    format: { gate: 'format', ok: false, failures: ['not assembled — fail-closed'] },
    recordableFloorOk: false,
    notes,
    warnings,
  });

  // ── NEG-4: structured name fields. A name must never carry a label/capacity/variant-run/newline. ──
  for (const p of [...input.grantors, ...input.grantees]) {
    if (NAME_BLEED_RE.test(p.name)) {
      failures.push(`name-field bleed: a party name carries a label/capacity/variant run ("${p.name.trim()}") — capacity, a/k/a, "formerly of record as" and the party label are separate fields`);
    }
  }

  // ── basic presence ──
  if (input.grantors.length === 0) failures.push('no grantor provided');
  if (input.grantees.length === 0) failures.push('no grantee provided');

  // ── B2 estate scope (fail-closed beyond the grounded path) ──
  let estateName = '';
  let estateRole = '';
  if (isEstate) {
    if (input.grantors.length !== 1) {
      failures.push('estate branch: exactly one fiduciary grantor is supported in the grounded path');
    }
    if (input.powerOfSale !== true) {
      failures.push('B2 fail-closed: estate-as-seller requires an express power of sale (power_of_sale: true) — refuse + escalate');
    }
    const cap = (input.grantors[0]?.capacity ?? '').trim();
    const parsed = cap ? parseFiduciaryCapacity(cap) : null;
    if (!parsed) {
      failures.push('B2 fail-closed: the fiduciary capacity is not the grounded "Executor of Estate of <decedent>" form — refuse + escalate');
    } else if (!/^(co-)?execut(or|rix)$/i.test(parsed.role)) {
      failures.push(`B2 fail-closed: a non-executor fiduciary ("${parsed.role}") signals intestate/other administration — outside the grounded testate scope; refuse + escalate`);
    } else if (NAME_BLEED_RE.test(parsed.estateName)) {
      failures.push(`B2 fail-closed: the decedent/estate name parsed from the capacity ("${parsed.estateName}") carries a label/connective/markup token — malformed capacity; refuse + escalate`);
    } else {
      estateRole = parsed.role;
      estateName = parsed.estateName;
    }
  }

  // ── NEG-6: truncated legal description (withhold; never emit a false verbatim) ──
  if (isLegalTruncated(input.legalDescription)) {
    failures.push('legal description appears truncated (no terminal boundary) — WITHHELD; paste it verbatim/complete from the source before emission');
  }

  if (failures.length > 0) return failClosed();

  // ── parties ──
  const grantorLabel: 'Grantor' | 'Grantors' = input.grantors.length > 1 ? 'Grantors' : 'Grantor';
  const granteeLabel: 'Grantee' | 'Grantees' = input.grantees.length > 1 ? 'Grantees' : 'Grantee';
  const grantorActor = input.grantors.length > 1 ? 'Grantors do' : 'Grantor does';

  const grantorClause = renderPartySet(input.grantors, input.grantorDescriptor);
  const granteeClause = renderPartySet(input.grantees, input.granteeDescriptor);
  const partiesClause = `by and between ${grantorClause}, (the "${grantorLabel}"), and ${granteeClause}, (the "${granteeLabel}"),`;

  // ── header ──
  const headerBlock = [
    'Prepared by: Kelly Satterwhite, Esq. VSB# 91049',
    'The Mason Law Firm, PLC',
    `File Number: ${input.fileNumber}`,
    `Grantee's Address: ${input.granteeAddress}`,
    `Title Insurer: ${input.titleInsurer}`,
    `Tax I.D. Number: ${input.taxId}`,
    `Consideration: ${input.considerationFigs}`,
    `Assessed Value: ${input.assessedValue}`,
  ].join('\n');

  // ── granting clause (§2.1.1, verbatim Mason boilerplate) ──
  // Defensive: the contract is to pass the locality WITHOUT the trailing "County"; strip it if a caller includes
  // it, so the template's " County" suffix never doubles to "County County".
  const county = input.county.replace(/\s*,?\s*County\s*$/i, '').trim();
  const grantingClause =
    `For and in consideration of the sum of ${input.amountWords} DOLLARS (${input.considerationFigs}), ` +
    'and other good and valuable consideration, the receipt and sufficiency of which are hereby acknowledged, ' +
    `the ${grantorActor} hereby grant, bargain, sell and convey, with ${warranty} and English Covenants of title, ` +
    `unto the said ${granteeLabel}, in fee simple, ${input.tenancy}, all of the following parcel of real property, ` +
    `with improvements thereon, located in ${county} County, Commonwealth of Virginia, to wit:`;

  // ── signature block ──
  let signatureBlock: string;
  if (isEstate) {
    const g = input.grantors[0]!;
    let signerRoleLine = g.name.trim();
    const akas = (g.variants ?? []).map((v) => v.trim()).filter((v) => v !== '' && normName(v) !== normName(g.name));
    for (const a of akas) signerRoleLine += `, a/k/a ${a}`;
    signerRoleLine += `, ${estateRole}`;
    signatureBlock = `The Estate of ${estateName}\n\nBy:${SIG_LINE}\n     ${signerRoleLine}`;
  } else {
    signatureBlock = input.grantors.map((g) => `${SIG_LINE}\n${g.name.trim()}`).join('\n\n');
  }

  const venueBlock = `COMMONWEALTH OF VIRGINIA\n${input.venue}`;
  const signers = input.grantors.map((g) => renderSigner(g, isEstate)).join(' and ');

  // ── notes (facts the attorney confirms — not the Inc-2 advisory layer) ──
  if (warranty !== DEFAULT_SELLER_WARRANTY) {
    notes.push(`Warranty override applied: "${warranty}" (FIRE-B1). Confirm the authority recital in the vesting/derivation block conforms (warranty limited to acts by, through, or under the fiduciary/decedent only, where applicable).`);
  }
  if (isEstate) {
    notes.push(`Estate branch (grounded B2 path): ${estateRole} of the Estate of ${estateName}, express power of sale confirmed. Any other estate fact pattern (no power of sale, intestate, closed/distributed, co/successor/non-qualified PR) is out of scope and fails closed.`);
  }

  // ── assemble the body (§2.1.1 skeleton order; plain text, no markdown) ──
  const text = [
    headerBlock,
    `THIS DEED, made this _____ day of ____________, 20___, ${partiesClause}`,
    'Witnesseth, that:',
    grantingClause,
    input.legalDescription,
    input.vestingRecital,
    'This conveyance is made subject to covenants, conditions, restrictions, easements and rights of way of record.',
    'WITNESS the following signatures and seals:',
    signatureBlock,
    venueBlock,
    `The foregoing instrument was subscribed and sworn before me this _____ day of ____________, 20___, by ${signers}.`,
    `${SIG_LINE}\nNotary Public's signature\nNotary registration number: ______________\nMy commission expires:\nAfter recording return to:\n${input.returnTo}`,
  ].join('\n\n');

  // ── recordability floor (text-only gates; C1/C2 reconciliation are the caller's, domino #7) ──
  const b6 = checkAnnotationLeak(text);
  const format = checkFormatLints(text);
  const recordableFloorOk = b6.ok && format.ok;
  if (!b6.ok) warnings.push(`annotation_leak_in_body:${b6.failures.length}`);
  if (!format.ok) warnings.push(`format_lint_in_body:${format.failures.length}`);

  const parts: SellerSideDeedParts = {
    headerBlock,
    partiesClause,
    grantingClause,
    tenancy: input.tenancy,
    legalBlock: input.legalDescription,
    vestingRecital: input.vestingRecital,
    signatureBlock,
    venueBlock,
    venue: input.venue,
    signers,
    grantorLabel,
    granteeLabel,
  };

  return {
    failedClosed: false,
    failures: [],
    text,
    parts,
    sellerType,
    warranty,
    b6,
    format,
    recordableFloorOk,
    notes,
    warnings,
  };
}
