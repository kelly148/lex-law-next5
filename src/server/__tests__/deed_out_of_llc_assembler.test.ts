/**
 * deed_out_of_llc_assembler.test.ts — DEED-DRAFT-AGENT-1 category C4 (Deed Out of an LLC) acceptance bar.
 *
 * NON-CIRCULAR: the GOLDEN inputs + expected deed bodies are READ from the committed, operator-authored fixture
 * pack (docs/deed/DEED_CAT_OUT_OF_LLC_fixture_pack.md). Each GOLDEN is a single ```json block carrying BOTH the
 * input fields AND an `expected_deed` string (escaped \n) — the test parses that JSON and asserts the assembler
 * reproduces `expected_deed` byte-for-byte (`toBe`). NEG fixtures (also ```json blocks) must FAIL CLOSED
 * ({ status: 'WITHHELD', flags, no deed }), except NEG-B which FLAGs-and-NORMALIZEs (the typo is never emitted).
 * The FIRE-watch guard cases (name-bleed, missing member, truncated legal) mutate a valid GOLD base. Synthetic,
 * PII-free pack.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import {
  assembleOutOfLlcDeed,
  type DeedOutOfLlcInput,
} from '../deed/deedOutOfLlcAssembler.js';
import { DEED_TYPE_REGISTRY, getDeedType } from '../deed/deedTypeRegistry.js';
import { VA_EXEMPTIONS } from '../deed/deedKbVa.js';

const PACK = readFileSync(
  fileURLToPath(new URL('../../../docs/deed/DEED_CAT_OUT_OF_LLC_fixture_pack.md', import.meta.url)),
  'utf8',
);

interface Fixture {
  title: string;
  json: Record<string, any>;
}

/** Parse EVERY ```json block in the pack, tagged with the nearest preceding "### <title>" header so multi-block
 *  sections (NEG-A has A1/A2/A3) are each addressable by their fixture_id. NON-CIRCULAR: nothing is hand-typed. */
function parsePack(md: string): Fixture[] {
  const out: Fixture[] = [];
  const segs = md.split('\n### ').slice(1);
  for (const seg of segs) {
    const title = seg.split('\n')[0]!.trim();
    const blocks = seg.match(/```json\n([\s\S]*?)\n```/g) ?? [];
    for (const b of blocks) {
      const body = b.replace(/^```json\n/, '').replace(/\n```$/, '');
      out.push({ title, json: JSON.parse(body) as Record<string, any> });
    }
  }
  return out;
}

const fixtures = parsePack(PACK);
const byId = (id: string): Fixture => {
  const f = fixtures.find((x) => x.json.fixture_id === id);
  if (!f) throw new Error(`fixture ${id} not found in pack`);
  return f;
};

const golds = fixtures.filter((f) => String(f.json.fixture_id ?? '').startsWith('C4-GOLDEN'));
const negs = fixtures.filter((f) => String(f.json.fixture_id ?? '').startsWith('C4-NEG'));

/** Map a fixture's snake_case input JSON onto the assembler input (camelCase). Sparse NEG inputs are tolerated
 *  (missing fields stay undefined; the NEG isolates exactly the defect it targets over an otherwise-valid base). */
function toInput(j: Record<string, any>): DeedOutOfLlcInput {
  const i = j.input ?? j;
  return {
    grantorLlc: i.grantor_llc,
    members: (i.members ?? []).map((m: any) => ({ name: m.name, signatureTitle: m.signature_title })),
    fileNumber: i.file_number,
    granteeAddress: i.grantee_address,
    taxId: i.tax_id,
    assessedValue: i.assessed_value,
    consideration: i.consideration,
    executionMonth: i.execution_month,
    executionYear: i.execution_year,
    localityType: i.locality_type,
    localityName: i.locality_name,
    legalDescription: i.legal_description,
    derivationInstrumentNumber: i.derivation_instrument_number,
    notaryLocality: i.notary_locality,
    returnTo: i.return_to
      ? {
          company: i.return_to.company,
          line1: i.return_to.line1,
          line2: i.return_to.line2,
          cityStateZip: i.return_to.city_state_zip,
          phone: i.return_to.phone,
        }
      : (undefined as any),
    ...(i.exemption_cite_raw !== undefined ? { exemptionCiteRaw: i.exemption_cite_raw } : {}),
    ...(i.warranty_token !== undefined ? { warrantyToken: i.warranty_token } : {}),
  };
}

// A valid GOLD-1 base, used to isolate FIRE-watch guard defects.
const base = (): DeedOutOfLlcInput => toInput(byId('C4-GOLDEN-1').json);

// ── The §3.2 negative-family POISON fragments (no captured party name may contain any). ──
const POISON_FRAGMENTS = [
  '(the "Grantor")',
  '(the "Grantees")',
  '(the "Grantee")',
  '"), and',
  '", and',
  'A Virginia Limited Liability Company',
  'collectively being the members of the Grantor LLC',
];
function assertCleanPartyName(name: string): void {
  for (const frag of POISON_FRAGMENTS) {
    expect(name.includes(frag)).toBe(false);
  }
}

describe('Out-of-LLC (C4) — fixture pack parsed', () => {
  it('parses 3 GOLDEN + the NEG family from the pack', () => {
    expect(golds.length).toBe(3);
    expect(negs.length).toBeGreaterThanOrEqual(6); // A1, A2, A3, B, C, D
    for (const id of ['C4-GOLDEN-1', 'C4-GOLDEN-2', 'C4-GOLDEN-3']) {
      expect(byId(id).json.expected_deed.length).toBeGreaterThan(500);
    }
  });
});

describe('Out-of-LLC (C4) — GOLDEN fixtures reproduce the fixture pack exactly', () => {
  for (const g of golds) {
    it(`${g.json.fixture_id} — full body byte-for-byte + segment contract`, () => {
      const result = assembleOutOfLlcDeed(toInput(g.json));
      expect(result.status).toBe('OK');
      expect(result.recordableFloorOk).toBe(true); // S3 in-module B6 + format floor
      expect(result.deed).toBeDefined();
      const d = result.deed!;

      // Strongest: the entire assembled document equals the fixture's expected_deed (byte-for-byte).
      expect(d.fullText).toBe(g.json.expected_deed);

      // §3.1 load-bearing clause-level exact matches.
      expect(d.exemptionLine).toBe('Exempt from recording tax pursuant to Sec. § 58.1-811(A)(11), 1950 Code of Virginia, amended');
      expect(d.banner).toBe('THIS DEED PREPARED WITHOUT THE BENEFIT OF TITLE EXAMINATION – NO TITLE INSURANCE');
      expect(d.title).toBe('DEED');
      expect(d.grantingClause).toBe('the Grantor does hereby grant and convey, with Special Warranty of title, unto the said Grantees, in fee simple, as tenants in common,');
      expect(d.subjectTo).toBe('This conveyance is made subject to covenants, conditions, restrictions, easements and rights of way of record.');

      // Verbatim legal carried UNCHANGED.
      expect(d.legalDescription).toBe(g.json.input.legal_description);
      // Derivation line exact.
      expect(d.derivationLine).toBe(
        `For derivation of title see Deed recorded as instrument number ${g.json.input.derivation_instrument_number} among the aforesaid land records.`,
      );

      // Cross-cutting: SPECIAL warranty + tenants in common present; never General; never the typo.
      expect(d.fullText.includes('with Special Warranty of title')).toBe(true);
      expect(d.fullText.includes('as tenants in common')).toBe(true);
      expect(d.fullText.includes('General Warranty')).toBe(false);
      expect(d.fullText.includes('58-1-811')).toBe(false);

      // §3.2 — every captured party name in the GOLD input is clean (proves clean capture).
      assertCleanPartyName(g.json.input.grantor_llc);
      g.json.input.members.forEach((m: any) => assertCleanPartyName(m.name));
    });
  }

  it('C4-GOLDEN-1 — premise equals the assembled parenthetical-label form EXACTLY', () => {
    const d = assembleOutOfLlcDeed(toInput(byId('C4-GOLDEN-1').json)).deed!;
    expect(d.premise).toBe(
      'THIS DEED, made this _____ day of July, 2026, by and between MAPLEHURST HOLDINGS LLC, A Virginia Limited Liability Company, (the "Grantor"), and Desmond R. Okafor and Priya N. Venkataraman, collectively being the members of the Grantor LLC, (the "Grantees"),',
    );
    expect(d.captionParties).toBe(d.premise);
  });

  it('member-name joining: 2-member simple "and", 3-member non-Oxford "A, B and C", 1-member bare', () => {
    const d1 = assembleOutOfLlcDeed(toInput(byId('C4-GOLDEN-1').json)).deed!; // 2 members
    expect(d1.premise).toContain('Desmond R. Okafor and Priya N. Venkataraman,');
    const d2 = assembleOutOfLlcDeed(toInput(byId('C4-GOLDEN-2').json)).deed!; // 3 members
    expect(d2.premise).toContain('Marguerite A. Delacroix, Tobias E. Hargreaves and Lin Wei Chang,');
    const d3 = assembleOutOfLlcDeed(toInput(byId('C4-GOLDEN-3').json)).deed!; // 1 member
    expect(d3.premise).toContain('and Anselm J. Fairweather, collectively being the members of the Grantor LLC,');
  });

  it('singular-member HOUSE-STYLE invariants are carried verbatim (NOT grammar-fixed)', () => {
    const d3 = assembleOutOfLlcDeed(toInput(byId('C4-GOLDEN-3').json)).deed!;
    // Single member still reads "members" (plural) and "as tenants in common" — corpus invariant, not a typo to fix.
    expect(d3.premise).toContain('collectively being the members of the Grantor LLC');
    expect(d3.grantingClause).toContain('as tenants in common');
    // Notary singularizes "Member" by count.
    expect(d3.notaryBlock).toContain('Member of QUILLON RIDGE PROPERTIES LLC.');
    expect(d3.notaryBlock).not.toContain('Members of QUILLON RIDGE PROPERTIES LLC.');
  });

  it('notary pluralizes Member/Members by count', () => {
    const d1 = assembleOutOfLlcDeed(toInput(byId('C4-GOLDEN-1').json)).deed!; // 2
    expect(d1.notaryBlock).toContain('Members of MAPLEHURST HOLDINGS LLC.');
    const d2 = assembleOutOfLlcDeed(toInput(byId('C4-GOLDEN-2').json)).deed!; // 3
    expect(d2.notaryBlock).toContain('Members of CEDAR & STONE VENTURES LLC.');
  });

  it('signature block: LLC line + one "By: ____ <member>, Member" per member', () => {
    const d1 = assembleOutOfLlcDeed(toInput(byId('C4-GOLDEN-1').json)).deed!;
    expect(d1.signatureBlocks[0]).toBe('MAPLEHURST HOLDINGS LLC, A Virginia Limited Liability Company');
    expect(d1.signatureBlocks[1]).toBe('By: ______________________________     Desmond R. Okafor, Member');
    expect(d1.signatureBlocks[2]).toBe('By: ______________________________     Priya N. Venkataraman, Member');
    expect(d1.signatureBlocks.length).toBe(3); // LLC + 2 members
  });
});

describe('Out-of-LLC (C4) — NEG fixtures fail closed', () => {
  it('NEG-A1 — grantor name carrying the "(the \\"Grantor\\")" label -> WITHHELD + PARTY_NAME_LABEL_BLEED, no deed', () => {
    const r = assembleOutOfLlcDeed(toInput(byId('C4-NEG-A1-grantor-label-bleed').json));
    expect(r.status).toBe('WITHHELD');
    expect(r.flags).toContain('PARTY_NAME_LABEL_BLEED');
    expect(r.deed).toBeUndefined();
  });

  it('NEG-A2 — member name carrying the "\\"), and" bridge fragment -> WITHHELD + PARTY_NAME_BRIDGE_FRAGMENT, no deed', () => {
    const r = assembleOutOfLlcDeed(toInput(byId('C4-NEG-A2-bridge-fragment-bleed').json));
    expect(r.status).toBe('WITHHELD');
    expect(r.flags).toContain('PARTY_NAME_BRIDGE_FRAGMENT');
    expect(r.deed).toBeUndefined();
  });

  it('NEG-A3 — member name carrying the descriptor + "(the \\"Grantees\\")" label -> WITHHELD + PARTY_NAME_LABEL_BLEED, no deed', () => {
    const r = assembleOutOfLlcDeed(toInput(byId('C4-NEG-A3-grantees-label-bleed').json));
    expect(r.status).toBe('WITHHELD');
    expect(r.flags).toContain('PARTY_NAME_LABEL_BLEED');
    expect(r.deed).toBeUndefined();
  });

  it('NEG-B — malformed exemption cite "58-1-811(A)(11)" -> FLAG_AND_NORMALIZE: flagged, normalized, typo never emitted', () => {
    // NEG-B is sparse (only LLC + 1 member + the raw cite); supply a valid base so only the cite defect is isolated.
    const negB = byId('C4-NEG-B-exemption-typo').json.input;
    const r = assembleOutOfLlcDeed({ ...base(), grantorLlc: negB.grantor_llc, members: negB.members.map((m: any) => ({ name: m.name, signatureTitle: m.signature_title })), exemptionCiteRaw: negB.exemption_cite_raw });
    expect(r.flags).toContain('EXEMPTION_CITE_MALFORMED');
    // FLAG_AND_NORMALIZE — a deed IS still produced (non-blocking), with the normalized KB cite.
    expect(r.status).toBe('OK');
    expect(r.deed).toBeDefined();
    expect(r.deed!.exemptionLine).toBe('Exempt from recording tax pursuant to Sec. § 58.1-811(A)(11), 1950 Code of Virginia, amended');
    // The malformed literal is never emitted anywhere in the document.
    expect(r.deed!.fullText.includes('58-1-811(A)(11)')).toBe(false);
  });

  it('NEG-C — truncated legal description -> WITHHELD + LEGAL_DESCRIPTION_TRUNCATED, no deed', () => {
    const negC = byId('C4-NEG-C-truncated-legal').json.input;
    const r = assembleOutOfLlcDeed({ ...base(), grantorLlc: negC.grantor_llc, members: negC.members.map((m: any) => ({ name: m.name, signatureTitle: m.signature_title })), legalDescription: negC.legal_description });
    expect(r.status).toBe('WITHHELD');
    expect(r.flags).toContain('LEGAL_DESCRIPTION_TRUNCATED');
    expect(r.deed).toBeUndefined();
  });

  it('NEG-D — General Warranty token where SPECIAL is required -> WITHHELD + WARRANTY_MISMATCH, never emits General', () => {
    const negD = byId('C4-NEG-D-warranty-mismatch').json.input;
    const r = assembleOutOfLlcDeed({ ...base(), grantorLlc: negD.grantor_llc, members: negD.members.map((m: any) => ({ name: m.name, signatureTitle: m.signature_title })), warrantyToken: negD.warranty_token });
    expect(r.status).toBe('WITHHELD');
    expect(r.flags).toContain('WARRANTY_MISMATCH');
    expect(r.deed).toBeUndefined();
    expect(JSON.stringify(r)).not.toContain('General Warranty');
  });
});

describe('Out-of-LLC (C4) — FIRE-watch guards (deterministic surface-not-decide; fail closed, never fabricate)', () => {
  it('name-bleed in a member name (label) -> WITHHELD + PARTY_NAME_LABEL_BLEED', () => {
    const b = base();
    const r = assembleOutOfLlcDeed({
      ...b,
      members: [{ name: 'Desmond R. Okafor, collectively being the members of the Grantor LLC, (the "Grantees")', signatureTitle: 'Member' }, b.members[1]!],
    });
    expect(r.status).toBe('WITHHELD');
    expect(r.flags).toContain('PARTY_NAME_LABEL_BLEED');
    expect(r.deed).toBeUndefined();
  });

  it('a captured name carrying an embedded newline -> WITHHELD (labels/bridge/newline are template-assembled)', () => {
    const b = base();
    const r = assembleOutOfLlcDeed({ ...b, grantorLlc: 'MAPLEHURST HOLDINGS LLC\nA Virginia Limited Liability Company' });
    expect(r.status).toBe('WITHHELD');
    expect(r.flags).toContain('PARTY_NAME_LABEL_BLEED');
    expect(r.deed).toBeUndefined();
  });

  // ── Adversarial-review BLOCKER: the BARE (paren-LESS) ", and" list-join bridge variant must also fail closed.
  // The pack §3.2 enumerates ", and" (straight + smart quote) as a POISON fragment; it is fed to the ASSEMBLER
  // here (not just assertCleanPartyName), proving the guard rejects it rather than letting the bleed reach the
  // premise/signature/notary. Must NOT regress the parenthesized "\"), and" form, and must NOT false-trip on a
  // clean name merely containing the word "and". ──
  it('member name ending in the BARE ", and" (no paren, straight quote) -> WITHHELD + PARTY_NAME_BRIDGE_FRAGMENT, no deed', () => {
    const b = base();
    const r = assembleOutOfLlcDeed({ ...b, members: [{ name: 'Priya N. Venkataraman", and', signatureTitle: 'Member' }, b.members[1]!] });
    expect(r.status).toBe('WITHHELD');
    expect(r.flags).toContain('PARTY_NAME_BRIDGE_FRAGMENT');
    expect(r.deed).toBeUndefined();
  });

  it('member name ending in the BARE smart-quote "”, and" -> WITHHELD + PARTY_NAME_BRIDGE_FRAGMENT, no deed', () => {
    const b = base();
    const r = assembleOutOfLlcDeed({ ...b, members: [{ name: 'Priya N. Venkataraman”, and', signatureTitle: 'Member' }, b.members[1]!] });
    expect(r.status).toBe('WITHHELD');
    expect(r.flags).toContain('PARTY_NAME_BRIDGE_FRAGMENT');
    expect(r.deed).toBeUndefined();
  });

  it('the parenthesized "\\"), and" bridge form STILL fails closed (no regression) -> PARTY_NAME_BRIDGE_FRAGMENT', () => {
    const b = base();
    const r = assembleOutOfLlcDeed({ ...b, members: [{ name: 'Priya N. Venkataraman"), and', signatureTitle: 'Member' }, b.members[1]!] });
    expect(r.status).toBe('WITHHELD');
    expect(r.flags).toContain('PARTY_NAME_BRIDGE_FRAGMENT');
    expect(r.deed).toBeUndefined();
  });

  it('a captured name carrying an embedded TAB -> WITHHELD + PARTY_NAME_LABEL_BLEED (no interior control whitespace)', () => {
    const b = base();
    const r = assembleOutOfLlcDeed({ ...b, members: [{ name: 'Priya N.\tVenkataraman', signatureTitle: 'Member' }, b.members[1]!] });
    expect(r.status).toBe('WITHHELD');
    expect(r.flags).toContain('PARTY_NAME_LABEL_BLEED');
    expect(r.deed).toBeUndefined();
  });

  it('a CLEAN name merely containing the word "and" does NOT false-trip the bridge guard (LLC "Sand & Stone", member "Anderson")', () => {
    const b = base();
    // Substitute clean names that contain the substring "and"/"and " but no quote-then-bridge — must assemble OK.
    const r = assembleOutOfLlcDeed({
      ...b,
      grantorLlc: 'SAND & STONE HOLDINGS LLC',
      members: [{ name: 'Marcus Anderson', signatureTitle: 'Member' }, { name: 'Ferdinand Strand', signatureTitle: 'Member' }],
      notaryLocality: 'COUNTY OF LOUDOUN',
    });
    expect(r.status).toBe('OK');
    expect(r.flags).not.toContain('PARTY_NAME_BRIDGE_FRAGMENT');
    expect(r.flags).not.toContain('PARTY_NAME_LABEL_BLEED');
    expect(r.deed).toBeDefined();
    expect(r.deed!.premise).toContain('SAND & STONE HOLDINGS LLC, A Virginia Limited Liability Company,');
    expect(r.deed!.premise).toContain('Marcus Anderson and Ferdinand Strand,');
  });

  it('missing/blank LLC name -> WITHHELD + GRANTOR_LLC_MISSING, no deed (never throws)', () => {
    const r = assembleOutOfLlcDeed({ ...base(), grantorLlc: '   ' });
    expect(r.status).toBe('WITHHELD');
    expect(r.flags).toContain('GRANTOR_LLC_MISSING');
    expect(r.deed).toBeUndefined();
  });

  it('empty members -> WITHHELD + NO_MEMBER_DESIGNATED, no deed (never throws)', () => {
    const r = assembleOutOfLlcDeed({ ...base(), members: [] });
    expect(r.status).toBe('WITHHELD');
    expect(r.flags).toContain('NO_MEMBER_DESIGNATED');
    expect(r.deed).toBeUndefined();
  });

  it('members array of only blank entries -> WITHHELD + NO_MEMBER_DESIGNATED', () => {
    const r = assembleOutOfLlcDeed({ ...base(), members: [{ name: '   ', signatureTitle: 'Member' }] });
    expect(r.status).toBe('WITHHELD');
    expect(r.flags).toContain('NO_MEMBER_DESIGNATED');
    expect(r.deed).toBeUndefined();
  });

  it('a condo legal cut mid-amendment (ends on a period) -> WITHHELD + LEGAL_DESCRIPTION_TRUNCATED', () => {
    const r = assembleOutOfLlcDeed({
      ...base(),
      legalDescription:
        'Unit 412, Building 11, of BRINDLE COMMONS, A Condominium, established by Declaration recorded in Deed Book 19844 at page 0021, and by First Amendment recorded in Deed Book 19902 at page 1106.',
    });
    expect(r.status).toBe('WITHHELD');
    expect(r.flags).toContain('LEGAL_DESCRIPTION_TRUNCATED');
    expect(r.deed).toBeUndefined();
  });
});

describe('Out-of-LLC (C4) — registry + verified cite', () => {
  it('registered in the deed-type registry as available', () => {
    const e = getDeedType('deed_out_of_llc');
    expect(e).toBeDefined();
    expect(e!.status).toBe('available');
    expect(e!.exemptionCitation).toBe('Va. Code § 58.1-811(A)(11)');
    expect(DEED_TYPE_REGISTRY.some((d) => d.key === 'deed_out_of_llc')).toBe(true);
  });

  it('the corrected (A)(11) OUT-of-LLC cite (grantees >=50%, FROM direction) is in the verified KB', () => {
    const a11 = VA_EXEMPTIONS.find((e) => e.citation === 'Va. Code § 58.1-811(A)(11)');
    expect(a11).toBeDefined();
    expect(a11!.transferType).toMatch(/^From a partnership or limited liability company, when the grantees/);
  });
});
