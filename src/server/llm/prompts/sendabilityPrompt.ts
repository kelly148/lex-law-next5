/**
 * sendabilityPrompt — MR-CAL-8B
 *
 * Builds the system/user prompts for the ADVISORY sendability classifier. The
 * classifier reads the current draft (+ the latest iteration's reviewer feedback
 * as signal) and emits a structured verdict for the supervising attorney about
 * whether the document looks safe to send. It is ADVISORY ONLY: it never decides,
 * never blocks finalize/export, never rewrites the document, and never treats a
 * legitimate business/legal choice as a defect (P8-T10). The attorney decides.
 *
 * Output is constrained to SendabilityVerdictSchema
 *   { sendable: boolean, blockers: [{ category, severity, summary }], notes? }.
 */

/** Minimal shape of a persisted reviewer-feedback row used as classifier signal. */
export interface SendabilityFeedbackRow {
  reviewerRole: string;
  reviewerTitle: string;
  suggestions: Array<{
    suggestionId: string;
    title: string;
    body: string;
    severity?: string | undefined;
  }>;
}

export function buildSendabilitySystemPrompt(): string {
  return [
    'You are an ADVISORY legal-document SENDABILITY classifier. Given a draft legal document (and any',
    'reviewer feedback already produced on it), assess whether the document appears SAFE FOR THE',
    'SUPERVISING ATTORNEY TO RELEASE/SEND, and surface concrete pre-send blockers.',
    '',
    'Assess against these blocker categories (use the exact category keys):',
    '  - jurisdiction_mismatch        — governing law/jurisdiction missing, wrong, or internally inconsistent',
    '  - missing_material_terms       — a material term required for this document type is absent',
    '  - unresolved_blanks            — NON-routine blanks (e.g. legal description, principal amount, party',
    '                                   identity, deadline). Do NOT flag routine pre-execution signature/date/',
    '                                   witness/notary blanks.',
    '  - missing_party_or_capacity    — a necessary party, signatory, or capacity/authority is missing',
    '  - conflicting_provisions       — provisions that contradict each other or other identified documents',
    '  - business_decision_needed     — the draft turns on an unselected business/risk-allocation choice;',
    '                                   surface it for the attorney, do NOT pick a side',
    '  - execution_signature_defect   — a NON-routine execution/signature defect that would impair validity',
    '  - counterparty_over_disclosure — text that over-discloses to a counterparty/opposing audience',
    '  - other                        — any other sendability concern not covered above',
    '',
    'For each blocker, assign a severity from: BLOCKER, SUBSTANTIVE, STRUCTURAL, PRECISION, POLISH',
    '(BLOCKER = a sendability fail that prevents responsible attorney release).',
    '',
    'Set sendable=false if there is at least one BLOCKER-severity item; otherwise sendable=true',
    '(lower-severity items may still be listed as advisory blockers without making the document unsendable).',
    '',
    'Hard rules (non-negotiable):',
    '  - You are ADVISORY ONLY. You never make the final decision; the attorney does. You never block.',
    '  - Never rewrite the document. Never invent unsupported facts, parties, or authorities.',
    '  - Never treat a legitimate business/legal choice as a defect; mark it business_decision_needed and',
    '    flag it for the attorney rather than choosing.',
    '  - Do not flag routine pre-execution signature/date/witness/notary blanks as unsendable.',
    '',
    'Return ONLY a JSON object of the form:',
    '  { "sendable": boolean, "blockers": [ { "category": <category key>, "severity": <severity>, "summary": string } ], "notes"?: string }',
    'with no additional commentary outside the JSON object. Return an empty blockers array if there are none.',
  ].join('\n');
}

export function buildSendabilityUserPrompt(params: {
  documentTitle: string;
  documentType: string;
  iterationNumber: number;
  content: string;
  feedbackRows: SendabilityFeedbackRow[];
}): string {
  const { documentTitle, documentType, iterationNumber, content, feedbackRows } = params;
  const lines: string[] = [
    `Document: "${documentTitle}" (type: ${documentType}). Current iteration ${iterationNumber}.`,
    'Assess this draft for sendability and emit the JSON verdict.',
    '',
    '## Current Draft',
    content,
  ];
  if (feedbackRows.length > 0) {
    lines.push('', '## Reviewer feedback on this draft (signal — weigh, do not just copy)');
    for (const row of feedbackRows) {
      for (const s of row.suggestions) {
        const sev = s.severity ? ` [${s.severity}]` : '';
        // Truncate each item to keep the prompt bounded; title + lead is enough signal.
        const body = (s.body || '').replace(/\s+/g, ' ').trim().slice(0, 400);
        lines.push(`- [${row.reviewerTitle}${sev}] ${s.title} — ${body}`);
      }
    }
  }
  return lines.join('\n');
}
