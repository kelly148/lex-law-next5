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
