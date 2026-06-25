/**
 * deed_into_trust_assembler.test.ts — DEED-DRAFT-AGENT-1 category C2 (Deed Into Trust) acceptance bar.
 *
 * NON-CIRCULAR: the GOLDEN inputs + expected deed bodies are READ from the committed, operator-authored fixture
 * pack (docs/deed/DEED_CAT_INTO_TRUST_fixture_pack.md) — the assembler must reproduce them byte-for-byte
 * (`toBe`). NEG fixtures must FAIL CLOSED ({ status: 'WITHHELD', flags, no deed }). The FIRE-watch guard cases
 * (missing trustees recital, divorce-recital incomplete, truncated legal, mis-placed §55.1-136(C) note) mutate a
 * valid GOLD base. Synthetic data only (PII-free pack). A Deed Into Trust transfers to the grantors-as-trustees
 * of their revocable living trust(s).
 *
 * Variant archetypes: Exemplar-A (GOLDEN-1 married -> one joint trust, condo), Exemplar-C (GOLDEN-2 married ->
 * dual his-and-hers trusts, NELSON header), Exemplar-B (GOLDEN-3 divorced -> one spouse as trustee, both sign).
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import {
  assembleIntoTrustDeed,
  type DeedIntoTrustInput,
} from '../deed/deedIntoTrustAssembler.js';
import { DEED_TYPE_REGISTRY, getDeedType } from '../deed/deedTypeRegistry.js';
import { VA_EXEMPTIONS } from '../deed/deedKbVa.js';

const PACK = readFileSync(
  fileURLToPath(new URL('../../../docs/deed/DEED_CAT_INTO_TRUST_fixture_pack.md', import.meta.url)),
  'utf8',
);

/** Slice the section that begins at a "## <header>" line and ends at the next "## " (or EOF). */
function section(header: string): string {
  const i = PACK.indexOf(header);
  if (i < 0) throw new Error(`fixture section ${header} not found`);
  const rest = PACK.slice(i + header.length);
  const j = rest.indexOf('\n## ');
  return j < 0 ? rest : rest.slice(0, j);
}

/** Pull the ```json block from a GOLDEN-<n> section (the consolidated-facts INPUT). LF-pinned pack; `\r?\n`
 *  defensively so the parser is CRLF-tolerant on a Windows checkout. */
function grabGoldInput(n: number): Record<string, any> {
  const sec = section(`## GOLDEN-${n} `);
  const m = sec.match(/```json\r?\n([\s\S]*?)\r?\n```/);
  if (!m) throw new Error(`GOLDEN-${n} input JSON not found`);
  return JSON.parse(m[1]!) as Record<string, any>;
}

/** Pull the verbatim EXPECTED OUTPUT body (the plain ``` fence after "### EXPECTED") from a GOLDEN-<n> section. */
function grabGoldExpected(n: number): string {
  const sec = section(`## GOLDEN-${n} `);
  const k = sec.indexOf('### EXPECTED');
  if (k < 0) throw new Error(`GOLDEN-${n} EXPECTED header not found`);
  const m = sec.slice(k).match(/```\r?\n([\s\S]*?)\r?\n```/);
  if (!m) throw new Error(`GOLDEN-${n} expected body not found`);
  return m[1]!;
}

/** Pull the ```json block from a NEG-<n> section (the defect-injected facts). */
function grabNegInput(n: number): Record<string, any> {
  const sec = section(`### NEG-${n} `);
  const m = sec.match(/```json\r?\n([\s\S]*?)\r?\n```/);
  if (!m) throw new Error(`NEG-${n} input JSON not found`);
  return JSON.parse(m[1]!) as Record<string, any>;
}

/** Map a GOLD fixture's snake_case consolidated-facts JSON onto the assembler input (camelCase) + exemplar id. */
function toInput(j: Record<string, any>, exemplar: 'A' | 'B' | 'C'): DeedIntoTrustInput {
  const out: DeedIntoTrustInput = {
    exemplar,
    exemptionBasis: j.exemption_basis,
    titleSearchPerformed: j.title_search_performed,
    preparer: { name: j.preparer.name, vsb: j.preparer.vsb, firm: j.preparer.firm },
    taxId: j.tax_id,
    granteeReturnAddress: j.grantee_return_address,
    assessedValue: j.assessed_value,
    instrumentDate: { day: j.instrument_date.day, month: j.instrument_date.month, year: j.instrument_date.year },
    grantors: j.grantors,
    grantorMaritalStatus: j.grantor_marital_status,
    heldAs: j.held_as,
    trustStructure: j.trust_structure,
    trusteesRecital: j.trustees_recital,
    grantingVerb: j.granting_verb,
    jurisdictionSitus: j.jurisdiction_situs,
    legalDescription: j.legal_description,
    tbeImmunityNote: j.tbe_immunity_note,
    notaryJurisdiction: { type: j.notary_jurisdiction.type, name: j.notary_jurisdiction.name },
  };
  if (j.consideration !== undefined) out.consideration = j.consideration;
  if (j.file_number !== undefined) out.fileNumber = j.file_number;
  // GRANTEE-object plurality is required by the assembler (no silent default). GOLDEN-2 omits it in the pack body;
  // supply the explicit 'GRANTEES' value in the MAPPING (not the pack) so the GOLDEN-2 render is unchanged — a
  // married couple conveying to two trustees of dual trusts takes the plural party label.
  out.granteeObjectPlurality = j.grantee_object_plurality ?? 'GRANTEES';
  if (j.lce_identification_footnote !== undefined) out.lceIdentificationFootnote = j.lce_identification_footnote;
  if (j.derivation !== undefined) out.derivation = j.derivation;
  if (j.being_recital !== undefined) {
    out.beingRecital = {
      priorConveyance: j.being_recital.prior_conveyance,
      divorceOrder: j.being_recital.divorce_order,
      msa: j.being_recital.msa,
    };
  }
  if (j.return_block !== undefined) out.returnBlock = { lines: String(j.return_block).split('\n') };
  return out;
}

/** GOLDEN n -> exemplar template id (per the variant-axis map). */
const GOLD_EXEMPLAR: Record<number, 'A' | 'B' | 'C'> = { 1: 'A', 2: 'C', 3: 'B' };

describe('Into-Trust (C2) — fixture pack parsed', () => {
  it('parses the 3 GOLDEN inputs + expected bodies and the 4 NEG inputs', () => {
    for (const n of [1, 2, 3]) {
      expect(grabGoldInput(n)).toBeTruthy();
      expect(grabGoldExpected(n).length).toBeGreaterThan(500);
    }
    for (const n of [1, 2, 3, 4]) expect(grabNegInput(n)).toBeTruthy();
  });
});

describe('Into-Trust (C2) — GOLDEN fixtures reproduce the fixture pack exactly', () => {
  for (const n of [1, 2, 3]) {
    it(`GOLDEN-${n} — full body byte-for-byte + segment contract`, () => {
      const j = grabGoldInput(n);
      const result = assembleIntoTrustDeed(toInput(j, GOLD_EXEMPLAR[n]!));
      expect(result.status).toBe('OK');
      // S3 advisory recordability floor. GOLDEN-1 (the standard condo "*Reference to Parking Space(s)..."
      // footnote) and GOLDEN-2 (the §55.1-136(C) TBE-immunity "NOTE:") legitimately trip B6's `*` / `NOTE:`
      // denylist. recordableFloorOk is ADVISORY here (it never blocks emission) — a B6 refinement to allowlist
      // these statutory/condo constructs is operator-gated (surfaced). GOLDEN-3 (divorced SFH, no note) is clean.
      expect(result.recordableFloorOk).toBe(n === 3);
      expect(result.deed).toBeDefined();
      const d = result.deed!;

      // Strongest: the entire assembled document equals the fixture's EXPECTED block.
      expect(d.fullText).toBe(grabGoldExpected(n));

      // Per-segment exact-equality.
      expect(d.title).toBe('DEED INTO TRUST');
      expect(d.legalDescription).toBe(j.legal_description); // verbatim, casing preserved
      expect(d.considerationOpener).toBe(
        'for estate planning purposes, and other good and valuable consideration, the receipt and sufficiency of which are hereby acknowledged,',
      );
      // Full trustee-powers block, verbatim-complete — the single canonical standard clause.
      expect(d.trusteePowersBlock).toBe(
        `This conveyance is made to the Trustees to have and to hold the above described tract or parcel of land together with all rights, ways, privileges, and/or appurtenances thereto (the "Property"), IN TRUST, with the full power, right and authority to sell, lease, exchange, encumber and/or convey the Property, either in whole or in part, upon such terms and conditions and for such consideration as may, to the Trustees in the sole discretion of the Trustees, seem proper or advantageous.  The Trustees are hereby empowered and authorized to subdivide and resubdivide the Property, to dedicate such portions thereof for public use and the Trustees may deem desirable, and to grant licenses and/or easements for utility or other purposes across, over or under the Property.  The Trustees are also hereby empowered and authorized to execute, acknowledge and deliver such deeds, deeds of trust, leases, contracts, settlement statements and other instruments necessary to carry out the foregoing powers, and there shall be no obligation or liability upon any purchaser or lessee of the Property, or any part thereof, or upon any party dealing with the Trustees to inquire as to the terms of the Trust or the application and/or disposition of any proceeds or funds resulting from any transaction dealing with the Property.`,
      );

      // Cross-cutting non-reproduction: known real-corpus lint targets never appear in any GOLDEN output.
      expect(d.fullText).not.toContain('Zqxborn'); // genericized stray word
      expect(d.fullText).not.toContain('58-1-811'); // mis-punctuated cite
      expect(d.fullText).not.toContain('FairfaxCounty'); // missing-space corpus defect
    });
  }

  it('GOLDEN-1 (Exemplar-A) — quitclaim/release/convey; (A)(12) recital; Exemplar-A TBE note; condo footnote; GRANTEES', () => {
    const d = assembleIntoTrustDeed(toInput(grabGoldInput(1), 'A')).deed!;
    expect(d.exemptionLine).toBe('Exempt from recording tax pursuant to Sec 58.1-811(A)(12) 1950 Code of Virginia');
    expect(d.grantingVerb).toBe('quitclaim, release and convey');
    expect(d.granteeObject).toBe('GRANTEES');
    // §55.1-136(C) note in the Exemplar-A phrasing (note: NO terminal period).
    expect(d.tbeImmunityNote).toBe(
      'The GRANTORS herein wish to preserve the protection from creditors afforded to property held as tenants by the entirety pursuant to Virginia Code § 55.1-136(C). After this transfer, this property shall have the same immunity from the claims of their separate creditors as it would if it had remained a tenancy by the entirety',
    );
    // The derivation + immunity note ride the same paragraph.
    expect(d.derivationLine).toContain('Deed intended to be recorded immediately prior hereto');
    expect(d.derivationLine).toContain('pursuant to Virginia Code § 55.1-136(C)');
    expect(d.beingRecital).toBeNull();
    // The condo LCE identification footnote appears.
    expect(d.fullText).toContain('*Reference to Parking Space(s) and Storage Space(s) are for identification purposes only');
  });

  it('GOLDEN-2 (Exemplar-C) — grant/bargain/sell/convey; NELSON header; Exemplar-C TBE note; dual trustees; return block', () => {
    const d = assembleIntoTrustDeed(toInput(grabGoldInput(2), 'C')).deed!;
    expect(d.exemptionLine).toBe('EXEMPT FROM COUNTY AND STATE RECORDING TAXES PURSUANT TO VA CODE SECTION 58.1-811(A)(12)');
    expect(d.grantingVerb).toBe('grant, bargain, sell and convey');
    // §55.1-136(C) note in the Exemplar-C phrasing.
    expect(d.tbeImmunityNote).toBe(
      'NOTE: The Grantors herein wish to retain the same immunity from the claims of their separate creditors as they would if they had continued to hold the subject property as tenants by the entirety pursuant to VA Code Section 55.1-136(C).',
    );
    // Dual-trustees recital — both trusts named in the premise.
    expect(d.premise).toContain('THE MARGUERITE HELEN PRENDERGAST LIVING TRUST');
    expect(d.premise).toContain('THE DESMOND CARL PRENDERGAST LIVING TRUST');
    // The After-recording-return block is present.
    expect(d.fullText).toContain('After recording return to:');
    expect(d.fullText).toContain('Universal Title');
  });

  it('GOLDEN-3 (Exemplar-B) — divorced; BOTH (A)(15) and (A)(12); quitclaim; NO §55.1-136(C); divorce BEING recital; GRANTEE', () => {
    const d = assembleIntoTrustDeed(toInput(grabGoldInput(3), 'B')).deed!;
    expect(d.exemptionLine).toBe('Exempt from recording tax pursuant to Sec 58.1-811(A) (15) and (A)(12) 1950 Code of Virginia');
    expect(d.grantingVerb).toBe('quitclaim, release and convey');
    expect(d.granteeObject).toBe('GRANTEE'); // single-trustee -> singular object
    // No §55.1-136(C) note in the divorced case.
    expect(d.tbeImmunityNote).toBeNull();
    expect(d.fullText).not.toContain('55.1-136(C)');
    // The divorce BEING recital recites the prior conveyance, the divorce Order, and the MSA relinquishment.
    expect(d.beingRecital).toContain('BEING the same property conveyed unto');
    expect(d.beingRecital).toContain('were divorced, see Order dated April 22, 2026');
    expect(d.beingRecital).toContain("Pursuant to the Grantors' Marital Separation Agreement");
    expect(d.derivationLine).toBeNull();
  });

  it('granting verb selected per axis (exact phrase across the three GOLDs)', () => {
    expect(assembleIntoTrustDeed(toInput(grabGoldInput(1), 'A')).deed!.grantingVerb).toBe('quitclaim, release and convey');
    expect(assembleIntoTrustDeed(toInput(grabGoldInput(2), 'C')).deed!.grantingVerb).toBe('grant, bargain, sell and convey');
    expect(assembleIntoTrustDeed(toInput(grabGoldInput(3), 'B')).deed!.grantingVerb).toBe('quitclaim, release and convey');
  });

  it('the legal description is carried VERBATIM (character-for-character) in every GOLDEN', () => {
    for (const n of [1, 2, 3]) {
      const j = grabGoldInput(n);
      const d = assembleIntoTrustDeed(toInput(j, GOLD_EXEMPLAR[n]!)).deed!;
      expect(d.legalDescription).toBe(j.legal_description);
    }
  });
});

describe('Into-Trust (C2) — NEG fixtures fail closed (WITHHELD, exact flag, no deed)', () => {
  /** Build an assembler input for a (sparse) NEG fixture over a valid base of the right exemplar, so each NEG
   *  isolates exactly the defect it targets (a complete base would otherwise fail closed for other reasons). */
  function buildNeg1(): DeedIntoTrustInput {
    // NEG-1 — truncated condo legal over the Exemplar-A (condo) base.
    const base = toInput(grabGoldInput(1), 'A');
    const j = grabNegInput(1);
    return { ...base, legalDescription: j.legal_description };
  }
  function buildNeg2(): DeedIntoTrustInput {
    // NEG-2 — a stray "Zqxborn" token in a caller-supplied notary block, over the Exemplar-C base.
    const base = toInput(grabGoldInput(2), 'C');
    const j = grabNegInput(2);
    return { ...base, notaryBlockRaw: j.notary_block_raw, grantors: j.grantors };
  }
  function buildNeg3(): DeedIntoTrustInput {
    // NEG-3 — married/TBE -> trust with the §55.1-136(C) note OMITTED, over the Exemplar-A base.
    const base = toInput(grabGoldInput(1), 'A');
    const j = grabNegInput(3);
    return {
      ...base,
      grantorMaritalStatus: j.grantor_marital_status,
      heldAs: j.held_as,
      trustStructure: j.trust_structure,
      tbeImmunityNote: j.tbe_immunity_note, // null
    };
  }
  function buildNeg4(): DeedIntoTrustInput {
    // NEG-4 — a garbled/partial trustee-powers block, over the Exemplar-A base.
    const base = toInput(grabGoldInput(1), 'A');
    const j = grabNegInput(4);
    return { ...base, trusteePowersClauseRaw: j.trustee_powers_clause_raw };
  }

  it('NEG-1 — truncated condo legal -> WITHHELD + LEGAL_DESCRIPTION_TRUNCATED, no deed, no auto-completion', () => {
    const r = assembleIntoTrustDeed(buildNeg1());
    expect(r.status).toBe('WITHHELD');
    expect(r.flags).toContain('LEGAL_DESCRIPTION_TRUNCATED');
    expect(r.deed).toBeUndefined();
    // Never fabricates the missing storage-space ID / Declaration instrument number.
    expect(JSON.stringify(r)).not.toContain('storage space');
  });

  it('NEG-2 — stray "Zqxborn" token in the notary block -> FLAGGED + WITHHELD; "Zqxborn" NEVER reproduced', () => {
    const r = assembleIntoTrustDeed(buildNeg2());
    expect(r.flags).toContain('STRAY_TOKEN_IN_NOTARY_BLOCK');
    expect(r.status).toBe('WITHHELD');
    expect(r.deed).toBeUndefined();
    expect(JSON.stringify(r)).not.toContain('Zqxborn');
  });

  it('NEG-3 — married/TBE -> trust with §55.1-136(C) note missing -> WITHHELD + TBE_IMMUNITY_NOTE_REQUIRED, no deed', () => {
    const r = assembleIntoTrustDeed(buildNeg3());
    expect(r.status).toBe('WITHHELD');
    expect(r.flags).toContain('TBE_IMMUNITY_NOTE_REQUIRED');
    expect(r.deed).toBeUndefined();
  });

  it('NEG-4 — garbled/partial trustee-powers block -> WITHHELD + TRUSTEE_POWERS_CLAUSE_INCOMPLETE, no auto-complete', () => {
    const r = assembleIntoTrustDeed(buildNeg4());
    expect(r.status).toBe('WITHHELD');
    expect(r.flags).toContain('TRUSTEE_POWERS_CLAUSE_INCOMPLETE');
    expect(r.deed).toBeUndefined();
  });
});

describe('Into-Trust (C2) — FIRE-watch guards (deterministic surface-not-decide; fail closed, never fabricate)', () => {
  const baseA = (): DeedIntoTrustInput => toInput(grabGoldInput(1), 'A');
  const baseB = (): DeedIntoTrustInput => toInput(grabGoldInput(3), 'B');
  const baseC = (): DeedIntoTrustInput => toInput(grabGoldInput(2), 'C');

  it('missing/blank trustees recital -> WITHHELD + TRUSTEES_RECITAL_MISSING, no deed (trust identity is load-bearing)', () => {
    const r = assembleIntoTrustDeed({ ...baseA(), trusteesRecital: '   ' });
    expect(r.status).toBe('WITHHELD');
    expect(r.flags).toContain('TRUSTEES_RECITAL_MISSING');
    expect(r.deed).toBeUndefined();
  });

  it('placeholder trust name in the trustees recital -> WITHHELD + TRUSTEES_RECITAL_MISSING, never rendered as a fact', () => {
    const r = assembleIntoTrustDeed({ ...baseA(), trusteesRecital: 'Trustees of [[MISSING — trust name]]' });
    expect(r.status).toBe('WITHHELD');
    expect(r.flags).toContain('TRUSTEES_RECITAL_MISSING');
    expect(r.deed).toBeUndefined();
  });

  it('empty grantor set -> WITHHELD + GRANTOR_MISSING, no deed', () => {
    const r = assembleIntoTrustDeed({ ...baseA(), grantors: [] });
    expect(r.status).toBe('WITHHELD');
    expect(r.flags).toContain('GRANTOR_MISSING');
    expect(r.deed).toBeUndefined();
  });

  it('divorce variant with the divorce Order missing -> WITHHELD + DIVORCE_RECITAL_INCOMPLETE, never fabricate a divorce fact', () => {
    const b = baseB();
    const r = assembleIntoTrustDeed({ ...b, beingRecital: { ...b.beingRecital!, divorceOrder: '' } });
    expect(r.status).toBe('WITHHELD');
    expect(r.flags).toContain('DIVORCE_RECITAL_INCOMPLETE');
    expect(r.deed).toBeUndefined();
    // No fabricated Order/MSA leaks into the result.
    expect(JSON.stringify(r)).not.toContain('Marital Separation Agreement');
  });

  it('divorce variant with the MSA relinquishment missing -> WITHHELD + DIVORCE_RECITAL_INCOMPLETE', () => {
    const b = baseB();
    const r = assembleIntoTrustDeed({ ...b, beingRecital: { ...b.beingRecital!, msa: '   ' } });
    expect(r.status).toBe('WITHHELD');
    expect(r.flags).toContain('DIVORCE_RECITAL_INCOMPLETE');
    expect(r.deed).toBeUndefined();
  });

  it('a §55.1-136(C) note requested for a DIVORCED grantor set -> WITHHELD + TBE_IMMUNITY_NOTE_NOT_PERMITTED', () => {
    const r = assembleIntoTrustDeed({ ...baseB(), tbeImmunityNote: 'Exemplar-A' });
    expect(r.status).toBe('WITHHELD');
    expect(r.flags).toContain('TBE_IMMUNITY_NOTE_NOT_PERMITTED');
    expect(r.deed).toBeUndefined();
  });

  it('a married/TBE Exemplar-C with the §55.1-136(C) note omitted -> WITHHELD + TBE_IMMUNITY_NOTE_REQUIRED', () => {
    const r = assembleIntoTrustDeed({ ...baseC(), tbeImmunityNote: null });
    expect(r.status).toBe('WITHHELD');
    expect(r.flags).toContain('TBE_IMMUNITY_NOTE_REQUIRED');
    expect(r.deed).toBeUndefined();
  });

  it('truncated legal (condo cut mid-amendment, ends on a period) -> WITHHELD + LEGAL_DESCRIPTION_TRUNCATED', () => {
    const r = assembleIntoTrustDeed({
      ...baseA(),
      legalDescription:
        'Condominium Unit No. 204, THE CARNABY AT WIEHLE STATION Condominium, established by the Declaration recorded in Deed Book 2188 at Page 0451, and by First Amendment recorded in Deed Book 2201 at Page 0907.',
    });
    expect(r.status).toBe('WITHHELD');
    expect(r.flags).toContain('LEGAL_DESCRIPTION_TRUNCATED');
    expect(r.deed).toBeUndefined();
  });

  it('an unverified exemption basis -> WITHHELD + UNVERIFIED_EXEMPTION_CITE (no-hallucinated-cite guard)', () => {
    const r = assembleIntoTrustDeed({ ...baseA(), exemptionBasis: ['58.1-811(A)(99)'] });
    expect(r.status).toBe('WITHHELD');
    expect(r.flags).toContain('UNVERIFIED_EXEMPTION_CITE');
    expect(r.deed).toBeUndefined();
  });
});

describe('Into-Trust (C2) — adversarial hardening guards (4-lens review; additive fail-OPEN closures)', () => {
  const baseA = (): DeedIntoTrustInput => toInput(grabGoldInput(1), 'A');
  const baseB = (): DeedIntoTrustInput => toInput(grabGoldInput(3), 'B');
  const baseC = (): DeedIntoTrustInput => toInput(grabGoldInput(2), 'C');

  // Guard 1 — UNKNOWN_EXEMPLAR.
  it('an unknown exemplar value -> WITHHELD + UNKNOWN_EXEMPLAR (never silently renders A-style)', () => {
    const r = assembleIntoTrustDeed({ ...baseA(), exemplar: 'Z' as unknown as 'A' });
    expect(r.status).toBe('WITHHELD');
    expect(r.flags).toContain('UNKNOWN_EXEMPLAR');
    expect(r.deed).toBeUndefined();
  });

  // Guard 2 — exemption basis<->face coupling.
  it('an empty exemption basis -> WITHHELD + EXEMPTION_BASIS_MISSING (a FACE may only ride a supplied basis)', () => {
    const r = assembleIntoTrustDeed({ ...baseA(), exemptionBasis: [] });
    expect(r.status).toBe('WITHHELD');
    expect(r.flags).toContain('EXEMPTION_BASIS_MISSING');
    expect(r.deed).toBeUndefined();
  });

  it('exemplar A with a divorce-only basis ((A)(15)) -> WITHHELD + EXEMPTION_BASIS_EXEMPLAR_MISMATCH', () => {
    const r = assembleIntoTrustDeed({ ...baseA(), exemptionBasis: ['58.1-811(A)(15)'] });
    expect(r.status).toBe('WITHHELD');
    expect(r.flags).toContain('EXEMPTION_BASIS_EXEMPLAR_MISMATCH');
    expect(r.deed).toBeUndefined();
  });

  it('exemplar B with only (A)(12) (missing the divorce (A)(15) cite) -> WITHHELD + EXEMPTION_BASIS_EXEMPLAR_MISMATCH', () => {
    const r = assembleIntoTrustDeed({ ...baseB(), exemptionBasis: ['58.1-811(A)(12)'] });
    expect(r.status).toBe('WITHHELD');
    expect(r.flags).toContain('EXEMPTION_BASIS_EXEMPLAR_MISMATCH');
    expect(r.deed).toBeUndefined();
  });

  // Guard 3 — TBE-note detection robustness.
  it('married couple with an UNRECOGNIZED held-as + no note -> WITHHELD + TBE_IMMUNITY_NOTE_REQUIRED (no silent omit)', () => {
    const r = assembleIntoTrustDeed({ ...baseA(), heldAs: 'something_unrecognized', tbeImmunityNote: null });
    expect(r.status).toBe('WITHHELD');
    expect(r.flags).toContain('TBE_IMMUNITY_NOTE_REQUIRED');
    expect(r.deed).toBeUndefined();
  });

  it('married/TBE with an OUT-OF-SET note selector -> WITHHELD + TBE_IMMUNITY_NOTE_REQUIRED (closed selector set)', () => {
    const r = assembleIntoTrustDeed({ ...baseA(), tbeImmunityNote: 'Exemplar-Q' as unknown as 'Exemplar-A' });
    expect(r.status).toBe('WITHHELD');
    expect(r.flags).toContain('TBE_IMMUNITY_NOTE_REQUIRED');
    expect(r.deed).toBeUndefined();
  });

  it('a hyphen/space-variant TBE held-as is still recognized (no false TBE_IMMUNITY mismatch when the note is present)', () => {
    // "tenants-by-the-entirety" normalizes to the accepted form; with the correct note present this renders OK.
    const r = assembleIntoTrustDeed({ ...baseA(), heldAs: 'tenants-by-the-entirety' });
    expect(r.status).toBe('OK');
    expect(r.deed).toBeDefined();
  });

  // Guard 4 — divorce-variant contradiction. Use an exemplar-A base (so the basis<->face coupling in Guard 2
  // PASSES) but flip the marital status to divorced, so the divorce classification reaches Guard 4 (rather than
  // being intercepted earlier by the basis-mismatch early-return).
  it('a DIVORCED-classified input declared as exemplar A -> WITHHELD + EXEMPLAR_VARIANT_MISMATCH', () => {
    const r = assembleIntoTrustDeed({ ...baseA(), grantorMaritalStatus: 'both divorced and not remarried' });
    expect(r.status).toBe('WITHHELD');
    expect(r.flags).toContain('EXEMPLAR_VARIANT_MISMATCH');
    expect(r.deed).toBeUndefined();
  });

  // Guard 5 — DERIVATION_MISSING.
  it('exemplar A with a blank derivation -> WITHHELD + DERIVATION_MISSING (no TypeError, fail closed)', () => {
    const r = assembleIntoTrustDeed({ ...baseA(), derivation: '   ' });
    expect(r.status).toBe('WITHHELD');
    expect(r.flags).toContain('DERIVATION_MISSING');
    expect(r.deed).toBeUndefined();
  });

  it('exemplar C with a missing derivation -> WITHHELD + DERIVATION_MISSING', () => {
    const c = baseC();
    delete (c as Partial<DeedIntoTrustInput>).derivation;
    const r = assembleIntoTrustDeed(c);
    expect(r.status).toBe('WITHHELD');
    expect(r.flags).toContain('DERIVATION_MISSING');
    expect(r.deed).toBeUndefined();
  });

  // Guard 6 — exemplar<->facts cross-validation.
  it('exemplar A declared but trust_structure says dual trusts -> WITHHELD + EXEMPLAR_FACTS_MISMATCH', () => {
    const r = assembleIntoTrustDeed({ ...baseA(), trustStructure: 'dual_his_and_hers_trusts' });
    expect(r.status).toBe('WITHHELD');
    expect(r.flags).toContain('EXEMPLAR_FACTS_MISMATCH');
    expect(r.deed).toBeUndefined();
  });

  it('exemplar C declared but trust_structure says single joint trust -> WITHHELD + EXEMPLAR_FACTS_MISMATCH', () => {
    const r = assembleIntoTrustDeed({ ...baseC(), trustStructure: 'single_joint_trust' });
    expect(r.status).toBe('WITHHELD');
    expect(r.flags).toContain('EXEMPLAR_FACTS_MISMATCH');
    expect(r.deed).toBeUndefined();
  });

  // Guard 7 — grantee-object validation.
  it('a missing grantee-object plurality -> WITHHELD + UNKNOWN_GRANTEE_OBJECT (no silent GRANTEES default)', () => {
    const a = baseA();
    delete (a as Partial<DeedIntoTrustInput>).granteeObjectPlurality;
    const r = assembleIntoTrustDeed(a);
    expect(r.status).toBe('WITHHELD');
    expect(r.flags).toContain('UNKNOWN_GRANTEE_OBJECT');
    expect(r.deed).toBeUndefined();
  });

  it('an out-of-set grantee-object plurality -> WITHHELD + UNKNOWN_GRANTEE_OBJECT', () => {
    const r = assembleIntoTrustDeed({ ...baseA(), granteeObjectPlurality: 'GRANTORS' });
    expect(r.status).toBe('WITHHELD');
    expect(r.flags).toContain('UNKNOWN_GRANTEE_OBJECT');
    expect(r.deed).toBeUndefined();
  });

  // Guard 8 — condo PROBE-A (mid-Declaration cut that still ends on the land-records terminus).
  it('PROBE-A condo legal: valid land-records terminus but the Declaration/Instrument recital CUT -> WITHHELD + LEGAL_DESCRIPTION_TRUNCATED', () => {
    const r = assembleIntoTrustDeed({
      ...baseA(),
      legalDescription:
        'Condominium Unit No. 204, THE CARNABY AT WIEHLE STATION Condominium, and together with the limited common elements appurtenant thereto, among the land records of the County of Fairfax, Virginia.',
    });
    expect(r.status).toBe('WITHHELD');
    expect(r.flags).toContain('LEGAL_DESCRIPTION_TRUNCATED');
    expect(r.deed).toBeUndefined();
  });

  it('GOLDEN-1 condo legal (recorded-Declaration anchor PRESENT) still renders OK (the PROBE-A anchor does not over-block)', () => {
    const r = assembleIntoTrustDeed(toInput(grabGoldInput(1), 'A'));
    expect(r.status).toBe('OK');
    expect(r.deed).toBeDefined();
  });
});

describe('Into-Trust (C2) — registry + verified cite', () => {
  it('registered in the deed-type registry as available', () => {
    const e = getDeedType('deed_into_trust');
    expect(e).toBeDefined();
    expect(e!.status).toBe('available');
    expect(e!.exemptionCitation).toBe('Va. Code § 58.1-811(A)(12)');
    expect(DEED_TYPE_REGISTRY.some((d) => d.key === 'deed_into_trust' && d.status === 'available')).toBe(true);
  });

  it('the § 58.1-811(A)(12) and § 58.1-811(A)(15) cites are both in the verified KB (no-hallucination guard)', () => {
    expect(VA_EXEMPTIONS.some((e) => e.citation === 'Va. Code § 58.1-811(A)(12)')).toBe(true);
    expect(VA_EXEMPTIONS.some((e) => e.citation === 'Va. Code § 58.1-811(A)(15)')).toBe(true);
  });
});
