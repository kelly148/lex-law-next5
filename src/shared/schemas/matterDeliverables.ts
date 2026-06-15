/**
 * matter_deliverable schemas (Zod Wall) — FOLD-PM-4.
 *
 * A simple owner+matter-scoped "to-do / ongoing matter" item: each row is one
 * deliverable on one matter, owned by one attorney. This is the single source of
 * truth for the status enum — schema.ts (the Drizzle table) imports
 * MATTER_DELIVERABLE_STATUS_VALUES from here so the column enum and the Zod Wall
 * can never drift (the repo convention used by reviewerLaneState / chatCopilot).
 *
 * The feature is additive and ships behind MATTER_DELIVERABLE_ENABLED (default OFF).
 */

import { z } from 'zod';

// Deliverable lifecycle: 'open' (to-do) -> 'done' (completed). Two states only.
export const MATTER_DELIVERABLE_STATUS_VALUES = ['open', 'done'] as const;
export type MatterDeliverableStatus = (typeof MATTER_DELIVERABLE_STATUS_VALUES)[number];

// Calendar date (date-only, America/New_York) stored as a 'YYYY-MM-DD' string
// (the date('col', { mode: 'string' }) convention used by the deadline engine).
const DUE_DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

export const MatterDeliverableRowSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  matterId: z.string().uuid(),
  title: z.string().min(1).max(256),
  status: z.enum(MATTER_DELIVERABLE_STATUS_VALUES),
  dueDate: DUE_DATE.nullable(),
  notes: z.string().max(8000).nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type MatterDeliverableRow = z.infer<typeof MatterDeliverableRowSchema>;
