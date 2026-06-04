/**
 * evaluatorPrompt — MR-CAL-5C
 *
 * Builds the system/user prompts for the advisory evaluator. The evaluator
 * SYNTHESIZES multiple reviewers' feedback for the supervising attorney — it never
 * decides, never rewrites the document, and never treats a business choice as a
 * defect (P8-T10 separation principle). Output is constrained to the
 * EvaluatorOutputSchema { dispositions: [{ suggestionId, disposition, synthesisBody }] }.
 */

/** Minimal shape of a persisted reviewer-feedback row needed to build the prompt. */
export interface EvaluatorPromptFeedbackRow {
  reviewerRole: string;
  reviewerTitle: string;
  suggestions: Array<{
    suggestionId: string;
    title: string;
    body: string;
    severity?: string | undefined;
  }>;
}

export function buildEvaluatorSystemPrompt(): string {
  return [
    'You are an advisory legal-review EVALUATOR. Several AI reviewers have independently',
    'produced feedback on ONE draft of a legal document. Your sole job is to help the',
    'supervising attorney by SYNTHESIZING that feedback — never by deciding.',
    '',
    'For EACH reviewer suggestion (identified by its exact suggestionId), produce:',
    '  - disposition: one of',
    '      "adopt"   — reviewers broadly agree this is correct and high-value to act on;',
    '      "reject"  — low-value, redundant, or a misread of the document/law;',
    '      "neutral" — a judgment call, or one that turns on the attorney\'s business decision.',
    '  - synthesisBody: 1-3 sentences noting consensus or conflict across reviewers,',
    '    relative priority, and whether the item is a DRAFTING issue or a BUSINESS decision.',
    '',
    'Hard rules (non-negotiable):',
    '  - You are ADVISORY ONLY. You never make the final decision; the attorney does.',
    '  - Never rewrite the document and never invent suggestions not provided.',
    '  - Never treat a legitimate business/legal choice as a defect. If a suggestion turns',
    '    on a business decision, mark it "neutral" and say so — flag it for the attorney',
    '    rather than picking a side.',
    '  - Base every disposition only on the reviewer feedback provided below.',
    '',
    'ALSO group suggestions that address the SAME underlying issue across reviewers (FOLD-ORCH-1).',
    'For each such issue, add an entry to an "issueGroups" array:',
    '  - issueId: a short stable id you assign for the issue;',
    '  - suggestionIds: the exact suggestionIds (possibly from DIFFERENT reviewers) that raise it;',
    '  - reviewerRoles: the reviewer roles those suggestions came from (advisory label only);',
    '  - severity: the issue\'s severity (BLOCKER|SUBSTANTIVE|STRUCTURAL|PRECISION|POLISH);',
    '  - divergent: true if the reviewers DISAGREE about the issue, false if they agree;',
    '  - structuralLowRiskCleanup: true ONLY for a STRUCTURAL item that is pure low-risk',
    '    formatting/organization cleanup (omit/false otherwise);',
    '  - synthesisBody: 1-2 sentences summarizing the grouped issue.',
    'Grouping is ADVISORY: it never decides and never counts as agreement on its own — the system',
    're-derives agreement from the actual reviewers. Only group suggestions you are confident',
    'address the same issue; leave a suggestion ungrouped (its own decision) when unsure.',
    '',
    'Return ONLY a JSON object of the form:',
    '  { "dispositions": [ { "suggestionId": string, "disposition": "adopt"|"reject"|"neutral", "synthesisBody": string } ],',
    '    "issueGroups": [ { "issueId": string, "suggestionIds": string[], "reviewerRoles": string[],',
    '                       "severity": string, "divergent": boolean, "structuralLowRiskCleanup": boolean,',
    '                       "synthesisBody": string } ] }',
    'with exactly one dispositions entry per provided suggestionId and no additional commentary.',
    'The "issueGroups" array is optional — omit it if you cannot group confidently.',
  ].join('\n');
}

export function buildEvaluatorUserPrompt(params: {
  documentTitle: string;
  iterationNumber: number;
  feedbackRows: EvaluatorPromptFeedbackRow[];
}): string {
  const { documentTitle, iterationNumber, feedbackRows } = params;
  const lines: string[] = [
    `Document: ${documentTitle}. Iteration ${iterationNumber}. Reviewers: ${feedbackRows.length}.`,
    '',
    'Reviewer feedback follows. Emit one advisory disposition per suggestionId.',
  ];
  for (const row of feedbackRows) {
    lines.push('', `### Reviewer: ${row.reviewerTitle} (${row.reviewerRole})`);
    if (row.suggestions.length === 0) {
      lines.push('- (no suggestions)');
      continue;
    }
    for (const s of row.suggestions) {
      const sev = s.severity ? ` [${s.severity}]` : '';
      // Truncate the body to keep the prompt bounded; the title + lead is enough
      // signal for consensus/conflict synthesis.
      const body = (s.body || '').replace(/\s+/g, ' ').trim().slice(0, 600);
      lines.push(`- [suggestionId=${s.suggestionId}]${sev} ${s.title} — ${body}`);
    }
  }
  return lines.join('\n');
}
