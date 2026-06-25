/**
 * deed_ingest_extract_llc.test.ts — MONSTER BUILD 2 E5: the LLC-authority ingest extractor (the new
 * 'llc_authority' DeedDocType covering BOTH the operating agreement and the SCC entity record).
 *
 * Fixtures are SYNTHETIC, PII-FREE OCR'd-text — structurally faithful to the real Virginia SCC Clerk's
 * Information System entity record ("Entity Name:" / "Entity ID:" / "Entity Type:" / "Formation Date:" /
 * "Jurisdiction:" labels) and the real operating-agreement skeleton ("OPERATING AGREEMENT OF <name>", the
 * "entered into by <person> (the \"Member\")" recital, a SCHEDULE A member row) but with INVENTED entity names,
 * IDs, members, and addresses (the real corpus is confidential client PII).
 *
 * EXACT-STRING assertion discipline (carried from OCR-B1): captured names/IDs are asserted by toBe/toEqual, and
 * a name-bleed / non-VA-formation fixture proves FAIL-CLOSED withholding.
 */
import { describe, it, expect } from 'vitest';
import {
  classifyDeedDocType,
  extractDeedIngest,
  type DeedIngestField,
  type DeedIngestResult,
} from '../deed/deedIngestExtract.js';

/** Non-null field accessor: throws if the field is absent so a typo can't silently pass as "undefined". */
function fld(r: DeedIngestResult, key: string): DeedIngestField {
  const f = r.fields.find((x) => x.key === key);
  if (!f) throw new Error(`field "${key}" not present (keys: ${r.fields.map((x) => x.key).join(',')})`);
  return f;
}

// ── SYNTHETIC SCC entity record (Virginia Clerk's Information System layout) ──────────────────
const SCC_RECORD = [
  'Entity Information',
  'Entity Name: Marlowe Glen Holdings LLC',
  'Entity ID: 11876543',
  'Entity Type: Limited Liability Company',
  'Entity Status: Active',
  'Reason for Status: Active',
  'Formation Date: 03/18/2026',
  'Status Date: 03/18/2026',
  'VA Qualification Date: 03/18/2026',
  'Jurisdiction: VA',
  'Registered Agent Information',
  'Name: Dahlia Okonkwo',
  'State Corporation Commission',
  'VIRGINIA - SCC',
].join('\n');

// ── SYNTHETIC operating agreement (single managing member; SCHEDULE A row) ────────────────────
const OPERATING_AGREEMENT = [
  'OPERATING AGREEMENT OF MARLOWE GLEN HOLDINGS LLC',
  'A Virginia Limited Liability Company',
  'Effective Date: February 10, 2026',
  'This Operating Agreement (this "Agreement") is entered into by Dahlia Okonkwo (the "Member") with respect to',
  'Marlowe Glen Holdings LLC, a Virginia limited liability company (the "Company").',
  'ARTICLE I. FORMATION, GOVERNING LAW, AND PURPOSE',
  'Formation. The Company has been organized as a Virginia limited liability company by filing Articles of',
  'Organization with the Virginia State Corporation Commission (the "SCC").',
  'Member-Managed. The Company is member-managed. The managing member shall have sole authority.',
  'SCHEDULE A - MEMBER INFORMATION',
  'Member: Dahlia Okonkwo',
  'Mailing Address: 7720 Marlowe Glen Court, Springfield, VA 22150',
  'Ownership Interest: 100%',
].join('\n');

// ── SYNTHETIC two-member operating agreement (member list joined by "and") ─────────────────────
const OA_TWO_MEMBER = [
  'OPERATING AGREEMENT OF CEDAR & STONE VENTURES LLC',
  'A Virginia Limited Liability Company',
  'ARTICLE III. MEMBER; CAPITAL; OWNERSHIP INTEREST',
  'Members: Marguerite Delacroix and Tobias Hargreaves',
  'Percentage Interest: 50% each',
].join('\n');

// ── SYNTHETIC SCC record asserting a NON-Virginia (Delaware) formation jurisdiction ────────────
const SCC_FOREIGN = [
  'Entity Information',
  'Entity Name: Pollard Street Capital LLC',
  'Entity ID: 22045118',
  'Entity Type: Limited Liability Company',
  'Formation Date: 08/14/2024',
  'Jurisdiction: Delaware',
  'State Corporation Commission',
].join('\n');

describe('E5 LLC-authority classification', () => {
  it('classifies an SCC entity record as llc_authority', () => {
    const { type } = classifyDeedDocType(SCC_RECORD);
    expect(type).toBe('llc_authority');
  });

  it('classifies an operating agreement as llc_authority', () => {
    const { type } = classifyDeedDocType(OPERATING_AGREEMENT);
    expect(type).toBe('llc_authority');
  });
});

describe('E5 LLC-authority extraction — SCC entity record', () => {
  const r = extractDeedIngest(SCC_RECORD);

  it('docType is llc_authority', () => {
    expect(r.docType).toBe('llc_authority');
  });

  it('captures the LLC legal name VERBATIM (label-anchored, exact)', () => {
    expect(fld(r, 'llcLegalName').value).toBe('Marlowe Glen Holdings LLC');
    expect(fld(r, 'llcLegalName').withheld).toBe(false);
  });

  it('captures the entity ID', () => {
    expect(fld(r, 'llcEntityId').value).toBe('11876543');
  });

  it('captures the formation date', () => {
    expect(fld(r, 'llcFormationDate').value).toBe('03/18/2026');
  });

  it('passes a Virginia formation state (not withheld)', () => {
    const f = fld(r, 'llcFormationState');
    expect(f.withheld).toBe(false);
    expect(f.value).toBe('VA');
  });
});

describe('E5 LLC-authority extraction — operating agreement', () => {
  const r = extractDeedIngest(OPERATING_AGREEMENT);

  it('docType is llc_authority', () => {
    expect(r.docType).toBe('llc_authority');
  });

  it('captures the LLC legal name VERBATIM from the OA caption', () => {
    expect(fld(r, 'llcLegalName').value).toBe('MARLOWE GLEN HOLDINGS LLC');
  });

  it('captures the single member name (splitPeople, exact)', () => {
    const f = fld(r, 'llcMembers');
    expect(f.values).toEqual(['Dahlia Okonkwo']);
    expect(f.withheld).toBe(false);
  });

  it('passes the Virginia formation recital (not withheld)', () => {
    expect(fld(r, 'llcFormationState').withheld).toBe(false);
    expect(fld(r, 'llcFormationState').value).toBe('Virginia');
  });

  it('the member legal name does NOT bleed the parenthetical Member label', () => {
    const f = fld(r, 'llcMembers');
    f.values.forEach((n) => {
      expect(n).not.toMatch(/\(\s*the/i);
      expect(n).not.toMatch(/Member/i);
    });
  });
});

describe('E5 LLC-authority extraction — multi-member operating agreement', () => {
  const r = extractDeedIngest(OA_TWO_MEMBER);

  it('captures BOTH member names as distinct people (splitPeople on the "and" list)', () => {
    expect(fld(r, 'llcMembers').values).toEqual(['Marguerite Delacroix', 'Tobias Hargreaves']);
  });

  it('captures the entity legal name with an ampersand', () => {
    expect(fld(r, 'llcLegalName').value).toBe('CEDAR & STONE VENTURES LLC');
  });
});

describe('E5 LLC-authority FAIL-CLOSED behaviour', () => {
  it('WITHHOLDS a NON-Virginia formation state (foreign-state LLC; would feed a wrong exemption cite)', () => {
    const r = extractDeedIngest(SCC_FOREIGN);
    const f = fld(r, 'llcFormationState');
    expect(f.withheld).toBe(true);
    expect(f.value).toBeNull();
    expect(f.flags).toContain('non_virginia_formation_state');
  });

  it('the foreign-state record still surfaces the legal name (only the state is withheld)', () => {
    const r = extractDeedIngest(SCC_FOREIGN);
    expect(fld(r, 'llcLegalName').value).toBe('Pollard Street Capital LLC');
  });

  it('routes the document to review (lowConfidence) when the load-bearing member set is absent (SCC has no members)', () => {
    // The SCC record carries the legal name but NO member list — llcMembers is a CRITICAL_KEY, so its absence
    // forces document-level review (a wrong cite would otherwise ride a half-extracted record).
    const r = extractDeedIngest(SCC_RECORD);
    expect(fld(r, 'llcMembers').value).toBeNull();
    expect(r.lowConfidence).toBe(true);
    expect(r.warnings.some((w) => /critical_field_unresolved/.test(w))).toBe(true);
  });

  it('a member span whose name carries the parenthetical Member-label bridge fails closed (withheld, no junk)', () => {
    // A defective OA where the member label line bled the entity descriptor into the name span; splitPeople
    // fail-closes on the entity designator, so the member field is WITHHELD rather than emitting a junk name.
    const polluted = [
      'OPERATING AGREEMENT OF Briar Hollow Family LLC',
      'A Virginia Limited Liability Company',
      'Members: Briar Hollow Family LLC, collectively the members',
    ].join('\n');
    const r = extractDeedIngest(polluted);
    const f = fld(r, 'llcMembers');
    expect(f.withheld).toBe(true);
    expect(f.value).toBeNull();
  });
});
