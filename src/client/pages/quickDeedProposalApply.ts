/**
 * EXPRESS-FANOUT-1 — pure mappers from a category proposeIntake proposal onto the QuickDeedPage form-field
 * updates. SAFETY-BEARING BY CONSTRUCTION: each mapper reads ONLY that category's routine, attorney-confirmable
 * fields and produces ONLY form updates for those. There is NO path here that carries an attorney-verbatim
 * recital (seller-side `vestingRecital` / the "BEING" clause), the legal/property description, or any other
 * load-bearing verbatim field — so applying a proposal can never populate them, even if the model (or a rogue
 * payload) tried to smuggle one in. Pure + exported for direct testing.
 */

/** The seller-side proposal shape the server proposes (structurally matches the tRPC-inferred result). */
export interface SellerProposalInput {
  grantees?: { name: string; relationship?: string }[];
  warrantyType?: string;
  consideration?: string;
}

/** The seller-side form fields a proposal may pre-fill — buyer grantees, warranty, price (figures). NEVER the
 *  vesting recital, tenancy words, or the legal description. */
export interface SellerFormFields {
  grantees?: { name: string; descriptor: string }[];
  warrantyType?: string;
  considerationFigs?: string;
}

export function sellerProposalToFields(p: SellerProposalInput): SellerFormFields {
  const out: SellerFormFields = {};
  if (p.grantees && p.grantees.length > 0) {
    out.grantees = p.grantees.map((g) => ({ name: g.name, descriptor: g.relationship ?? '' }));
  }
  if (p.warrantyType) out.warrantyType = p.warrantyType;
  if (p.consideration) out.considerationFigs = p.consideration;
  return out;
}

// ── Deed INTO an LLC ────────────────────────────────────────────────────────────────────────────────────────

/** The into-LLC proposal shape (bare grantee LLC name — designator appended server-side). */
export interface IntoLlcProposalInput {
  granteeLlc?: string;
  grantors?: { name: string }[];
  consideration?: string;
}

/** The into-LLC form fields a proposal may pre-fill. NEVER the derivation, subject-to, notary, or legal. */
export interface IntoLlcFormFields {
  granteeLlc?: string;
  grantors?: { name: string; maritalStatus: string }[];
  consideration?: string;
}

export function intoLlcProposalToFields(p: IntoLlcProposalInput): IntoLlcFormFields {
  const out: IntoLlcFormFields = {};
  if (p.granteeLlc) out.granteeLlc = p.granteeLlc;
  if (p.grantors && p.grantors.length > 0) {
    // Marital status is an attorney field (defaults 'unmarried'); the model never proposes it.
    out.grantors = p.grantors.map((g) => ({ name: g.name, maritalStatus: 'unmarried' }));
  }
  if (p.consideration) out.consideration = p.consideration;
  return out;
}

// ── Deed OUT OF an LLC ──────────────────────────────────────────────────────────────────────────────────────

export interface OutOfLlcProposalInput {
  members?: { name: string }[];
  consideration?: string;
  fileNumber?: string;
  executionMonth?: string;
  executionYear?: string;
}
export interface OutOfLlcFormFields {
  members?: { name: string; signatureTitle: string }[];
  consideration?: string;
  fileNumber?: string;
  executionMonth?: string;
  executionYear?: string;
}
export function outOfLlcProposalToFields(p: OutOfLlcProposalInput): OutOfLlcFormFields {
  const out: OutOfLlcFormFields = {};
  if (p.members && p.members.length > 0) out.members = p.members.map((m) => ({ name: m.name, signatureTitle: '' }));
  if (p.consideration) out.consideration = p.consideration;
  if (p.fileNumber) out.fileNumber = p.fileNumber;
  if (p.executionMonth) out.executionMonth = p.executionMonth;
  if (p.executionYear) out.executionYear = p.executionYear;
  // NEVER: the return-to block, notary locality, derivation-instrument number, or legal description.
  return out;
}

// ── Transfer-on-Death ───────────────────────────────────────────────────────────────────────────────────────

export interface TodProposalInput {
  beneficiaries?: { name: string; relationship?: string }[];
  vesting?: string;
}
export interface TodFormFields {
  persons?: string[];
  beneficiaryVesting?: string;
}
export function todProposalToFields(p: TodProposalInput): TodFormFields {
  const out: TodFormFields = {};
  const names = (p.beneficiaries ?? []).map((b) => b.name).filter((n) => n.trim().length > 0);
  if (names.length > 0) out.persons = names;
  if (p.vesting) out.beneficiaryVesting = p.vesting;
  // NEVER: the revocation block, the transferor's capacity, the being/derivation recital, or legal.
  return out;
}

// ── Deed of Confirmation ────────────────────────────────────────────────────────────────────────────────────

export interface ConfirmationProposalInput {
  archetype?: string;
}
export interface ConfirmationFormFields {
  archetype?: 'C1-a-survivorship' | 'C1-b-testate-devise';
}
const CONFIRMATION_ARCHETYPES = new Set(['C1-a-survivorship', 'C1-b-testate-devise']);
export function confirmationProposalToFields(p: ConfirmationProposalInput): ConfirmationFormFields {
  const out: ConfirmationFormFields = {};
  if (p.archetype && CONFIRMATION_ARCHETYPES.has(p.archetype)) {
    out.archetype = p.archetype as 'C1-a-survivorship' | 'C1-b-testate-devise';
  }
  // NEVER any chain-of-title fact — the entire chain is attorney-entered.
  return out;
}

// ── Deed Into Trust ─────────────────────────────────────────────────────────────────────────────────────────

export interface IntoTrustProposalInput {
  exemplar?: string;
  grantors?: { name: string }[];
  grantorMaritalStatus?: string;
  heldAs?: string;
  trustStructure?: string;
}
export interface IntoTrustFormFields {
  exemplar?: 'A' | 'B' | 'C';
  grantors?: string[];
  grantorMaritalStatus?: string;
  heldAs?: string;
  trustStructure?: string;
}
const INTO_TRUST_EXEMPLARS = new Set(['A', 'B', 'C']);
export function intoTrustProposalToFields(p: IntoTrustProposalInput): IntoTrustFormFields {
  const out: IntoTrustFormFields = {};
  const ex = (p.exemplar ?? '').trim().toUpperCase();
  if (INTO_TRUST_EXEMPLARS.has(ex)) out.exemplar = ex as 'A' | 'B' | 'C';
  const names = (p.grantors ?? []).map((g) => g.name).filter((n) => n.trim().length > 0);
  if (names.length > 0) out.grantors = names;
  if (p.grantorMaritalStatus) out.grantorMaritalStatus = p.grantorMaritalStatus;
  if (p.heldAs) out.heldAs = p.heldAs;
  if (p.trustStructure) out.trustStructure = p.trustStructure;
  // CRITICAL — NEVER: the trusteesRecital (load-bearing, attorney-verbatim), being-recital, derivation, or legal.
  // There is deliberately no path in this mapper that reads or emits any of them.
  return out;
}
