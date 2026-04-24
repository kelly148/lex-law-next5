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
 * Phase 1 scope: users table + telemetry_events table only.
 * All other tables are introduced in their respective phases per the Build Dependency Map.
 */

import {
  mysqlTable,
  char,
  varchar,
  timestamp,
  json,
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
// Type exports for use in query wrappers and procedures
// ============================================================
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type TelemetryEvent = typeof telemetryEvents.$inferSelect;
export type NewTelemetryEvent = typeof telemetryEvents.$inferInsert;
