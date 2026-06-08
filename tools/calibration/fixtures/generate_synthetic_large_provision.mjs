/*
 * GEMINI-BUDGET-CALIBRATION-1 — Increment 1
 * Synthetic large-provision fixture generator (deterministic, prod-content-free).
 *
 * Produces a synthetic commercial-lease-shaped document with NUM_PROVISIONS numbered
 * provisions, each carrying a distinct, deliberately reviewable defect drawn from a fixed
 * template set. Purpose: a committed, shareable, credential-free INPUT that demands a LONG
 * structured reviewer output (one feedback item per material provision), so a reviewer at the
 * 16384-token output ceiling truncates. Unlike the real anonymized lease (local-only), this
 * fixture contains NO real or client content and is fully reproducible — the CI/regression
 * anchor for the demand-curve measurement.
 *
 * Deterministic: no Date.now() / Math.random(); identical bytes on every run.
 *   Regenerate:  node tools/calibration/fixtures/generate_synthetic_large_provision.mjs
 *   Output:      tools/calibration/fixtures/synthetic_large_provision.txt  (committed)
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const NUM_PROVISIONS = 260; // enough that a per-provision review exceeds a 16384-token output

// Fixed defect templates. Each returns clause text containing ONE reviewable issue. Cycled
// deterministically by provision index so the document has varied, individually-flaggable
// problems (drives a reviewer to emit one card per provision → long output → truncation).
const DEFECT_TEMPLATES = [
  (n) => `Tenant shall pay Base Rent of $${(n * 137) % 100000} per month; provided, however, that the figure stated in the Basic Lease Information as $${(n * 137 + 500) % 100000} shall control to the extent of any conflict. The two figures are internally inconsistent and the controlling amount is ambiguous.`,
  (n) => `Landlord may, in its sole and absolute discretion, recharacterize any Operating Expense as a Capital Expense (or the reverse) at any time and without notice, with retroactive effect to the commencement of the Term. No cap, exclusion, or audit right is stated.`,
  (n) => `Tenant shall indemnify, defend, and hold harmless the Landlord Parties from any and all claims of every kind whatsoever, including claims arising solely from the gross negligence or willful misconduct of the Landlord Parties, without limitation as to amount and surviving expiration indefinitely.`,
  (n) => `This Section ${n} incorporates by reference the requirements of Exhibit ${String.fromCharCode(65 + (n % 26))}-${n}, which is referenced throughout this Lease but is not attached and is nowhere defined.`,
  (n) => `Tenant's permitted use is limited to "general office and Related Uses." The term "Related Uses" is capitalized as a defined term but no definition appears anywhere in this Lease.`,
  (n) => `Upon any default, Landlord may accelerate all rent for the remainder of the Term and simultaneously retain the security deposit, re-let the Premises and keep all re-letting proceeds, and recover liquidated damages of three times annual rent. The cumulative remedy may constitute an unenforceable penalty.`,
  (n) => `The governing-law clause in this Section ${n} provides that this Lease is governed by the laws of the State of Delaware, which conflicts with Section 1.${n} stating that the Premises are located in, and this Lease is governed by the laws of, the Commonwealth of Virginia.`,
  (n) => `Tenant waives all rights under any present or future statute affecting commercial tenancies, including any right to notice, cure, redemption, or jury trial, "to the maximum extent permitted and to the extent not permitted, to the maximum extent the parties may agree." The enforceability of the blanket waiver is uncertain.`,
  (n) => `Landlord's consent to assignment or subletting "shall not be unreasonably withheld," but the immediately following sentence states that Landlord may withhold consent "for any reason or no reason in its sole discretion." The two standards are contradictory.`,
  (n) => `The notice provision requires notices to be sent to "the address set forth below," but no address is set forth below or anywhere in this Lease; the blank has not been completed and is material to the operation of the cure periods.`,
  (n) => `Tenant shall maintain commercial general liability insurance with limits of not less than $______ per occurrence. The limit blank is left to be filled in and is a non-routine, material blank (not an execution blank).`,
  (n) => `Section ${n}(c) provides that time is of the essence as to all of Tenant's obligations but expressly not as to any of Landlord's obligations, including Landlord's obligation to deliver possession, with no outside delivery date stated.`,
];

const ARTICLE_TITLES = [
  'PREMISES AND TERM', 'RENT AND ADDITIONAL RENT', 'OPERATING EXPENSES', 'USE AND COMPLIANCE',
  'MAINTENANCE AND REPAIRS', 'ALTERATIONS', 'INSURANCE AND INDEMNITY', 'CASUALTY AND CONDEMNATION',
  'ASSIGNMENT AND SUBLETTING', 'DEFAULT AND REMEDIES', 'SUBORDINATION AND ESTOPPEL', 'MISCELLANEOUS',
];

function build() {
  const lines = [];
  lines.push('SYNTHETIC COMMERCIAL LEASE — CALIBRATION FIXTURE (NOT A REAL DOCUMENT)');
  lines.push('GEMINI-BUDGET-CAL-1 Increment 1 — prod-content-free, deterministically generated.');
  lines.push('');
  lines.push('THIS LEASE AGREEMENT (this "Lease") is made by and between PLACEHOLDER LANDLORD LLC, a');
  lines.push('placeholder limited liability company ("Landlord"), and PLACEHOLDER TENANT LLC, a placeholder');
  lines.push('limited liability company ("Tenant"). All names, figures, and references below are synthetic');
  lines.push('and contain no real or client information. Each numbered provision contains at least one');
  lines.push('deliberately reviewable drafting or legal-sufficiency issue.');
  lines.push('');

  const perArticle = Math.ceil(NUM_PROVISIONS / ARTICLE_TITLES.length);
  let provision = 0;
  for (let a = 0; a < ARTICLE_TITLES.length && provision < NUM_PROVISIONS; a += 1) {
    lines.push('');
    lines.push(`ARTICLE ${a + 1} — ${ARTICLE_TITLES[a]}`);
    for (let p = 0; p < perArticle && provision < NUM_PROVISIONS; p += 1) {
      provision += 1;
      const sec = `${a + 1}.${p + 1}`;
      const tmpl = DEFECT_TEMPLATES[provision % DEFECT_TEMPLATES.length];
      lines.push(`${sec}. ${tmpl(provision)}`);
    }
  }

  lines.push('');
  lines.push('IN WITNESS WHEREOF, the parties have executed this synthetic fixture as of the date first');
  lines.push('written above (no date is written above; this is a pre-execution calibration draft).');
  lines.push('');
  lines.push(`[End of synthetic fixture — ${provision} numbered provisions.]`);
  return lines.join('\n') + '\n';
}

const out = build();
const target = join(HERE, 'synthetic_large_provision.txt');
writeFileSync(target, out);
// eslint-disable-next-line no-console
console.log(`wrote ${target} (${out.length} chars, ~${Math.round(out.length / 4)} est. tokens, ${NUM_PROVISIONS} provisions)`);
