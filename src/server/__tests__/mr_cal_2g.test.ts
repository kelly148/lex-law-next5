/**
 * MR-CAL-2G - GPT artifact preservation (observability)
 *
 * MR-CAL-2F found that raw reviewer output was never persisted, so the P8-T1 GPT
 * PARSE_FAILURE could not be audited. This change captures the raw reviewer output
 * into telemetry BEFORE the feedback parse can throw, so the raw artifact survives
 * even when parsing fails.
 *
 * These are source-audit + catalog tests (the repo's mr0g.gate / lln_outline_gen_1
 * pattern): they verify the wiring without standing up the full reviewer mutation,
 * which needs live providers. The critical property is ordering: the capture emit
 * must precede the parse-failure re-throw.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { TelemetryPayload, TelemetryEventName } from '../../shared/types/telemetry.js';

const repoRoot = resolve(__dirname, '../../..');
const reviewSessionSrc = readFileSync(
  resolve(repoRoot, 'src/server/procedures/reviewSession.ts'),
  'utf8',
);
const telemetrySrc = readFileSync(
  resolve(repoRoot, 'src/shared/types/telemetry.ts'),
  'utf8',
);

describe('MR-CAL-2G telemetry catalog', () => {
  it('reviewer_output_captured is a valid TelemetryEventName with the expected payload shape', () => {
    // Compile-time gate: this only type-checks if the event + payload exist.
    const eventName: TelemetryEventName = 'reviewer_output_captured';
    const payload: TelemetryPayload['reviewer_output_captured'] = {
      jobId: 'job-1',
      reviewerRole: 'gpt',
      reviewerModel: 'openai:gpt-5',
      iterationNumber: 1,
      rawOutput: 'raw provider text',
      rawOutputLength: 17,
      parseOk: false,
      parsedSuggestionCount: null,
    };
    expect(eventName).toBe('reviewer_output_captured');
    expect(payload.rawOutput).toBe('raw provider text');
    expect(payload.parseOk).toBe(false);
    expect(payload.parsedSuggestionCount).toBeNull();
  });

  it('the event name and payload are declared in the telemetry catalog source', () => {
    expect(telemetrySrc).toContain("'reviewer_output_captured'");
    expect(telemetrySrc).toContain('reviewer_output_captured: {');
    expect(telemetrySrc).toContain('rawOutput: string;');
  });
});

describe('MR-CAL-2G reviewer-output capture wiring (reviewSession.ts)', () => {
  it('emits reviewer_output_captured with the raw output', () => {
    expect(reviewSessionSrc).toContain("'reviewer_output_captured'");
    expect(reviewSessionSrc).toContain('rawOutput,');
    expect(reviewSessionSrc).toContain('rawOutputLength: rawOutput.length');
  });

  it('parses defensively (try/catch) so a parse failure does not skip the capture', () => {
    const captureIdx = reviewSessionSrc.indexOf("'reviewer_output_captured'");
    const parseIdx = reviewSessionSrc.indexOf('parseFeedbackOutput(rawOutput)');
    const catchIdx = reviewSessionSrc.indexOf('parseError = err');
    expect(parseIdx).toBeGreaterThan(-1);
    expect(catchIdx).toBeGreaterThan(-1);
    expect(captureIdx).toBeGreaterThan(-1);
    // The defensive parse (catch assignment) comes before the capture emit.
    expect(catchIdx).toBeLessThan(captureIdx);
  });

  it('captures the raw output BEFORE re-throwing a parse failure (the P8-T1 case)', () => {
    const captureIdx = reviewSessionSrc.indexOf("'reviewer_output_captured'");
    const rethrowIdx = reviewSessionSrc.indexOf('throw parseError');
    expect(captureIdx).toBeGreaterThan(-1);
    expect(rethrowIdx).toBeGreaterThan(-1);
    // Capture must happen before the failure is re-thrown, or the raw artifact is lost.
    expect(captureIdx).toBeLessThan(rethrowIdx);
  });

  it('preserves fail-loud behavior: a parse failure is still re-thrown', () => {
    expect(reviewSessionSrc).toContain('if (parseError !== null) {');
    expect(reviewSessionSrc).toContain('throw parseError;');
  });
});
