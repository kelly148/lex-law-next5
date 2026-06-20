/**
 * Verified VA per-locality deed recordability KB (FOLD-DEED-1 — locality seed).
 *
 * SOURCE OF TRUTH — the model is NEVER the source. Every datum is transcribed VERBATIM from the operator-
 * supplied, verified compilation committed at docs/VA_Deed_Locality_and_RON_Source_VERIFIED_2026-06-19.docx
 * (Part C — the five localities, plus Part A statewide). Only [VERIFIED] items support a recordability
 * determination; [UNVERIFIED] items are carried as ADVISORIES (they never clear a prong — they keep that
 * point fail-closed until the attorney confirms).
 *
 * SCOPE: the DEED INSTRUMENT only. Recording COVER SHEETS are OUT OF SCOPE (prepared by the firm's
 * post-closing department) — no cover-sheet rule is built or gated here. With cover sheets excluded, each of
 * the five localities has VERIFIED deed-instrument recordability coverage (Fairfax/Arlington/Loudoun publish
 * an on-deed first-page delta; Alexandria/PWC ride the verified statewide § 17.1-223 first-page rules).
 */

export interface VaLocalityKb {
  key: string;
  name: string;
  /** Deed-instrument recordable: the locality's [VERIFIED] items support the DEED itself being in recordable
   *  form (cover sheets excluded). True for all five under that scope. */
  deedInstrumentRecordable: boolean;
  /** On-deed parcel-identifier format (the clerk indexes against it; § 17.1-252 locality-conditional). */
  parcelId: { format: string; verified: boolean };
  /** On-deed first-page rules the locality enforces ([VERIFIED]); Alexandria/PWC ride statewide § 17.1-223. */
  firstPageRules: readonly string[];
  /** Electronic recording: e-recording is permissive — RON-recordability requires the locality to operate it. */
  eRecording: { available: boolean; vendors: readonly string[]; verified: boolean };
  /** [VERIFIED] fee/tax lines, for reference (post-closing computes; not a gate prong). */
  fees: readonly string[];
  /** [VERIFIED] standout drafting quirks. */
  quirks: readonly string[];
  /** [UNVERIFIED]-derived advisories — surfaced, NEVER blocking (the attorney confirms from practice). */
  advisories: readonly string[];
  /** The official source cite for this locality's entry. */
  source: string;
}

// Statewide § 17.1-223 on-deed first-page rules (Part A2/A3) — the verified default that Alexandria/PWC ride.
const STATEWIDE_FIRST_PAGE: readonly string[] = [
  'Surname of each individual party underscored or in ALL CAPS in the first identifying clause (§ 17.1-223(A))',
  'Consideration and actual value stated on the first page for § 58.1-801 / § 58.1-807 instruments (§ 17.1-223(A))',
  'Any recordation-tax exemption clearly stated on the face of the deed (§ 17.1-223(A))',
  'Each indexed party named in the first clause + identified as grantor/grantee/both (§ 17.1-223(A))',
  'For residential ≤4-unit deeds: first-page preparer statement — owner or VA-licensed attorney + VSB# (§ 17.1-223(B)(iii))',
];

export const VA_LOCALITIES: readonly VaLocalityKb[] = [
  {
    key: 'fairfax_county',
    name: 'Fairfax County',
    deedInstrumentRecordable: true,
    parcelId: { format: 'Tax Map number (distinguishes Fairfax County vs. Fairfax City; § 17.1-252)', verified: true },
    firstPageRules: [
      "Grantee's current address in the LEFT MARGIN of the first page",
      'Consideration (and any assumption balance) in the LEFT MARGIN of the first page',
      'Exemption code on the first page',
      'Refinance deeds of trust: first-page refinance statement citing the book/page where the original-debt tax was paid (§ 58.1-803(E)) — deeds of trust are out of v1 scope, carried as reference',
      ...STATEWIDE_FIRST_PAGE,
      'Margins min 1″ top/left/bottom, 0.5″ right; paper 8.5×11 to 8.5×14, white unglazed, black print 9-pt+',
      'Original signatures in dark blue or black ink, notarized, names printed beneath; NO red/highlighter ink, NO SSNs; trustee full address for trusts (§ 55.1-317)',
    ],
    eRecording: { available: true, vendors: ['Fairfax Electronic Filing System (EFS)'], verified: true },
    fees: [
      "Clerk's fee $23 (1–10 pp) / $37 (11–30) / $57 (31+); deed processing $20; open-space $3 (CCR A-50, eff. 7/1/2025)",
      'State tax $0.25/$100; local tax $0.083/$100 (§ 58.1-3800); grantor tax $0.50/$500',
      'Regional Congestion Relief $0.10/$100 (§ 58.1-802.4); WMATA Capital Fee $0.10/$100 (§ 58.1-802.3); $1 transfer fee (§ 58.1-3314(3)); $5 eRecording fee (§ 17.1-258.3:1)',
    ],
    quirks: ['Fairfax operates its OWN Electronic Filing System (EFS); all land-record types except multi-jurisdiction docs and docs with highway plats'],
    advisories: ['Pre-recording GIS/assessment stamp not found on the Fairfax source — not seeded; confirm with the clerk if it becomes load-bearing'],
    source: 'fairfaxcounty.gov/circuit — Recordation Requirements (CCR A-60), Fees (CCR A-50)',
  },
  {
    key: 'city_of_alexandria',
    name: 'City of Alexandria',
    deedInstrumentRecordable: true,
    parcelId: { format: 'Tax Map / Parcel ID — exact on-deed format not published by the city; statewide § 17.1-252 governs', verified: false },
    firstPageRules: [...STATEWIDE_FIRST_PAGE],
    eRecording: { available: true, vendors: ['CSC E-Recording', 'Simplifile'], verified: true },
    fees: [
      'State tax $0.25/$100 of price or FMV (greater); CITY tax 1/3 of state = $0.083/$100; grantor tax $0.50/$500 excluding liens + NoVA regional grantor add-on $0.10/$100 (§ 58.1-802.3)',
      'Itemized line fees per the statewide Circuit Court Deed Fee Schedule (Appendix C) + Deed Fee Calculator; $0.50/page, certification $2',
    ],
    quirks: ['"No deed is recorded without payment of the tax." Submission: Clerk of Circuit Court, 520 King Street, Room 307, Alexandria 22314, or CSC/Simplifile'],
    advisories: [
      'Alexandria parcel-ID exact on-deed format is attorney-confirmable (not published on the official source)',
      'No Alexandria-specific first-page checklist published — the deed body rides the verified statewide § 17.1-223 rules',
    ],
    source: 'alexandriava.gov/courts (land records); alexandriava.gov/real-estate/recordation-tax',
  },
  {
    key: 'arlington_county',
    name: 'Arlington County',
    deedInstrumentRecordable: true,
    parcelId: { format: 'RPC (Real Property Code), 8 digits (Arlington Real Estate Assessments)', verified: true },
    firstPageRules: [
      'Mandatory preparer statement on the first page — owner or VA-licensed attorney + VSB# (deeds of ≤4 residential units)',
      'Preparer contact PHONE number on the first page of ALL documents',
      ...STATEWIDE_FIRST_PAGE,
    ],
    eRecording: { available: true, vendors: ['Simplifile', 'CSC'], verified: true },
    fees: ['Arlington publishes no granular dollar fee schedule — use the statewide Deed Fee Calculator; copies $0.50/page (+$2 certification)'],
    quirks: [
      'Cover sheet NOT required since January 19, 2016 (reference only — cover sheets are out of scope here)',
      'Submission: Land Records Division, 1425 N. Courthouse Rd, Suite 6200, Arlington 22201; checks payable to "Clerk, Arlington Circuit Court". Arlington also records Falls Church land records',
    ],
    advisories: [
      'Margins / return-address numerics not itemized on the Arlington source (defers to the Code) — attorney-confirmable',
      'Itemized dollar fees + the local/regional tax restatement not on the official page — use the verified statewide rates; do not seed third-party fee figures',
    ],
    source: 'arlingtonva.us — Circuit Court Land Records Services + FAQs + Forms',
  },
  {
    key: 'loudoun_county',
    name: 'Loudoun County',
    deedInstrumentRecordable: true,
    parcelId: { format: 'GPIN, 12-digit format xxx-xx-xxxx-xxx, required on all deeds (§ 17.1-252)', verified: true },
    firstPageRules: [
      'Consideration on the first page (§ 58.1-802A)',
      'Current fair-market / assessed value for deeds conveying real property',
      'Exemption codes on the first page',
      "Grantee's address",
      'Parties legible and identified by role',
      'Original signatures in dark blue/black ink, properly acknowledged',
      'Legal description and Loudoun jurisdiction stated',
      'Deeds of trust must name a Virginia trustee with full address — deeds of trust are out of v1 scope, carried as reference',
      ...STATEWIDE_FIRST_PAGE,
    ],
    eRecording: { available: true, vendors: [], verified: true },
    fees: ['Per-page/tax numbers defer to the statewide Appendix-C schedule + Deed Calculator'],
    quirks: [
      'Appraisal quirk: if an appraisal sets "actual value", submit the draft deed at least 3 business days before recording and list all three values — consideration, assessment, and appraisal',
      'Electronically notarized documents accepted ONLY via e-recording',
      'Subdivision plats must be approved within the last 6 months; no SSNs (auto-reject, § 17.1-227); separately-executed instruments recorded separately; Loudoun will not record its own certified copies; fee overage accepted up to $24.99',
      'Submission: 18 E. Market Street, Leesburg 20176 (mail P.O. Box 550, Leesburg 20178); self-addressed prepaid return package required',
    ],
    advisories: [
      'Deed margin/font numerics not published (Loudoun relies on the Library of Virginia standards, 17VAC15-61) — attorney-confirmable',
      'E-recording vendor names not listed on the Loudoun page ("authorized e-recording provider(s)") — confirm the current provider',
    ],
    source: 'loudoun.gov/1156 — Recording Land Records; Loudoun Recording Requirements PDF (Oct 2019)',
  },
  {
    key: 'prince_william_county',
    name: 'Prince William County',
    deedInstrumentRecordable: true,
    parcelId: { format: 'GPIN = "Grid Parcel Identification Number" (centroid-based), example xxxx-xx-xxxx', verified: true },
    firstPageRules: [...STATEWIDE_FIRST_PAGE],
    eRecording: { available: true, vendors: ['Simplifile', 'ePN (goEPN)', 'CSC'], verified: true },
    fees: [
      'State tax $0.25/$100 (refinance $0.18/$100); local tax 1/3 of state (§ 58.1-3800); grantor tax $0.50/$500',
      'Regional Congestion Relief $0.10/$100 (§ 58.1-802.4); WMATA Fee $0.10/$100 (§ 58.1-802.3)',
      "Clerk's fee $23/$37/$57; transfer fee $1; Technology Trust Fund $5; deed processing $20; open-space $3; paper filing $5/instrument; copies $0.50/page, certification $2, exemplified $2.50 (full itemized official table)",
    ],
    quirks: [
      'GPIN lifecycle (drafting risk): when a parcel\'s boundaries change, the old GPIN ceases and a new one is assigned only AFTER the approved plat records and GIS updates (can take several weeks) — a freshly subdivided parcel may not yet have a stable GPIN',
      'E-recording all documents EXCEPT plats (plats are paper only). Submission: Judicial Center, 9311 Lee Ave., Room 300, Manassas 20110',
    ],
    advisories: [
      'Granular first-page formatting not itemized in readable text (FAQ answers are JavaScript-rendered) — the deed body rides the verified statewide § 17.1-223 rules; confirm specifics from practice',
      'Pre-recording GPIN certification gate not found ("the clerk only checks that [a deed] is signed and notarized") — not required, but confirm if load-bearing',
    ],
    source: 'pwcva.gov/department/circuit-court — land-records-fees; land-records-erecording; gis/gpin',
  },
];

const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, ' ').replace(/[.,;]/g, '').trim();

/** Look up a locality by display name or key (normalized). */
export function getVaLocality(name: string | null | undefined): VaLocalityKb | null {
  if (!name) return null;
  const n = norm(name);
  return VA_LOCALITIES.find((l) => norm(l.name) === n || l.key === n.replace(/ /g, '_')) ?? null;
}

/** Is the named locality one whose [VERIFIED] items support deed-instrument recordability? */
export function isVaDeedInstrumentRecordableLocality(name: string | null | undefined): boolean {
  const l = getVaLocality(name);
  return l !== null && l.deedInstrumentRecordable;
}
