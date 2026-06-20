/**
 * Verified VA RON / e-recording KB (FOLD-DEED-1 — RON seed).
 *
 * SOURCE OF TRUTH — the model is NEVER the source. Every datum is transcribed VERBATIM from Part B of the
 * verified source committed at docs/VA_Deed_Locality_and_RON_Source_VERIFIED_2026-06-19.docx. Acknowledgment
 * forms are STRUCTURAL templates carrying the statutory text with blanks (____) — the notary specifics are
 * NEVER auto-filled. The VITA e-recording format standard (reported SEC505) is [UNVERIFIED] → carried as an
 * advisory, NOT a hard-encoded format requirement. Indecomm/Kofile are NOT seeded (unconfirmed as VA portals).
 *
 * GATING (in deedKb.ts / the evaluator): RON / e-notary recordability requires BOTH (a) the recording locality
 * actually operating an eRecording System (e-recording is permissive — Part C), and (b) the § 47.1-16
 * e-certificate recitals affirmed. URPERA (§§ 55.1-661–664) makes a RON deed recordable on the same footing as
 * paper — no special statutory barrier.
 */

export const RON_PROVENANCE = {
  source: 'docs/VA_Deed_Locality_and_RON_Source_VERIFIED_2026-06-19.docx',
  jurisdiction: 'VA',
  asOf: 'Virginia Code as currently in force per the source (fetched June 19, 2026); verify before relying',
} as const;

// B1 — RON authority (Title 47.1).
export const RON_AUTHORITY: readonly { citation: string; subject: string }[] = [
  { citation: 'Va. Code § 47.1-13(D)', subject: 'A notary commissioned as an electronic notary by the Secretary of the Commonwealth may perform RON; the act is deemed performed in Virginia and governed by Virginia law.' },
  { citation: 'Va. Code § 47.1-7', subject: 'Registration to perform RON is via the Secretary of the Commonwealth\'s form.' },
  { citation: 'Va. Code § 47.1-6.1', subject: 'RON standards are set by the Secretary with VITA assistance.' },
  { citation: 'Va. Code § 47.1-2', subject: 'The video-and-audio identity standard + KBA live in the definition of "satisfactory evidence of identity".' },
  { citation: 'Va. Code § 47.1-12', subject: 'Notarial powers, including taking acknowledgments.' },
];

// B2 — Acknowledgment certificate forms (structural templates carrying the statutory text; blanks NOT auto-filled).
export interface VaAcknowledgmentForm {
  key: string;
  citation: string;
  label: string;
  template: string; // statutory text with ____ blanks — the notary specifics are filled by the attorney/notary, never by the system
}
export const ACKNOWLEDGMENT_FORMS: readonly VaAcknowledgmentForm[] = [
  {
    key: 'long_form',
    citation: 'Va. Code § 55.1-612(1)',
    label: 'The fuller § 55.1-612(1) statutory individual acknowledgment certificate (substantial compliance suffices)',
    template:
      'I, ________, clerk (or deputy clerk or a commissioner in chancery) of the ________ court, (or a notary public) for the county (or city) aforesaid, in the state (or territory or district) of ________, do certify that E.F., … whose name … is signed to the writing above … bearing date on the ______ day of ____, has acknowledged the same before me in my county (or city) aforesaid. Given under my hand this ______ day of ____.',
  },
  {
    key: 'short_form',
    citation: 'Va. Code § 55.1-619(3)',
    label: 'The § 55.1-619(3) "acknowledged before me" short form — any certificate containing those words or their substantial equivalent',
    template: 'Commonwealth of Virginia, City/County of ________, acknowledged before me by ________ this ____ day of ____.',
  },
];

// B2 — the substantive content the certifier must certify.
export const ACKNOWLEDGMENT_CONTENT = {
  citation: 'Va. Code § 55.1-618',
  subject: 'The certifier must certify that the person appeared and acknowledged execution, and was known or satisfactorily identified.',
} as const;

// B3 — electronic / remote notarial certificate recitals (§ 47.1-16) — REQUIRED for an e/RON certificate.
export const E_CERTIFICATE_RECITALS = {
  citation: 'Va. Code § 47.1-16',
  requirements: [
    'The county or city in Virginia where the notary was physically located at the time of the act',
    'Whether the notarization was done in person or by remote online notarization (RON)',
    'The electronic signature/seal attached so any later change to the document is evident (tamper-evident, independently verifiable); no physical/electronic seal image is required (§ 55.1-662(C))',
  ],
} as const;

// B4 — URPERA equivalence (§§ 55.1-661–664): a RON deed is recordable on the same footing as paper.
export const URPERA_EQUIVALENCE: readonly { citation: string; subject: string }[] = [
  { citation: 'Va. Code § 55.1-662(A)', subject: 'An electronic land record satisfies any "original / paper / writing" precondition.' },
  { citation: 'Va. Code § 55.1-662(B)', subject: 'An electronic signature satisfies any signature requirement.' },
  { citation: 'Va. Code § 55.1-662(C)', subject: 'Electronic notarization satisfies any notarization/acknowledgment requirement; no stamp/seal image is required.' },
  { citation: 'Va. Code § 55.1-663', subject: 'A clerk who implements an eRecording System complies with VITA standards and must continue to accept paper (both in the same indices).' },
  { citation: 'Va. Code § 55.1-664', subject: 'VITA develops the uniform standards in consultation with the clerks (considering PRIA standards).' },
];

// B5 — e-recording submitter portals ([VERIFIED] on official clerk pages); the Code names no vendor.
export const E_RECORDING_SUBMITTERS: readonly string[] = ['Simplifile', 'CSC (Corporation Service Company)', 'ePN (eRecording Partners Network)'];

// B5 — [UNVERIFIED] items carried as advisories (NEVER hard-encoded as a blocker).
export const RON_ADVISORIES: readonly string[] = [
  'The VITA "Virginia Real Property Electronic Recording Standard" (reported as SEC505) and any document-format / resolution requirement are UNVERIFIED — do NOT hard-encode a format requirement; the clerk must enter a filing agreement under § 17.1-258.3:1(A). Confirm before relying.',
  'Indecomm and Kofile are NOT confirmed as Virginia deed-submitter portals — not seeded.',
];
