/**
 * laneExaminer.ts — TITLE-EXAM-1 (TEX1-10), the LIVE exam-lane binding (§4b).
 *
 * Binds the T3 examOrchestrator's injected LaneExaminer port to the REAL provider adapters — dispatching each
 * lane THROUGH the existing egress broker (documentEgressSend, surface 'reviewer', enforceProviderAllowlist
 * TRUE, fail-closed) exactly like the Express reviewPort. The model per lane arrives already resolved from the
 * central §4b config (roles.resolveTitleExamModel) — this module never names a model. Fail-closed: a
 * DocumentEgressBlockedError (held/no-external/conflicts matter, or an NPI-posture block) PROPAGATES; the
 * orchestrator turns any lane error into a single-lane banner (NC-10), never a silent success.
 *
 * The `send` dependency is INJECTABLE (defaults to the real broker) so tests exercise the whole path with a
 * MOCK — no live provider call is ever made in the build (mocks/fixtures only, per the batch constraint).
 */

import { documentEgressSend } from '../egress/documentEgress.js';
import type { EgressSubject } from '../../shared/schemas/egress.js';
import type { LaneExaminer } from './examOrchestrator.js';
import { TitleExamLaneOutputSchema } from './laneOutput.js';

export interface LlmLaneExaminerDeps {
  /** The document subject (matter/document/version scope + userId) — the broker resolves the hold from it. */
  subject: EgressSubject;
  /** Abort timeout for the lane's provider call (default 300s, the reviewer envelope). */
  timeoutMs?: number | undefined;
  /** Injectable broker — defaults to the real documentEgressSend. Tests pass a mock (no live call). */
  send?: typeof documentEgressSend;
}

/** Build the LIVE LaneExaminer. Returns the lane's RAW string output; the orchestrator's runLane parses it via
 *  parseTitleExamLaneOutput (fail-loud → lane failure → single-lane banner). */
export function makeLlmLaneExaminer(deps: LlmLaneExaminerDeps): LaneExaminer {
  const send = deps.send ?? documentEgressSend;
  return async ({ systemPrompt, recordSet, modelString }) => {
    const result = await send({
      subject: deps.subject,
      surface: 'reviewer',
      modelString,
      llmParams: {
        systemPrompt,
        userPrompt: recordSet,
        temperature: 0.2,
        maxTokens: 8192,
        structuredOutputSchema: TitleExamLaneOutputSchema,
        signal: AbortSignal.timeout(deps.timeoutMs ?? 300_000),
      },
      serializedPayload: `${systemPrompt}\n\n${recordSet}`,
      // FAIL-CLOSED provider allowlist — the broker is never bypassed; a held/no-external matter throws.
      enforceProviderAllowlist: true,
    });
    // The broker may return content as a string OR an already-parsed object; hand a JSON string to the parser.
    return typeof result.content === 'string' ? result.content : JSON.stringify(result.content);
  };
}
