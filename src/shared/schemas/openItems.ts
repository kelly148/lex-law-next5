/**
 * Zod schema for the open_items table — FOLD-L1-1 (Fork B + Fork D).
 *
 * Ch 35.1 Zod Wall: every read of open_items parses through this schema.
 *
 * Persistent registry of open items / blockers requiring attorney action — the
 * durable lifecycle that advisory, non-persisted sendability blockers (MR-CAL-8C)
 * never had. Matter-level (documentId null) AND document-level (Fork D). Default-safe:
 * auto-detection may create/refresh but never closes an attorney-opened/confirmed item.
 *
 * Enum literals are inlined here (repo convention); the Drizzle column enums live in
 * schema.ts (OPEN_ITEM_*_VALUES).
 */

import { z } from 'zod';

export const OpenItemRowSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  matterId: z.string().uuid(),
  documentId: z.string().uuid().nullable(),
  category: z.string(),
  severity: z.enum(['blocker', 'substantive', 'polish']),
  summary: z.string(),
  status: z.enum(['open', 'resolved', 'withdrawn']),
  statusSource: z.enum(['auto', 'attorney']),
  origin: z.string(),
  confidence: z.enum(['low', 'medium', 'high']).nullable(),
  requiresAttorneyConfirmation: z.boolean(),
  sourceSuggestionId: z.string().nullable(),
  reviewSessionId: z.string().uuid().nullable(),
  versionId: z.string().uuid().nullable(),
  lastSeenAt: z.date().nullable(),
  resolvedByEventId: z.string().uuid().nullable(),
  resolutionRationale: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type OpenItemRow = z.infer<typeof OpenItemRowSchema>;
export type OpenItemSeverity = OpenItemRow['severity'];
export type OpenItemStatus = OpenItemRow['status'];
export type OpenItemStatusSource = OpenItemRow['statusSource'];
export type OpenItemConfidence = NonNullable<OpenItemRow['confidence']>;
