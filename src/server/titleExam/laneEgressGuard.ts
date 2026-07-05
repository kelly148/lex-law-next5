/**
 * laneEgressGuard.ts — TITLE-EXAM-1 (T3), PB-3 research-lane retrieval egress rule (the research-capable
 * examiner lane, whichever provider fills it per §4b).
 *
 * Web research queries are an egress channel the provider allowlist does not see: a query containing an
 * address, decedent name, or case/instrument number is NPI leaving through unaudited search infrastructure.
 * PB-3 (adopted, blocking): NO client identifiers, addresses, party names, or case/instrument numbers in any
 * retrieval query — legal-proposition queries only. The rule is written into the research-capable lane
 * instruction (lanePrompts.ts) AND checked at reconciliation. This module is that deterministic check.
 *
 * PURE. No I/O. Flag-dark by construction.
 */

export type EgressViolationKind = 'party_name' | 'address' | 'case_number' | 'instrument_number';

export interface EgressQueryViolation {
  kind: EgressViolationKind;
  /** The offending substring/pattern found in the query. */
  matched: string;
}

export interface KnownMatterIdentifiers {
  partyNames?: readonly string[];
  addresses?: readonly string[];
  caseNumbers?: readonly string[];
  instrumentNumbers?: readonly string[];
}

export interface EgressQueryResult {
  allowed: boolean;
  violations: EgressQueryViolation[];
}

// Generic identifier PATTERNS — flag NPI-shaped content even when the matter's identifier list is incomplete.
// Deliberately conservative toward flagging (PB-3 is a hard egress rule; a false positive costs a rephrase,
// a false negative leaks NPI).
const ADDRESS_RE =
  /\b\d{1,6}\s+([A-Za-z0-9.'-]+\s+){0,3}(street|st|avenue|ave|road|rd|drive|dr|boulevard|blvd|lane|ln|court|ct|way|place|pl|terrace|ter|circle|cir|highway|hwy)\b(\s+(n|s|e|w|nw|ne|sw|se))?/i;
// Court/case numbers like 06-0416339, 2021-CA-001234, 1:21-cv-00345.
const CASE_NUMBER_RE = /\b(\d{1,4}[:-]\d{2,4}[-\s]?[A-Za-z]{0,3}[-\s]?\d{3,7}|\d{2}-\d{6,8})\b/;
// Land-records instrument references like "DB 1234 PG 56", "Instrument No. 20040012345", "Book 12 Page 34".
const INSTRUMENT_RE =
  /\b(d\.?b\.?\s*\d+\s*(pg|pg\.|page)\s*\d+|instrument\s*(no\.?|number|#)\s*\d+|book\s*\d+\s*page\s*\d+|liber\s*\d+\s*folio\s*\d+)\b/i;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Check a research/retrieval query for PB-3 violations. Flags any of the matter's known identifiers that
 * appear (case-insensitive), plus generic address / case-number / instrument-number patterns. Returns
 * allowed=false with the specific violations when the query must NOT be sent as-is.
 */
export function checkRetrievalQuery(
  query: string,
  known: KnownMatterIdentifiers = {},
): EgressQueryResult {
  const violations: EgressQueryViolation[] = [];
  const q = query ?? '';
  const qLower = q.toLowerCase();

  const scanKnown = (values: readonly string[] | undefined, kind: EgressViolationKind): void => {
    for (const v of values ?? []) {
      const needle = v.trim();
      if (needle.length === 0) continue;
      if (qLower.includes(needle.toLowerCase())) {
        violations.push({ kind, matched: needle });
      } else if (kind === 'party_name') {
        // Also catch any single name token of length >= 3 (surnames leak even without the full name).
        for (const token of needle.split(/\s+/)) {
          if (token.length >= 3 && new RegExp(`\\b${escapeRegExp(token)}\\b`, 'i').test(q)) {
            violations.push({ kind, matched: token });
            break;
          }
        }
      }
    }
  };

  scanKnown(known.partyNames, 'party_name');
  scanKnown(known.addresses, 'address');
  scanKnown(known.caseNumbers, 'case_number');
  scanKnown(known.instrumentNumbers, 'instrument_number');

  const addressM = ADDRESS_RE.exec(q);
  if (addressM) violations.push({ kind: 'address', matched: addressM[0].trim() });
  const instrumentM = INSTRUMENT_RE.exec(q);
  if (instrumentM) violations.push({ kind: 'instrument_number', matched: instrumentM[0].trim() });
  // Run the case-number pattern last and skip it if an instrument match already covers the same span.
  const caseM = CASE_NUMBER_RE.exec(q);
  if (caseM && !(instrumentM && instrumentM[0].includes(caseM[0]))) {
    violations.push({ kind: 'case_number', matched: caseM[0].trim() });
  }

  return { allowed: violations.length === 0, violations };
}

/** The PB-3 rule text embedded in the research-capable lane instruction. */
export const PB3_EGRESS_RULE = [
  'RETRIEVAL EGRESS RULE (mandatory): When you use research/browse tools, your query is an egress channel',
  'the firm cannot audit. NEVER put client identifiers in a query — no party names, decedent names,',
  'property addresses, parcel/tax IDs, or case/instrument/recording numbers. Ask ONLY neutral',
  'legal-proposition questions (e.g. "DC personal representative deed requirement post-1995 death"), never',
  'matter-identifying ones. If a lookup cannot be framed as a de-identified legal proposition, do not run it —',
  'state the record lacks the authority and flag it for operator confirmation instead.',
].join(' ');
