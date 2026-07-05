/**
 * titleExpressPorts.ts — TITLE-EXAM-1 (TEX1-10, §4a), the title-memo Express review/regenerate ports.
 *
 * The synthesized exam memo (a document with documentType 'title_exam', accepted by the loop since T8) rides
 * the PLATFORM bounded auto-review loop UNCHANGED — this is orchestration inheritance, not new machinery:
 *   - the REVIEW PORT dispatches the memo to the Express-reviewer role (its model resolved from the §4b config,
 *     roles.resolveTitleExamModel('express_reviewer')) through the existing fail-closed egress broker;
 *   - the REGENERATE PORT is the platform's DETERMINISTIC adopted-edit splice (no model, no egress, no drift).
 *
 * Title-specific ESCALATION is enforced DOWNSTREAM — by the T8 'title_exam' protected-span recognizers
 * (protectedSpans) + the always-escalate modelEscalates profile (expressProfile) — NOT by these ports. So the
 * platform Class-A auto-adopt safe harbor is reused as-is and is NEVER widened (a new load-bearing decision /
 * potential §3.1 re-fire is avoided). The NC-1 judgment auto-disposition stays inside the T4 reconciler.
 *
 * `send` is injectable (defaults to the real broker) so tests build the ports with a mock — no live call.
 */

import { makeReviewPort, makeRegeneratePort, type ReviewPortDeps } from '../express/expressPorts.js';
import type { ReviewPort, RegeneratePort } from '../express/reviewLoop.js';
import type { EgressSubject } from '../../shared/schemas/egress.js';

export interface TitleExpressPortsDeps {
  /** The title-memo document subject (matter/document/version + userId). */
  subject: EgressSubject;
  /** The Express-reviewer model string — resolveTitleExamModel('express_reviewer') (§4b; never a literal). */
  reviewerModelString: string;
  timeoutMs?: number | undefined;
  /** Injectable broker (defaults to the real documentEgressSend inside makeReviewPort). Tests pass a mock. */
  send?: ReviewPortDeps['send'];
}

/**
 * Build the title-memo Express ports. Rides the platform loop: the reviewPort is the egress-backed platform
 * review port bound to the Express-reviewer model; the regeneratePort is the platform deterministic splice.
 */
export function makeTitleExpressPorts(
  deps: TitleExpressPortsDeps,
): { reviewPort: ReviewPort; regeneratePort: RegeneratePort } {
  return {
    reviewPort: makeReviewPort({
      subject: deps.subject,
      modelString: deps.reviewerModelString,
      timeoutMs: deps.timeoutMs,
      ...(deps.send ? { send: deps.send } : {}),
    }),
    regeneratePort: makeRegeneratePort(),
  };
}
