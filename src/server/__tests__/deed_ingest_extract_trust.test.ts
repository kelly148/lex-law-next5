/**
 * deed_ingest_extract_trust.test.ts — MONSTER BUILD 2 E6: the certificate-of-trust ingest extractor (the new
 * 'certificate_of_trust' DeedDocType).
 *
 * Fixtures are SYNTHETIC, PII-FREE OCR'd-text — structurally faithful to the real Virginia certificate-of-trust
 * skeleton (the "Certificate of Trust" caption, the Va. Code § 64.2-775 statutory anchor, the "Trust Name and
 * Date:" / "Settlors:" / "Current Trustees:" / "Trustee Powers:" labeled recitals, the "...to certify the
 * existence and terms of <NAME> (the \"Trust\")" recital) but with INVENTED trust names, trustee names, and dates
 * (the real corpus is confidential client PII — never copied here).
 *
 * EXACT-STRING assertion discipline (carried from OCR-B1): captured names/dates are asserted by toBe/toEqual, and
 * a name-bleed / isolation-failure fixture proves FAIL-CLOSED withholding. A fixture with the §55.1-136(C) NOTE
 * and a condo footnote present in the SOURCE proves the extractor does NOT choke on house-boilerplate that is
 * irrelevant to extraction (the B6 false-positives the S3 finding warns about stay deferred to the export
 * chokepoint — there is NO B6/recordable-floor gate anywhere in this extractor).
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

// ── SYNTHETIC certificate of trust (two-trustee revocable living trust; Va. Code § 64.2-775 anchor) ──────────
const CERT_OF_TRUST = [
  'CERTIFICATE OF TRUST',
  'THE ROSALIND A. WHITMORE REVOCABLE LIVING TRUST',
  'This Certificate of Trust is executed pursuant to Va. Code § 64.2-775 to certify the existence and terms of',
  'The Rosalind A. Whitmore Revocable Living Trust (the "Trust") as of this 4th day of March, 2024.',
  'Trust Name and Date: The Trust is known as The Rosalind A. Whitmore Revocable Living Trust, established by a',
  'Trust Agreement dated March 4, 2024.',
  'Settlors: The Settlors of the Trust are Rosalind A. Whitmore and Desmond P. Whitmore.',
  'Current Trustees: The currently acting Trustees are Rosalind A. Whitmore and Desmond P. Whitmore, serving as',
  'Co-Trustees, with the authority to act individually on behalf of the Trust.',
  'Revocability: The Trust is revocable and may be amended or terminated by the Settlors jointly.',
  'Trustee Powers: The Trustees have broad powers under Article IX of the Trust Agreement, including the',
  'authority to buy, sell, lease, mortgage, or encumber Trust property.',
  'Governing Law: The Trust is governed by the laws of the Commonwealth of Virginia.',
  'IN WITNESS WHEREOF, the undersigned Trustees have executed this Certificate of Trust.',
].join('\n');

// ── SYNTHETIC single-trustee certificate of trust ─────────────────────────────────────────────────────────────
const CERT_SINGLE_TRUSTEE = [
  'CERTIFICATION OF TRUST',
  'Trust Name and Date: The Trust is known as The Benedict O. Ashford Living Trust, established by a Trust',
  'Agreement dated November 12, 2022.',
  'Current Trustees: The currently acting Trustee is Benedict O. Ashford, serving as sole Trustee.',
  'Trustee Powers: The Trustees have full power to sell and convey Trust property under Article VIII.',
].join('\n');

// ── SYNTHETIC cert of trust whose SOURCE carries the §55.1-136(C) statutory NOTE + a condo footnote (the
//    legitimate house-boilerplate the S3/B6 finding warns about). The extractor must NOT choke on them — they are
//    irrelevant to trust-name / trustee extraction. ──
const CERT_WITH_HOUSE_BOILERPLATE = [
  'CERTIFICATE OF TRUST',
  'Trust Name and Date: The Trust is known as The Cordelia M. Vance Revocable Living Trust, established by a',
  'Trust Agreement dated July 1, 2023.',
  'Current Trustees: The currently acting Trustees are Cordelia M. Vance and Atticus R. Vance, serving as',
  'Co-Trustees.',
  'NOTE: The Grantors herein wish to retain the same immunity from the claims of their separate creditors as they',
  'would if they had continued to hold the subject property as tenants by the entirety pursuant to VA Code',
  'Section 55.1-136(C).',
  '*Reference to Parking Space(s) and Storage Space(s) are for identification purposes only; right to use the',
  'space(s) is subject to the terms of the governing documents, and any and all amendments thereto.',
  'Trustee Powers: The Trustees have broad powers under Article IX of the Trust Agreement.',
].join('\n');

// ── SYNTHETIC cert of trust whose trustee line bled an entity descriptor into the name span (isolation failure) ──
const CERT_POLLUTED_TRUSTEE = [
  'CERTIFICATE OF TRUST',
  'Trust Name and Date: The Trust is known as The Hollis Family Revocable Living Trust, established by a Trust',
  'Agreement dated May 5, 2025.',
  'Current Trustees: The currently acting Trustees are The Hollis Family Trust, collectively the trustees, serving',
  'as Co-Trustees.',
].join('\n');

describe('E6 certificate-of-trust classification', () => {
  it('classifies a certificate of trust as certificate_of_trust', () => {
    expect(classifyDeedDocType(CERT_OF_TRUST).type).toBe('certificate_of_trust');
  });

  it('classifies a "Certification of Trust" caption as certificate_of_trust', () => {
    expect(classifyDeedDocType(CERT_SINGLE_TRUSTEE).type).toBe('certificate_of_trust');
  });

  it('does NOT misclassify the certificate of trust as probate_authority or vesting_deed', () => {
    const { type } = classifyDeedDocType(CERT_OF_TRUST);
    expect(type).not.toBe('probate_authority');
    expect(type).not.toBe('vesting_deed');
  });
});

describe('E6 certificate-of-trust extraction — two-trustee trust', () => {
  const r = extractDeedIngest(CERT_OF_TRUST);

  it('docType is certificate_of_trust', () => {
    expect(r.docType).toBe('certificate_of_trust');
  });

  it('captures the trust legal name VERBATIM (label-anchored, exact — leading "The" preserved)', () => {
    expect(fld(r, 'trustLegalName').value).toBe('The Rosalind A. Whitmore Revocable Living Trust');
    expect(fld(r, 'trustLegalName').withheld).toBe(false);
  });

  it('captures BOTH trustee names as distinct people (splitPeople on the "and" list; capacity tail peeled)', () => {
    const f = fld(r, 'trusteeNames');
    expect(f.values).toEqual(['Rosalind A. Whitmore', 'Desmond P. Whitmore']);
    expect(f.withheld).toBe(false);
  });

  it('captures the trust date (label-anchored "dated <DATE>")', () => {
    expect(fld(r, 'trustDate').value).toBe('March 4, 2024');
  });

  it('captures the OPTIONAL low-confidence powers reference (never load-bearing)', () => {
    expect(fld(r, 'trustPowersReference').value).toBe('Article IX');
  });

  it('the trustee names do NOT bleed the capacity ("serving as Co-Trustees") tail or a label', () => {
    fld(r, 'trusteeNames').values.forEach((n) => {
      expect(n).not.toMatch(/serving/i);
      expect(n).not.toMatch(/Co-Trustees/i);
      expect(n).not.toMatch(/Trustee/i);
      expect(n).not.toMatch(/[\n\r]/);
    });
  });
});

describe('E6 certificate-of-trust extraction — single-trustee trust', () => {
  const r = extractDeedIngest(CERT_SINGLE_TRUSTEE);

  it('docType is certificate_of_trust', () => {
    expect(r.docType).toBe('certificate_of_trust');
  });

  it('captures the trust legal name from the "Trust is known as" recital', () => {
    expect(fld(r, 'trustLegalName').value).toBe('The Benedict O. Ashford Living Trust');
  });

  it('captures the single trustee name', () => {
    expect(fld(r, 'trusteeNames').values).toEqual(['Benedict O. Ashford']);
  });

  it('captures the trust date', () => {
    expect(fld(r, 'trustDate').value).toBe('November 12, 2022');
  });
});

describe('E6 certificate-of-trust — house-boilerplate does NOT break extraction (NO B6 gate here)', () => {
  const r = extractDeedIngest(CERT_WITH_HOUSE_BOILERPLATE);

  it('still classifies + extracts cleanly with the §55.1-136(C) NOTE present in the source', () => {
    expect(r.docType).toBe('certificate_of_trust');
    expect(fld(r, 'trustLegalName').value).toBe('The Cordelia M. Vance Revocable Living Trust');
  });

  it('captures both trustees despite the §55.1-136(C) NOTE + the condo footnote between the recitals', () => {
    expect(fld(r, 'trusteeNames').values).toEqual(['Cordelia M. Vance', 'Atticus R. Vance']);
  });

  it('does NOT surface the §55.1-136(C) NOTE or the condo footnote as a captured field value', () => {
    // The NOTE / footnote are legitimate house-boilerplate, irrelevant to extraction. They appear in no field.
    for (const f of r.fields) {
      if (f.value !== null) {
        expect(f.value).not.toMatch(/55\.1-136/);
        expect(f.value).not.toMatch(/Parking Space/i);
      }
    }
  });
});

describe('E6 certificate-of-trust — FAIL-CLOSED behaviour', () => {
  it('WITHHOLDS the trustee set when the trustee span bled an entity descriptor (isolation failure, no junk)', () => {
    const r = extractDeedIngest(CERT_POLLUTED_TRUSTEE);
    const f = fld(r, 'trusteeNames');
    expect(f.withheld).toBe(true);
    expect(f.value).toBeNull();
  });

  it('routes the document to review (lowConfidence) when the load-bearing trustee set is withheld', () => {
    const r = extractDeedIngest(CERT_POLLUTED_TRUSTEE);
    expect(r.lowConfidence).toBe(true);
    expect(r.warnings.some((w) => /critical_field_unresolved/.test(w))).toBe(true);
  });
});
