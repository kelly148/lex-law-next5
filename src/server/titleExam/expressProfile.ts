/**
 * expressProfile.ts — TITLE-EXAM-1 (T8), the title-specific ALWAYS-ESCALATE profile for the platform Express
 * auto-review loop (§4a).
 *
 * §4a inherits the platform bounded draft→review→revise loop unchanged (no new flag; rides
 * AUTO_REVIEW_LOOP_ENABLED + EXPRESS_DURABLE_RECORDS_ENABLED + the E8 ship gate). The NC-1 auto-disposition
 * happens INSIDE the T4 reconciler — so only the synthesized memo + its escalations enter the loop, and the
 * platform loop runs the mechanical critique round. This module is the safety net: the title ALWAYS-ESCALATE
 * set, most of which is NOT a text-locus property (abstract-only/OCR-only basis, an unverified citation, a
 * cross-matter seed), rides the ADDITIVE `modelEscalates` hint — it can only RAISE an escalation through the
 * platform gate, never authorize an auto-adopt. Widening the platform Class-A auto-adopt is deliberately NOT
 * done here (that would be a new load-bearing decision — a potential §3.1 re-fire).
 *
 * PURE. Flag-dark by construction; no model literal.
 */

import { isJudgmentTopic, matchedJudgmentTopics } from './judgmentTopics.js';

/** The always-escalate set (§4a) — documentation of what this profile forces to escalate. */
export const TITLE_EXAM_ALWAYS_ESCALATE = [
  'vesting/tenancy, marital rights, estate/fiduciary/entity authority, insurability, lien sufficiency/release theory, deed construction, requirement/exception change (judgment conflicts)',
  'anything resting on abstract-only or OCR-only source basis (NC-8/NC-9)',
  'any externally-verified citation not yet human-checked',
  'any cross-matter seed fact (NC-7)',
] as const;

export interface AlwaysEscalateInput {
  title?: string;
  detail?: string | null;
  isJudgmentConflict?: boolean;
  sourceBasis?: string;
  downgraded?: boolean;
  ocrDerived?: boolean;
  /** A research-lane externally-verified proposition. */
  externallyVerified?: boolean;
  /** Whether the attorney has human-verified that citation. */
  humanVerified?: boolean;
  seedContaminationFlag?: boolean;
}

export interface AlwaysEscalateVerdict {
  /** True → set modelEscalates:true on the loop suggestion (forces escalate through the gate). */
  escalate: boolean;
  reasons: string[];
}

const ABSTRACT_OR_OCR_BASES = new Set(['abstractor_stated', 'ocr_extracted']);

/**
 * Decide whether a finding/suggestion must ALWAYS escalate under the title profile. Escalates on ANY of: a
 * judgment conflict (flag or topic); an abstract-only / OCR-only source basis; an unverified externally-
 * verified citation; a cross-matter seed. The result is an ADDITIVE escalation hint — it never authorizes an
 * auto-adopt, only forces escalation.
 */
export function shouldAlwaysEscalate(input: AlwaysEscalateInput): AlwaysEscalateVerdict {
  const reasons: string[] = [];
  const text = `${input.title ?? ''}\n${input.detail ?? ''}`;

  if (input.isJudgmentConflict === true || isJudgmentTopic(text)) {
    const topics = matchedJudgmentTopics(text);
    reasons.push(`judgment conflict${topics.length ? ` (${topics.join(', ')})` : ''}`);
  }
  if (
    (input.sourceBasis != null && ABSTRACT_OR_OCR_BASES.has(input.sourceBasis)) ||
    input.downgraded === true ||
    input.ocrDerived === true
  ) {
    reasons.push('abstract-only / OCR-only source basis (NC-8/NC-9)');
  }
  if (input.externallyVerified === true && input.humanVerified !== true) {
    reasons.push('externally-verified citation not yet human-checked');
  }
  if (input.seedContaminationFlag === true || input.sourceBasis === 'prior_matter_seed') {
    reasons.push('cross-matter seed fact (NC-7)');
  }

  return { escalate: reasons.length > 0, reasons };
}
