/**
 * Telemetry Zod schemas — Lex Law Next v1
 *
 * Ch 35.1 — Zod Wall: telemetry_events.payload is a JSON column.
 * Reads of this column pass through these schemas before any application code
 * touches the value.
 *
 * The TelemetryEnvelopeSchema validates the common envelope (Ch 25.1).
 * Per-event payload schemas are defined per event type.
 */

import { z } from 'zod';

// ============================================================
// Common envelope schema (Ch 25.1)
// ============================================================
export const TelemetryEnvelopeSchema = z.object({
  eventId: z.string().uuid(),
  eventType: z.string().min(1),
  userId: z.string().uuid(),
  matterId: z.string().uuid().nullable(),
  documentId: z.string().uuid().nullable(),
  jobId: z.string().uuid().nullable(),
  timestamp: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
  payload: z.unknown(),
});

export type TelemetryEnvelope = z.infer<typeof TelemetryEnvelopeSchema>;
