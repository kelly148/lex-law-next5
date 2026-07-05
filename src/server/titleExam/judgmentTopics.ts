/**
 * judgmentTopics.ts — TITLE-EXAM-1 (T4), the NC-1 two-tier conflict taxonomy.
 *
 * NC-1 (the spine finding): conflicts split into
 *   (a) record-resolvable / housekeeping — may AUTO-RESOLVE per this written taxonomy (format, caveat scope,
 *       items the controlling instrument directly answers), with the rationale recorded + visible; and
 *   (b) JUDGMENT conflicts — anything touching vesting/tenancy, marital rights, estate/fiduciary/entity
 *       authority, insurability, lien sufficiency/release theory, deed construction, or anything adding or
 *       removing a requirement or exception — which are ESCALATE-ONLY: never auto-resolved, always routed to
 *       the attorney ADOPT/MODIFY/HOLD queue.
 *
 * The tier is decided DETERMINISTICALLY here (topic match OR an explicit reconciler judgment flag), and the
 * code OVER-escalates: under-escalation is the dangerous error (the reconciler mislabeling a judgment call as
 * housekeeping must never cause a silent auto-adopt). PURE. Flag-dark by construction.
 */

export type ConflictTier = 'judgment' | 'record_resolvable';

/** The escalate-only judgment topics (NC-1 / §4a always-escalate set). Recognizers are deliberately WIDE. */
export const JUDGMENT_TOPIC_PATTERNS: ReadonlyArray<{ topic: string; pattern: RegExp }> = [
  {
    topic: 'vesting/tenancy',
    pattern: /\b(vest(ing|ed)?|tenanc(y|ies)|tenants?\s+(in\s+common|by\s+the\s+entirety)|joint\s+tenan\w*|survivorship|how\s+title\s+is\s+held)\b/i,
  },
  {
    topic: 'marital rights',
    pattern: /\b(marital|spous(e|es|al)|dower|curtesy|homestead|elective\s+share|joinder)\b/i,
  },
  {
    topic: 'estate/fiduciary/entity authority',
    // Catches the common abstract abbreviation "PR deed" / "PR's deed" and the bare word "estate" (a core
    // judgment topic — DC estate conveyances), while excluding the ubiquitous noise phrase "real estate".
    pattern:
      /\b(personal\s+representative|PR'?s?\s+deed|executor|executrix|administrat(or|rix)|fiduciary|power\s+of\s+sale|letters\s+testamentary|trustee|entity\s+authority|authority\s+to\s+convey|probate|intestate|testate|testac\w*|heir(s|ship)?|decedent|(?<!real\s)estate)\b/i,
  },
  {
    topic: 'insurability',
    pattern: /\b(insurab(le|ility)|marketable\s+title|insure|underwrit(er|ing)\s+(risk|position|approval)|clear\s+to\s+insure)\b/i,
  },
  {
    topic: 'lien sufficiency/release theory',
    pattern:
      /\b(lien|deed\s+of\s+trust|mortgage|releas(e|ed)|satisf(action|ied)|payoff|automatic\s+release|statutory\s+release|foreclos(ure|ed)|extinguish\w*|priority|judgment\s+lien|super-?priority)\b/i,
  },
  {
    topic: 'deed construction',
    pattern:
      /\b(deed\s+construction|legal\s+description|metes\s+and\s+bounds|habendum|granting\s+clause|scrivener|reservation|out-?conveyance|acreage\s+discrepancy|ambiguous\s+description)\b/i,
  },
  {
    topic: 'requirement/exception change',
    pattern:
      /\b((add(ing|s|ed)?|remov(e|ing|ed)|new|waiv(e|ing|ed)|delet(e|ing|ed))\s+(a\s+|the\s+)?(requirement|exception|condition))\b/i,
  },
];

/** The record-resolvable / housekeeping taxonomy — the ONLY things that may auto-resolve (NC-1). Documented
 *  so the auto-resolve rationale can cite which category applied. */
export const RECORD_RESOLVABLE_CATEGORIES: ReadonlyArray<{ category: string; description: string }> = [
  { category: 'format', description: 'wording/format/label differences that do not change the substance of a finding' },
  { category: 'caveat_scope', description: 'the breadth of a non-substantive caveat both lanes already agree on' },
  {
    category: 'instrument_directly_answers',
    description: 'a discrepancy the controlling recorded instrument in the file resolves on its face',
  },
  { category: 'informational_note', description: 'a purely informational note with no closing/recording/insurability consequence' },
];

/** Topics matched in a piece of text (title + detail). */
export function matchedJudgmentTopics(text: string): string[] {
  const t = text ?? '';
  const hits: string[] = [];
  for (const { topic, pattern } of JUDGMENT_TOPIC_PATTERNS) {
    if (pattern.test(t)) hits.push(topic);
  }
  return hits;
}

export function isJudgmentTopic(text: string): boolean {
  return JUDGMENT_TOPIC_PATTERNS.some(({ pattern }) => pattern.test(text ?? ''));
}

/**
 * Decide a finding's conflict tier. JUDGMENT when EITHER the reconciler flagged it a judgment conflict OR any
 * judgment topic is matched in its text — the OR is the over-escalation guard (a reconciler that mislabels a
 * judgment call as housekeeping cannot cause an auto-resolve). record_resolvable only when NEITHER holds.
 */
export function classifyConflictTier(
  finding: { title?: string; detail?: string | null },
  reconcilerJudgmentFlag = false,
): ConflictTier {
  const text = `${finding.title ?? ''}\n${finding.detail ?? ''}`;
  if (reconcilerJudgmentFlag || isJudgmentTopic(text)) return 'judgment';
  return 'record_resolvable';
}
