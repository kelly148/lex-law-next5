/**
 * reconcilerDispatch.ts — TITLE-EXAM-1 (TEX1-10), the LIVE fresh-context reconciler dispatch (NC-2).
 *
 * Builds the reconciler user prompt from the two lanes' outputs (as DATA — the reconciler carries no memory of
 * its own lane, NC-2), dispatches through the fail-closed egress broker with the T4 reconciler system prompt,
 * and parses the reconciler's proposed items (fail-loud). The proposed items feed reconciler.reconcileLaneFindings,
 * which applies NC-1 DETERMINISTICALLY (the code, not the model, decides the disposition). `send` is injectable
 * for mock tests — no live provider call in the build.
 */

import { z } from 'zod';
import { documentEgressSend } from '../egress/documentEgress.js';
import type { EgressSubject } from '../../shared/schemas/egress.js';
import { TITLE_EXAM_RECONCILER_SYSTEM_PROMPT, type ReconcilerItemInput } from './reconciler.js';
import type { TitleExamLaneFinding } from './laneOutput.js';
import {
  TITLE_EXAM_SOURCE_BASIS_VALUES,
  TITLE_EXAM_SENDABILITY_VALUES,
  TITLE_EXAM_CLASSIFICATION_VALUES,
} from '../db/schema.js';

const ReconcilerItemSchema = z.object({
  title: z.string().min(1),
  detail: z.string().optional(),
  sourceBasis: z.enum(TITLE_EXAM_SOURCE_BASIS_VALUES),
  sendability: z.enum(TITLE_EXAM_SENDABILITY_VALUES),
  classification: z.enum(TITLE_EXAM_CLASSIFICATION_VALUES),
  downgraded: z.boolean().optional(),
  ocrSourcePagePincite: z.string().optional(),
  laneARef: z.number().int().optional(),
  laneBRef: z.number().int().optional(),
  laneAPosition: z.string().optional(),
  laneBPosition: z.string().optional(),
  recommendation: z.string().optional(),
  isConflict: z.boolean().optional(),
  isJudgment: z.boolean().optional(),
  isHousekeeping: z.boolean().optional(),
  recordResolvableCategory: z.string().optional(),
});
export const TitleExamReconcilerOutputSchema = z.array(ReconcilerItemSchema);

export class TitleExamReconcilerOutputError extends Error {
  readonly code = 'TITLE_EXAM_RECONCILER_OUTPUT_MALFORMED';
  constructor(message: string) {
    super(message);
    this.name = 'TitleExamReconcilerOutputError';
  }
}

function stripFence(raw: string): string {
  const t = raw.trim();
  if (!t.startsWith('```')) return t;
  return t.replace(/^```(?:json)?[ \t]*\r?\n?/i, '').replace(/\r?\n?```$/i, '').trim();
}

/** Parse the reconciler's raw output into proposed items. Fail-loud (malformed throws); empty [] valid. */
export function parseReconcilerOutput(raw: string): ReconcilerItemInput[] {
  const body = stripFence(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (err) {
    throw new TitleExamReconcilerOutputError(
      `reconciler output was not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const result = TitleExamReconcilerOutputSchema.safeParse(parsed);
  if (!result.success) {
    throw new TitleExamReconcilerOutputError(`reconciler output did not match the item schema: ${result.error.message}`);
  }
  // The schema mirrors ReconcilerItemInput; Zod's .optional() adds `| undefined` on the optional fields, which
  // exactOptionalPropertyTypes distinguishes from `?:` — a sound cast (reconcileLaneFindings reads defensively).
  return result.data as ReconcilerItemInput[];
}

/** Build the reconciler user prompt: the record + BOTH lanes' findings (as data; laneARef/laneBRef index these). */
export function buildReconcilerUserPrompt(
  laneA: readonly TitleExamLaneFinding[],
  laneB: readonly TitleExamLaneFinding[],
  recordSet: string,
): string {
  const fmt = (lane: readonly TitleExamLaneFinding[]) =>
    lane.length === 0
      ? '(no findings)'
      : lane.map((f, i) => `[${i}] (${f.sourceBasis}/${f.sendability}/${f.classification}) ${f.title}${f.detail ? ` — ${f.detail}` : ''}`).join('\n');
  return [
    '[RECORD SET]',
    recordSet,
    '',
    '[LANE A (manual-anchored) FINDINGS]',
    fmt(laneA),
    '',
    '[LANE B (research-capable) FINDINGS]',
    fmt(laneB),
    '',
    'Reconcile these two independent examinations of the SAME record. Return ONLY a JSON array of reconciled',
    'items; each item: { "title", "detail"?, "sourceBasis", "sendability", "classification", "laneARef"? (index',
    'into LANE A), "laneBRef"? (index into LANE B), "laneAPosition"?, "laneBPosition"?, "recommendation"?,',
    '"isConflict"?, "isJudgment"?, "isHousekeeping"?, "recordResolvableCategory"?, "downgraded"?,',
    '"ocrSourcePagePincite"? }. Return [] only if there is nothing to reconcile.',
  ].join('\n');
}

export interface ReconcilerDispatchDeps {
  subject: EgressSubject;
  timeoutMs?: number | undefined;
  send?: typeof documentEgressSend;
}

/** Build the LIVE reconciler dispatch. Returns the reconciler's proposed items (for reconcileLaneFindings). */
export function makeReconcilerDispatch(
  deps: ReconcilerDispatchDeps,
): (laneA: readonly TitleExamLaneFinding[], laneB: readonly TitleExamLaneFinding[], recordSet: string, modelString: string) => Promise<ReconcilerItemInput[]> {
  const send = deps.send ?? documentEgressSend;
  return async (laneA, laneB, recordSet, modelString) => {
    const userPrompt = buildReconcilerUserPrompt(laneA, laneB, recordSet);
    const result = await send({
      subject: deps.subject,
      surface: 'evaluator',
      modelString,
      llmParams: {
        systemPrompt: TITLE_EXAM_RECONCILER_SYSTEM_PROMPT,
        userPrompt,
        temperature: 0.1,
        maxTokens: 8192,
        structuredOutputSchema: TitleExamReconcilerOutputSchema,
        signal: AbortSignal.timeout(deps.timeoutMs ?? 300_000),
      },
      serializedPayload: `${TITLE_EXAM_RECONCILER_SYSTEM_PROMPT}\n\n${userPrompt}`,
      enforceProviderAllowlist: true,
    });
    return parseReconcilerOutput(typeof result.content === 'string' ? result.content : JSON.stringify(result.content));
  };
}
