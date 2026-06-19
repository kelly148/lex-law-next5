/**
 * Vitest global test setup — Lex Law Next v1
 *
 * This file is run before every test file (configured in vitest.config.ts setupFiles).
 *
 * Responsibilities:
 * 1. Enable in-memory telemetry mode so tests can assert emitted events (Ch 34.9).
 * 2. Clear the telemetry buffer before each test case.
 * 3. Load environment variables from .env.test if present.
 *
 * Ch 34.9 — Telemetry assertion discipline:
 *   Integration tests that exercise state-changing operations assert the expected
 *   telemetry events fired with expected payloads. The assertTelemetryEmitted()
 *   helper (below) is the shared utility for these assertions.
 */

import { beforeEach } from 'vitest';
import {
  enableTestTelemetry,
  clearTelemetryBuffer,
  getTelemetryBuffer,
} from '../telemetry/emitTelemetry.js';
import type { TelemetryEventName } from '../../shared/types/telemetry.js';
import { setEgressEventStore, type EgressEventStore } from '../db/queries/egressEvents.js';
import { setEgressHoldStore, type EgressHoldStore } from '../db/queries/egressHold.js';
import type { NewEgressEvent } from '../db/schema.js';
import type { EgressEventRow } from '../../shared/schemas/egress.js';

// Enable in-memory telemetry mode for all tests
enableTestTelemetry();

// ============================================================
// EGRESS-CONTROL-PLANE-1 Inc 3a — DB-less egress stores for the global test env
// ============================================================
// Inc 3a onboarded the reviewer fan-out onto the egress control plane: any test that dispatches a
// reviewer_feedback job through executeCanonicalMutation now reaches resolveEffectiveHold +
// recordEgressEvent, which throw against the absent test DB. Install empty/no-op egress stores by
// default (the DB-less equivalent of prod's "no hold; record OK" path: resolveEffectiveHold -> none ->
// allowed). Egress-SPECIFIC tests override these in their own beforeEach (which runs after setupFiles)
// and reset to null in afterEach; the next test re-installs the defaults here. Inert for non-egress tests.
function egressRowFromInsert(row: NewEgressEvent): EgressEventRow {
  return {
    id: row.id!,
    userId: row.userId!,
    matterId: row.matterId!,
    surface: row.surface!,
    subjectType: row.subjectType!,
    conversationId: row.conversationId ?? null,
    documentId: row.documentId ?? null,
    documentVersionId: row.documentVersionId ?? null,
    jobId: row.jobId ?? null,
    holdScope: row.holdScope ?? null,
    decision: row.decision!,
    blockReason: row.blockReason ?? null,
    provider: row.provider!,
    model: row.model!,
    policyVersion: row.policyVersion ?? null,
    inputBundleHash: row.inputBundleHash ?? null,
    correlationId: row.correlationId!,
    status: row.status ?? 'pending',
    failureReason: row.failureReason ?? null,
    createdAt: new Date(),
    completedAt: null,
  };
}
const NO_HOLD_STORE: EgressHoldStore = {
  listActiveForSubject: () => Promise.resolve([]), // no hold -> resolveEffectiveHold returns { none, null }
  insert: () => Promise.resolve(),
};
const NOOP_EVENT_STORE: EgressEventStore = {
  insert: (row: NewEgressEvent) => Promise.resolve(egressRowFromInsert(row)),
  complete: () => Promise.resolve(null),
  get: () => Promise.resolve(null),
  list: () => Promise.resolve([]),
};

// Clear the buffer + install the default egress stores before each test (cross-test contamination guard)
beforeEach(() => {
  clearTelemetryBuffer();
  setEgressHoldStore(NO_HOLD_STORE);
  setEgressEventStore(NOOP_EVENT_STORE);
});

// ============================================================
// assertTelemetryEmitted — shared test utility (Ch 34.9)
// ============================================================

/**
 * Assert that a specific telemetry event was emitted during the test.
 *
 * @param eventType      The event name to look for (must be in TelemetryEventName).
 * @param payloadMatcher Optional partial payload to match against.
 *                       All provided keys must match the emitted payload.
 *
 * @throws If the event was not emitted, or if the payload does not match.
 *
 * Usage:
 *   assertTelemetryEmitted('matter_created', { title: 'Smith Trust' });
 *   assertTelemetryEmitted('zod_parse_failed', { schemaName: 'UserRowSchema' });
 */
export function assertTelemetryEmitted(
  eventType: TelemetryEventName,
  payloadMatcher?: Record<string, unknown>
): void {
  const buffer = getTelemetryBuffer();
  const matching = buffer.filter(e => e.eventType === eventType);

  if (matching.length === 0) {
    const emitted = buffer.map(e => e.eventType).join(', ') || '(none)';
    throw new Error(
      `Expected telemetry event '${eventType}' to have been emitted, ` +
      `but it was not. Events emitted: ${emitted}`
    );
  }

  if (payloadMatcher !== undefined) {
    const matchingWithPayload = matching.filter(e => {
      const payload = e.payload as Record<string, unknown>;
      return Object.entries(payloadMatcher).every(
        ([key, value]) => payload[key] === value
      );
    });

    if (matchingWithPayload.length === 0) {
      const actualPayloads = matching.map(e => JSON.stringify(e.payload)).join('\n  ');
      throw new Error(
        `Telemetry event '${eventType}' was emitted, but no emission matched ` +
        `the expected payload:\n  Expected: ${JSON.stringify(payloadMatcher)}\n` +
        `  Actual payloads:\n  ${actualPayloads}`
      );
    }
  }
}

/**
 * Assert that a telemetry event was NOT emitted during the test.
 * Useful for verifying that error paths don't fire success events.
 */
export function assertTelemetryNotEmitted(eventType: TelemetryEventName): void {
  const buffer = getTelemetryBuffer();
  const matching = buffer.filter(e => e.eventType === eventType);

  if (matching.length > 0) {
    throw new Error(
      `Expected telemetry event '${eventType}' NOT to have been emitted, ` +
      `but it was emitted ${matching.length} time(s).`
    );
  }
}

// Export for use in test files
export { getTelemetryBuffer, clearTelemetryBuffer };
