/**
 * emitTelemetry — Lex Law Next v1
 *
 * R14 — No Duplicate Primitives: This is the single authoritative telemetry emitter.
 * All server-side telemetry emission goes through this function.
 * No other module may write to telemetry_events directly.
 *
 * R1 — Spec Is Absolute: Event names are from the TelemetryEventName union.
 * Passing a string not in the union is a TypeScript compile error.
 *
 * Ch 25.10 — No Silent Failures: Every catch block that swallows an error
 * without emitting is a spec violation. This emitter is the mechanism.
 *
 * Signature (per Build Instructions B.4 / Phase 1 Build Task #6):
 *   emitTelemetry<E extends TelemetryEventName>(event: E, payload: TelemetryPayload[E]): void
 *
 * Context (matterId, documentId, jobId) is passed via the opts parameter.
 * userId is required — it comes from ctx.userId (never from input, per Ch 35.2).
 *
 * In test mode, events are written to an in-memory buffer instead of the database.
 * The buffer is accessible via getTelemetryBuffer() for test assertions (Ch 34.9).
 */

import { v4 as uuidv4 } from 'uuid';
import type { TelemetryEventName, TelemetryPayload } from '../../shared/types/telemetry.js';

// ============================================================
// Context passed by callers
// ============================================================
export interface TelemetryContext {
  userId: string;
  matterId?: string | null;
  documentId?: string | null;
  jobId?: string | null;
}

// ============================================================
// In-memory buffer for test mode (Ch 34.9)
// ============================================================
export interface BufferedTelemetryEvent {
  eventId: string;
  eventType: TelemetryEventName;
  userId: string;
  matterId: string | null;
  documentId: string | null;
  jobId: string | null;
  timestamp: string;
  payload: unknown;
}

let _testBuffer: BufferedTelemetryEvent[] | null = null;

/**
 * Enable test mode — events go to the in-memory buffer instead of the database.
 * Called by the Vitest setup file.
 */
export function enableTestTelemetry(): void {
  _testBuffer = [];
}

/**
 * Get the in-memory telemetry buffer (test mode only).
 * Returns a copy; does not clear the buffer.
 */
export function getTelemetryBuffer(): BufferedTelemetryEvent[] {
  if (_testBuffer === null) {
    throw new Error('getTelemetryBuffer() called outside test mode. Call enableTestTelemetry() first.');
  }
  return [..._testBuffer];
}

/**
 * Clear the in-memory telemetry buffer (test mode only).
 * Call between test cases to reset state.
 */
export function clearTelemetryBuffer(): void {
  if (_testBuffer !== null) {
    _testBuffer = [];
  }
}

// ============================================================
// Database writer (lazy import to avoid circular deps in tests)
// ============================================================
type DbWriter = (event: BufferedTelemetryEvent) => Promise<void>;
let _dbWriter: DbWriter | null = null;

export function setTelemetryDbWriter(writer: DbWriter): void {
  _dbWriter = writer;
}

// ============================================================
// The emitter
// ============================================================

/**
 * Emit a telemetry event.
 *
 * The generic parameter E constrains both the event name and the payload type —
 * TypeScript will reject any event name not in TelemetryEventName, and will
 * reject any payload that doesn't match TelemetryPayload[E].
 *
 * Example:
 *   emitTelemetry('matter_created', { title: 'Smith Trust' }, { userId: ctx.userId });
 *
 * @param eventType  Must be a TelemetryEventName literal. Non-catalog strings are compile errors.
 * @param payload    Must match TelemetryPayload[E]. Wrong shape is a compile error.
 * @param ctx        Telemetry context: userId (required), matterId, documentId, jobId (all optional).
 */
export function emitTelemetry<E extends TelemetryEventName>(
  eventType: E,
  payload: TelemetryPayload[E],
  ctx: TelemetryContext
): void {
  const event: BufferedTelemetryEvent = {
    eventId: uuidv4(),
    eventType,
    userId: ctx.userId,
    matterId: ctx.matterId ?? null,
    documentId: ctx.documentId ?? null,
    jobId: ctx.jobId ?? null,
    timestamp: new Date().toISOString(),
    payload,
  };

  if (_testBuffer !== null) {
    // Test mode: write to buffer synchronously
    _testBuffer.push(event);
    return;
  }

  // Production mode: write to database asynchronously.
  // Errors are caught and logged but do not throw — telemetry must not
  // interrupt the hot path (Ch 3.7: emission is not deferred to an async queue,
  // but failures are swallowed to avoid cascading errors from a telemetry write).
  if (_dbWriter !== null) {
    _dbWriter(event).catch((err: unknown) => {
      // Last-resort: log to stderr. We cannot emit telemetry about a telemetry failure
      // without risking infinite recursion, so stderr is the floor.
      console.error('[telemetry] Failed to write event to database:', eventType, err);
    });
  } else {
    // No writer configured — this is a startup misconfiguration, not a runtime error.
    // Log but do not throw.
    console.warn('[telemetry] No database writer configured. Event not persisted:', eventType);
  }
}
