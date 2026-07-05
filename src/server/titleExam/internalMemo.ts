/**
 * internalMemo.ts — TITLE-EXAM-1 (T6), the internal exam memo assembler (spec §7.1).
 *
 * Assembles the INTERNAL exam memo from the reconciled findings: labeled AI-ASSISTED / for attorney review;
 * BLUF; requirements / exceptions / informational notes by classification; escalations in the five-field
 * format; the curative roadmap (softened rule — identify requirements, do not draft instruments); the
 * auto-resolved items (visible); the sendability matrix; a scope note. This is NON-FINAL and never sendable —
 * it is the artifact the attorney reviews before approving any client-facing output (NC-3).
 *
 * PURE. Flag-dark by construction. The internal memo is NOT client-facing, so it is not subject to the NC-3e
 * render-blocks (those gate the client email / branded report generated from the APPROVED memo).
 */

import type { ReconciledFinding } from './reconciler.js';
import type { TitleExamClassification } from '../db/schema.js';

export interface InternalMemoInput {
  matterTitle?: string | null;
  jurisdiction?: string | null;
  entityHat?: string | null;
  effectiveDate?: string | null;
  laneMode: 'two_lane' | 'single_lane';
  laneFailureBanner?: string | null;
  incompletenessBanner?: string | null;
  findings: readonly ReconciledFinding[];
  escalationQueue: readonly ReconciledFinding[];
  sendabilityMatrix?: ReadonlyArray<{ sendability: string; count: number; findingTitles: string[] }>;
}

const REQUIREMENT_CLASSES: readonly TitleExamClassification[] = [
  'closing_requirement',
  'recording_requirement',
  'disbursement_condition',
];
const EXCEPTION_CLASSES: readonly TitleExamClassification[] = ['policy_exception'];

function routeFor(classification: TitleExamClassification): string {
  switch (classification) {
    case 'underwriting_escalation':
    case 'policy_exception':
      return 'Underwriter';
    case 'lender_escalation':
      return 'Lender';
    case 'counsel_referral':
      return 'DC / outside counsel';
    default:
      return 'Managing Attorney';
  }
}

/** Render one escalation in the five-field format (§7 / the v2 escalation format). */
function renderEscalationFiveField(f: ReconciledFinding, index: number): string {
  const whyBits = [`classification: ${f.classification}`, `sendability: ${f.sendability}`];
  if (f.judgmentTopics.length > 0) whyBits.push(`judgment topic(s): ${f.judgmentTopics.join(', ')}`);
  const needed: string[] = ['attorney ADOPT / MODIFY / HOLD'];
  if (f.downgraded) needed.push('review of the underlying instrument (this conclusion is abstract-only / OCR-only)');
  const positions: string[] = [];
  if (f.laneAPosition) positions.push(`Lane A: ${f.laneAPosition}`);
  if (f.laneBPosition) positions.push(`Lane B: ${f.laneBPosition}`);
  return [
    `Escalation ${index + 1}: ${f.title}`,
    `  1. Conflict or gap: ${f.detail ?? f.title}${positions.length ? ` [${positions.join(' | ')}]` : ''}`,
    `  2. Why it matters: ${whyBits.join('; ')}`,
    `  3. Current working position: ${f.recommendation ?? 'none until resolved'}`,
    `  4. Needed before action: ${needed.join('; ')}`,
    `  5. Route to: ${routeFor(f.classification)}`,
  ].join('\n');
}

function bulletFinding(f: ReconciledFinding): string {
  const tags: string[] = [f.sourceBasis];
  if (f.downgraded) tags.push('DOWNGRADED');
  if (f.ocrSourcePagePincite) tags.push(f.ocrSourcePagePincite);
  return `- ${f.title} [${tags.join('; ')}] (sendability: ${f.sendability})${f.detail ? `\n    ${f.detail}` : ''}`;
}

/**
 * Build the internal exam memo. Always leads with the AI-assisted label and any lane-failure / incompleteness
 * banner (NC-10), so a single-lane or truncated exam can never read as a complete, corroborated one.
 */
export function buildInternalExamMemo(input: InternalMemoInput): string {
  const out: string[] = [];
  out.push('TITLE EXAMINATION MEMO — AI-ASSISTED DRAFT, FOR ATTORNEY REVIEW AND ADJUDICATION');
  out.push('(NON-FINAL: not a commitment, not sendable, not recordable. The attorney is the examiner of record.)');
  const meta: string[] = [];
  if (input.matterTitle) meta.push(`Matter: ${input.matterTitle}`);
  if (input.jurisdiction) meta.push(`Jurisdiction: ${input.jurisdiction}`);
  if (input.entityHat) meta.push(`Capacity (hat): ${input.entityHat}`);
  if (input.effectiveDate) meta.push(`Examination effective date: ${input.effectiveDate}`);
  if (meta.length) out.push(meta.join(' | '));

  // NC-10 banners first, prominently.
  if (input.laneMode === 'single_lane' && input.laneFailureBanner) {
    out.push('');
    out.push(`!! ${input.laneFailureBanner}`);
  }
  if (input.incompletenessBanner) {
    out.push('');
    out.push(`!! ${input.incompletenessBanner}`);
  }

  const requirements = input.findings.filter((f) => REQUIREMENT_CLASSES.includes(f.classification));
  const exceptions = input.findings.filter((f) => EXCEPTION_CLASSES.includes(f.classification));
  const notes = input.findings.filter(
    (f) => !REQUIREMENT_CLASSES.includes(f.classification) && !EXCEPTION_CLASSES.includes(f.classification),
  );
  const autoResolved = input.findings.filter((f) => f.escalationState === 'auto_resolved');

  out.push('');
  out.push('BLUF');
  out.push(
    `- ${input.escalationQueue.length} judgment escalation(s) require the attorney's decision; ` +
      `${requirements.length} requirement(s) to close/record/disburse; ${exceptions.length} exception(s) to remain; ` +
      `${autoResolved.length} record-resolvable item(s) auto-disposed (below).`,
  );

  out.push('');
  out.push('ESCALATIONS (attorney ADOPT / MODIFY / HOLD required — never auto-resolved)');
  if (input.escalationQueue.length === 0) out.push('- none');
  else input.escalationQueue.forEach((f, i) => out.push(renderEscalationFiveField(f, i)));

  out.push('');
  out.push('REQUIREMENTS TO CLOSE / RECORD / DISBURSE / INSURE');
  if (requirements.length === 0) out.push('- none identified on this record');
  else requirements.forEach((f) => out.push(bulletFinding(f)));

  out.push('');
  out.push('EXCEPTIONS TO REMAIN');
  if (exceptions.length === 0) out.push('- none identified on this record');
  else exceptions.forEach((f) => out.push(bulletFinding(f)));

  out.push('');
  out.push('INFORMATIONAL NOTES / OTHER FINDINGS');
  if (notes.length === 0) out.push('- none');
  else notes.forEach((f) => out.push(bulletFinding(f)));

  // Curative roadmap — softened rule: identify the requirements/likely responsible parties, do NOT draft.
  out.push('');
  out.push('CURATIVE ROADMAP (identification only — no curative instrument is drafted in an exam-only engagement)');
  if (requirements.length === 0) out.push('- none');
  else requirements.forEach((f) => out.push(`- ${f.title}: route to ${routeFor(f.classification)}`));

  out.push('');
  out.push('AUTO-RESOLVED (record-resolvable / housekeeping — shown for full visibility, NC-1)');
  if (autoResolved.length === 0) out.push('- none');
  else autoResolved.forEach((f) => out.push(`- ${f.title} — ${f.autoResolvedRationale ?? 'record-resolvable'}`));

  if (input.sendabilityMatrix && input.sendabilityMatrix.length > 0) {
    out.push('');
    out.push('SENDABILITY MATRIX (NC-4)');
    for (const m of input.sendabilityMatrix) out.push(`- ${m.sendability}: ${m.count}`);
  }

  out.push('');
  out.push('SCOPE NOTE');
  out.push(
    '- Exam-only engagement: this memo identifies title/insurability/closing requirements and exceptions on ' +
      'the record examined; it is not a commitment or policy and undertakes no curative representation. ' +
      'Confirm the examination effective date and whether a bringdown is required before closing, recording, ' +
      'disbursement, or policy issuance. All findings remain subject to the attorney’s adjudication.',
  );
  return out.join('\n');
}
