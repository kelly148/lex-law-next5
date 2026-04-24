/**
 * Drizzle ORM schema — Lex Law Next v1
 *
 * This file is the source of truth for the database schema.
 * Migrations are generated via `drizzle-kit generate` and applied via `drizzle-kit migrate`.
 *
 * Convention (Ch 4 preamble):
 *   - Table names: lowercase snake_case plural (users, matters, documents, jobs)
 *   - Column names: lowerCamelCase (userId, createdAt, workflowState)
 *   - Primary keys: `id` (UUID v4) unless explicitly stated
 *   - Every table has createdAt and updatedAt timestamps
 *
 * Phase 1 scope: users table + telemetry_events table.
 * Phase 2 scope: jobs table.
 * All other tables are introduced in their respective phases per the Build Dependency Map.
 */

import {
  mysqlTable,
  char,
  varchar,
  timestamp,
  json,
  mysqlEnum,
  int,
  text,
  index,
} from 'drizzle-orm/mysql-core';
import { sql } from 'drizzle-orm';

// ============================================================
// Ch 4.2 — users
// ============================================================
// In v1 the users table contains exactly one row (the seeded attorney account).
// Other tables' userId columns are foreign keys to users.id.
// No index beyond PK and unique(username) is needed at v1 scale.
//
// NOTE: The `preferences` JSON column is introduced in Phase 3 (Ch 4.15).
// Phase 1 establishes the table without it; Phase 3 adds it via migration.
// ============================================================
export const users = mysqlTable('users', {
  id: char('id', { length: 36 }).primaryKey(),
  username: varchar('username', { length: 64 }).notNull().unique(),
  passwordHash: varchar('passwordHash', { length: 100 }).notNull(),
  displayName: varchar('displayName', { length: 128 }).notNull(),
  createdAt: timestamp('createdAt').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp('updatedAt')
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`)
    .onUpdateNow(),
});

// ============================================================
// Ch 3.7 / Ch 4 — telemetry_events
// ============================================================
// All system telemetry is recorded here.
// Events are written synchronously on the hot path (Ch 3.7).
// The payload JSON column is Zod-validated on insert and on read (Ch 35.1).
//
// Common envelope (Ch 25.1):
//   eventId     UUID v4 generated at emission
//   eventType   from the catalog (TelemetryEventName union)
//   userId      from ctx.userId
//   matterId    nullable
//   documentId  nullable
//   jobId       nullable
//   timestamp   ISO-8601 with millisecond precision
//   payload     event-type-specific, schema-validated per event type
// ============================================================
export const telemetryEvents = mysqlTable('telemetry_events', {
  eventId: char('eventId', { length: 36 }).primaryKey(),
  eventType: varchar('eventType', { length: 128 }).notNull(),
  userId: char('userId', { length: 36 }).notNull(),
  matterId: char('matterId', { length: 36 }),
  documentId: char('documentId', { length: 36 }),
  jobId: char('jobId', { length: 36 }),
  timestamp: varchar('timestamp', { length: 30 }).notNull(), // ISO-8601 with ms
  payload: json('payload').notNull(),
  createdAt: timestamp('createdAt').notNull().default(sql`CURRENT_TIMESTAMP`),
});

// ============================================================
// Ch 4.6 — jobs
// ============================================================
// Every LLM call runs as a job. The jobs table is the observability layer
// over the canonical mutation pattern (Ch 23). Every in-flight mutation has
// a corresponding jobs row; every completed or failed mutation has that row
// updated atomically with the document-state transition.
//
// Job lifecycle (Appendix C.2):
//   queued → running → completed  (normal path)
//   queued → running → timed_out  (AbortSignal fires; Ch 8.6)
//   queued → running → failed     (HTTP/parse error; Ch 22.6)
//   queued → running → cancelled  (job.cancel while running; Ch 21.10)
//   queued → cancelled            (job.cancel while queued; Ch 21.10)
//
// All terminal states (completed, failed, timed_out, cancelled) are sinks.
//
// promptVersion: captured at job creation from the active prompt version
// for the job's role (Ch 22.8). Immutable after insert — no UPDATE ever
// touches this column (R11, enforced by grep in CI acceptance criteria).
//
// input/output: JSON columns, Zod-validated on every read via
// server/db/queries/jobs.ts (Ch 35.1 Zod Wall).
//
// errorClass: one of timeout | api_error | parse_error | revert_failed | other
// (Ch 22.6). NULL when status is queued, running, or completed.
//
// heartbeat: step-based per Ch 8.5. Updated at specific checkpoints, not
// on a fixed interval. Semantics documented in comment to prevent callers
// from assuming it is a live health check.
//
// Indexes (Ch 4.6):
//   idx_jobs_user_status   (userId, status, updatedAt DESC) — operational queries
//   idx_jobs_document      (documentId, status)             — per-document job list
//   idx_jobs_matter        (matterId, status)               — per-matter job list
// ============================================================

export const JOB_STATUS_VALUES = [
  'queued',
  'running',
  'completed',
  'failed',
  'timed_out',
  'cancelled',
] as const;

export type JobStatus = (typeof JOB_STATUS_VALUES)[number];

export const JOB_TYPE_VALUES = [
  'data_extraction',
  'draft_generation',
  'review',
  'regeneration',
  'formatting',
  'information_request_generation',
  'outline_generation',
  // context_summary_generation is reserved but not actively implemented in v1 (Ch 8.3 / D6)
  'context_summary_generation',
] as const;

export type JobType = (typeof JOB_TYPE_VALUES)[number];

export const JOB_ERROR_CLASS_VALUES = [
  'timeout',
  'api_error',
  'parse_error',
  'revert_failed',
  'other',
] as const;

export type JobErrorClass = (typeof JOB_ERROR_CLASS_VALUES)[number];

export const jobs = mysqlTable(
  'jobs',
  {
    id: char('id', { length: 36 }).primaryKey(),
    userId: char('userId', { length: 36 }).notNull(),
    // matterId and documentId are nullable — some job types may not be tied to a document
    matterId: char('matterId', { length: 36 }),
    documentId: char('documentId', { length: 36 }),
    // jobType: one of the v1 active job types (Ch 8.2) plus the reserved context_summary_generation (Ch 8.3)
    jobType: varchar('jobType', { length: 64 }).notNull(),
    // providerId: e.g. 'anthropic', 'openai', 'google', 'xai'
    providerId: varchar('providerId', { length: 32 }).notNull(),
    // modelId: e.g. 'claude-opus-4-5', 'gpt-5', 'gemini-2-5-pro', 'grok-4'
    modelId: varchar('modelId', { length: 64 }).notNull(),
    // promptVersion: captured at job creation; IMMUTABLE after insert (R11 / Ch 22.8)
    // No procedure ever issues UPDATE jobs SET promptVersion = ... — enforced by grep in CI
    promptVersion: varchar('promptVersion', { length: 32 }).notNull(),
    // status: full lifecycle enum per Ch 4.6 and Appendix C.2
    status: mysqlEnum('status', JOB_STATUS_VALUES).notNull().default('queued'),
    // Lifecycle timestamps — nullable until the relevant transition occurs
    queuedAt: timestamp('queuedAt').notNull().default(sql`CURRENT_TIMESTAMP`),
    startedAt: timestamp('startedAt'),
    completedAt: timestamp('completedAt'),
    // lastHeartbeatAt: step-based per Ch 8.5; NOT a live health-check interval
    lastHeartbeatAt: timestamp('lastHeartbeatAt'),
    // input: full composed prompt and materials manifest; Zod-validated on read (Ch 35.1)
    input: json('input').notNull(),
    // output: structured response where applicable; Zod-validated on read (Ch 35.1)
    output: json('output'),
    // errorClass: populated when status is failed or timed_out (Ch 22.6)
    errorClass: varchar('errorClass', { length: 64 }),
    errorMessage: text('errorMessage'),
    // Token counts — populated on completion by the provider adapter
    tokensPrompt: int('tokensPrompt'),
    tokensCompletion: int('tokensCompletion'),
    createdAt: timestamp('createdAt').notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp('updatedAt')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`)
      .onUpdateNow(),
  },
  (table) => ({
    // Operational query index: "what jobs are running for this user?"
    idxJobsUserStatus: index('idx_jobs_user_status').on(
      table.userId,
      table.status,
      table.updatedAt,
    ),
    // Per-document job list: "what jobs are running on this document?"
    idxJobsDocument: index('idx_jobs_document').on(
      table.documentId,
      table.status,
    ),
    // Per-matter job list: "what jobs are running in this matter?"
    idxJobsMatter: index('idx_jobs_matter').on(table.matterId, table.status),
  }),
);

// ============================================================
// Type exports for use in query wrappers and procedures
// ============================================================
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type TelemetryEvent = typeof telemetryEvents.$inferSelect;
export type NewTelemetryEvent = typeof telemetryEvents.$inferInsert;
export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;
