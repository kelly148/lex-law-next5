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
 * Phase 3 scope: matters, documents, versions, matter_materials,
 *                document_references, user_preferences tables.
 *                Also adds users.preferences column via migration.
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
  boolean,
  mediumtext,
  uniqueIndex,
} from 'drizzle-orm/mysql-core';
import { sql } from 'drizzle-orm';

// ============================================================
// Ch 4.2 — users
// ============================================================
// In v1 the users table contains exactly one row (the seeded attorney account).
// Other tables' userId columns are foreign keys to users.id.
// No index beyond PK and unique(username) is needed at v1 scale.
//
// NOTE: The `preferences` JSON column is added in Phase 3 (Ch 4.15).
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
// Ch 4.3 — matters
// ============================================================
// Top-level container for all work on a single client engagement.
// Lifecycle: intake → drafting → complete (Ch 5.2).
// Archival is orthogonal to phase (Ch 5.5).
//
// Phase transitions (Ch 5.3):
//   intake → drafting  fires automatically on first document.create
//   drafting → complete fires automatically when last non-archived doc completes
//   complete → drafting fires automatically when any doc is un-finalized
//   any → archived     is explicit attorney action
//
// Indexes (Ch 4.3):
//   idx_matters_user_phase   (userId, phase, archivedAt, updatedAt DESC)
//   idx_matters_user_created (userId, archivedAt, createdAt DESC)
// ============================================================

export const MATTER_PHASE_VALUES = ['intake', 'drafting', 'complete'] as const;
export type MatterPhase = (typeof MATTER_PHASE_VALUES)[number];

export const matters = mysqlTable(
  'matters',
  {
    id: char('id', { length: 36 }).primaryKey(),
    userId: char('userId', { length: 36 }).notNull(),
    title: varchar('title', { length: 256 }).notNull(),
    clientName: varchar('clientName', { length: 256 }),
    // practiceArea: freeform string in v1; Learning Mode in v2 will curate (Ch 5.4)
    practiceArea: varchar('practiceArea', { length: 128 }),
    phase: mysqlEnum('phase', MATTER_PHASE_VALUES).notNull().default('intake'),
    // archivedAt: set on archive; cleared on unarchive (Ch 5.5). Orthogonal to phase.
    archivedAt: timestamp('archivedAt'),
    // completedAt: system-managed; set when phase transitions to complete (Ch 5.3)
    completedAt: timestamp('completedAt'),
    createdAt: timestamp('createdAt').notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp('updatedAt')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`)
      .onUpdateNow(),
  },
  (table) => ({
    // Dashboard list: "show me my active matters in drafting phase"
    idxMattersUserPhase: index('idx_matters_user_phase').on(
      table.userId,
      table.phase,
      table.archivedAt,
      table.updatedAt,
    ),
    // Default dashboard list sorted by most-recently-updated
    idxMattersUserCreated: index('idx_matters_user_created').on(
      table.userId,
      table.archivedAt,
      table.createdAt,
    ),
  }),
);

// ============================================================
// Ch 4.4 — documents
// ============================================================
// Core drafting unit. Belongs to exactly one matter.
// Drafting mode (template | iterative) is immutable after insert (Ch 6.3).
// Workflow state machine (Ch 6.5):
//   drafting → substantively_accepted → finalizing → complete
//   complete → substantively_accepted (via document.unfinalize)
//   any → archived
//
// templateBindingStatus (Ch 6.3):
//   'bound'    — template-mode document actively rendered from template
//   'detached' — template-mode document moved to freeform iteration
//   Iterative-mode documents default to 'bound' but the value is semantically unused.
//
// Indexes (Ch 4.4):
//   idx_documents_matter_state  (userId, matterId, workflowState, archivedAt)
//   idx_documents_matter_created (userId, matterId, archivedAt, createdAt DESC)
// ============================================================

export const DOCUMENT_WORKFLOW_STATE_VALUES = [
  'drafting',
  'substantively_accepted',
  'finalizing',
  'complete',
  'archived',
] as const;
export type DocumentWorkflowState =
  (typeof DOCUMENT_WORKFLOW_STATE_VALUES)[number];

export const DOCUMENT_DRAFTING_MODE_VALUES = ['template', 'iterative'] as const;
export type DocumentDraftingMode =
  (typeof DOCUMENT_DRAFTING_MODE_VALUES)[number];

export const TEMPLATE_BINDING_STATUS_VALUES = ['bound', 'detached'] as const;
export type TemplateBindingStatus =
  (typeof TEMPLATE_BINDING_STATUS_VALUES)[number];

export const documents = mysqlTable(
  'documents',
  {
    id: char('id', { length: 36 }).primaryKey(),
    userId: char('userId', { length: 36 }).notNull(),
    matterId: char('matterId', { length: 36 }).notNull(),
    title: varchar('title', { length: 256 }).notNull(),
    // documentType: registry key or 'custom' (Ch 6.2)
    documentType: varchar('documentType', { length: 64 }).notNull(),
    // customTypeLabel: required when documentType='custom' (Ch 6.2)
    customTypeLabel: varchar('customTypeLabel', { length: 256 }),
    // draftingMode: immutable after insert (Ch 6.3)
    draftingMode: mysqlEnum(
      'draftingMode',
      DOCUMENT_DRAFTING_MODE_VALUES,
    ).notNull(),
    // templateBindingStatus: 'bound' for all new docs; 'detached' after document.detach (Ch 6.4)
    templateBindingStatus: mysqlEnum(
      'templateBindingStatus',
      TEMPLATE_BINDING_STATUS_VALUES,
    )
      .notNull()
      .default('bound'),
    // templateVersionId: set at creation for template-mode docs; retained after detach for audit (Ch 6.3)
    templateVersionId: char('templateVersionId', { length: 36 }),
    // templateSnapshot: variable values at detach time (Ch 6.4); JSON, Zod-validated on read
    templateSnapshot: json('templateSnapshot'),
    // variableMap: current attorney edits for template-mode docs; JSON, Zod-validated on read
    variableMap: json('variableMap'),
    // workflowState: full state machine per Ch 6.5
    workflowState: mysqlEnum(
      'workflowState',
      DOCUMENT_WORKFLOW_STATE_VALUES,
    )
      .notNull()
      .default('drafting'),
    // currentVersionId: FK to versions.id; NULL until first draft/render (Ch 7)
    currentVersionId: char('currentVersionId', { length: 36 }),
    // officialSubstantiveVersionNumber: set on acceptSubstantive; cleared on reopen (Ch 6.5)
    officialSubstantiveVersionNumber: int('officialSubstantiveVersionNumber'),
    // officialFinalVersionNumber: set on finalize/acceptSubstantiveUnformatted; cleared on unfinalize (Ch 6.5)
    officialFinalVersionNumber: int('officialFinalVersionNumber'),
    // completedAt: system-managed; set when workflowState → complete (Ch 6.5)
    completedAt: timestamp('completedAt'),
    // archivedAt: set on archive; cleared on unarchive (Ch 6.5)
    archivedAt: timestamp('archivedAt'),
    // notes: attorney-internal annotation; carve-out to COMPLETE_READONLY (Ch 21.4 / R12)
    notes: text('notes'),
    createdAt: timestamp('createdAt').notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp('updatedAt')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`)
      .onUpdateNow(),
  },
  (table) => ({
    // Dashboard: "show me all drafting documents in this matter"
    idxDocumentsMatterState: index('idx_documents_matter_state').on(
      table.userId,
      table.matterId,
      table.workflowState,
      table.archivedAt,
    ),
    // Default document list sorted by creation
    idxDocumentsMatterCreated: index('idx_documents_matter_created').on(
      table.userId,
      table.matterId,
      table.archivedAt,
      table.createdAt,
    ),
  }),
);

// ============================================================
// Ch 4.5 — versions
// ============================================================
// Immutable content snapshots. Each draft/render/regeneration creates a new
// version row; content is never mutated in-place (Ch 7).
//
// versionNumber: monotonically increasing per document (1, 2, 3, …).
// content: full text of the document at this version; MEDIUMTEXT.
// generatedByJobId: FK to jobs.id; NULL for template renders (synchronous).
// iterationNumber: which drafting iteration this version belongs to.
//
// Indexes (Ch 4.5):
//   idx_versions_document_number (documentId, versionNumber DESC)
// ============================================================

export const versions = mysqlTable(
  'versions',
  {
    id: char('id', { length: 36 }).primaryKey(),
    userId: char('userId', { length: 36 }).notNull(),
    documentId: char('documentId', { length: 36 }).notNull(),
    versionNumber: int('versionNumber').notNull(),
    // content: full document text at this version; never mutated after insert
    content: mediumtext('content').notNull(),
    // generatedByJobId: NULL for synchronous template renders; populated for LLM-generated versions
    generatedByJobId: char('generatedByJobId', { length: 36 }),
    // iterationNumber: drafting iteration counter; increments on regeneration
    iterationNumber: int('iterationNumber').notNull().default(1),
    createdAt: timestamp('createdAt').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    // Version history list for a document
    idxVersionsDocumentNumber: index('idx_versions_document_number').on(
      table.documentId,
      table.versionNumber,
    ),
    // Unique version number per document
    uniqVersionPerDocument: uniqueIndex('uniq_version_per_document').on(
      table.documentId,
      table.versionNumber,
    ),
  }),
);

// ============================================================
// Ch 4.9 — matter_materials
// ============================================================
// Attorney-uploaded or paste-text materials for a matter.
// Soft-delete via deletedAt (Ch 21.6).
// extractionStatus governs context pipeline inclusion (Ch 20.2).
//
// Indexes (Ch 4.9):
//   idx_materials_user_matter_created (userId, matterId, deletedAt, createdAt DESC)
//   idx_materials_user_matter_pinned  (userId, matterId, deletedAt, pinned, createdAt DESC)
// ============================================================

export const EXTRACTION_STATUS_VALUES = [
  'extracted',
  'partial',
  'failed',
  'not_supported',
] as const;
export type ExtractionStatus = (typeof EXTRACTION_STATUS_VALUES)[number];

export const UPLOAD_SOURCE_VALUES = ['upload', 'paste'] as const;
export type UploadSource = (typeof UPLOAD_SOURCE_VALUES)[number];

export const matterMaterials = mysqlTable(
  'matter_materials',
  {
    id: char('id', { length: 36 }).primaryKey(),
    userId: char('userId', { length: 36 }).notNull(),
    matterId: char('matterId', { length: 36 }).notNull(),
    // filename: NULL for paste-text entries (Ch 4.9)
    filename: varchar('filename', { length: 512 }),
    mimeType: varchar('mimeType', { length: 128 }),
    // fileSize: bytes; NULL for paste-text (Ch 4.9)
    fileSize: int('fileSize'),
    // storageKey: blob storage path; NULL for paste-text (Ch 4.9)
    storageKey: varchar('storageKey', { length: 512 }),
    // textContent: for paste-text OR extracted file text (Ch 4.9)
    textContent: mediumtext('textContent'),
    // extractionStatus: governs context pipeline inclusion (Ch 20.2)
    extractionStatus: mysqlEnum(
      'extractionStatus',
      EXTRACTION_STATUS_VALUES,
    ).notNull(),
    extractionError: text('extractionError'),
    // tags: JSON array of strings; Zod-validated on read (Ch 35.1)
    tags: json('tags').notNull().default(sql`('[]')`),
    description: text('description'),
    pinned: boolean('pinned').notNull().default(false),
    uploadSource: mysqlEnum('uploadSource', UPLOAD_SOURCE_VALUES).notNull(),
    // deletedAt: soft delete; excluded from list queries and context assembly (Ch 21.6)
    deletedAt: timestamp('deletedAt'),
    createdAt: timestamp('createdAt').notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp('updatedAt')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`)
      .onUpdateNow(),
  },
  (table) => ({
    // Materials list for a matter, sorted by recency (Tier 3 context pipeline ordering)
    idxMaterialsUserMatterCreated: index(
      'idx_materials_user_matter_created',
    ).on(table.userId, table.matterId, table.deletedAt, table.createdAt),
    // Pinned materials query (Tier 1 context pipeline)
    idxMaterialsUserMatterPinned: index('idx_materials_user_matter_pinned').on(
      table.userId,
      table.matterId,
      table.deletedAt,
      table.pinned,
      table.createdAt,
    ),
  }),
);

// ============================================================
// Ch 4.13 — document_references
// ============================================================
// Sibling references between documents in the same matter.
// The ONLY mechanism by which one document's content appears in another's
// LLM context (decision #36 / Ch 20.2 Tier 2).
//
// stalenessAcknowledgedAt: set when attorney acknowledges stale references
// at the finalization gate (decision #4 / Ch 21.4 document.finalize).
//
// Indexes (Ch 4.13):
//   idx_references_source      (sourceDocumentId)
//   idx_references_referenced  (referencedDocumentId)
// ============================================================

export const documentReferences = mysqlTable(
  'document_references',
  {
    id: char('id', { length: 36 }).primaryKey(),
    userId: char('userId', { length: 36 }).notNull(),
    // sourceDocumentId: the document making the reference
    sourceDocumentId: char('sourceDocumentId', { length: 36 }).notNull(),
    // referencedDocumentId: the sibling being referenced
    referencedDocumentId: char('referencedDocumentId', {
      length: 36,
    }).notNull(),
    // referencedVersionId: version at reference time (Ch 4.13); staleness detected when
    // the sibling's currentVersionId diverges from this value
    referencedVersionId: char('referencedVersionId', { length: 36 }).notNull(),
    // stalenessAcknowledgedAt: set by document.finalize when attorney acknowledges stale refs
    stalenessAcknowledgedAt: timestamp('stalenessAcknowledgedAt'),
    createdAt: timestamp('createdAt').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    idxReferencesSource: index('idx_references_source').on(
      table.sourceDocumentId,
    ),
    idxReferencesReferenced: index('idx_references_referenced').on(
      table.referencedDocumentId,
    ),
  }),
);

// ============================================================
// Ch 4.15 — user_preferences
// ============================================================
// One row per user (PK = userId). Stores all attorney-level settings.
// The preferences JSON column is Zod-validated on read (Ch 35.1).
//
// v1 preferences (Ch 4.15):
//   voiceInput.forceShowAll        boolean — always show mic button
//   voiceInput.forceHideAll        boolean — disable voice input entirely
//   voiceInput.dictationLanguage   string  — Web Speech API lang; default 'en-US'
//   reviewerEnablement.claude      boolean — default true  (decision #43)
//   reviewerEnablement.gpt         boolean — default true
//   reviewerEnablement.gemini      boolean — default true
//   reviewerEnablement.grok        boolean — default false (decision #43)
//
// No separate user_settings table — "settings" and "preferences" both live here
// (Ch 4.15 namespace note).
// ============================================================

export const userPreferences = mysqlTable('user_preferences', {
  // userId is the PK (1:1 with users) — no separate `id` column (Ch 4.15)
  userId: char('userId', { length: 36 }).primaryKey(),
  // preferences: open JSON blob; Zod-validated on read; extensible without migration
  preferences: json('preferences').notNull().default(sql`('{}')`),
  createdAt: timestamp('createdAt').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp('updatedAt')
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`)
    .onUpdateNow(),
});

// ============================================================
// Type exports for use in query wrappers and procedures
// ============================================================
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type TelemetryEvent = typeof telemetryEvents.$inferSelect;
export type NewTelemetryEvent = typeof telemetryEvents.$inferInsert;
export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;
export type Matter = typeof matters.$inferSelect;
export type NewMatter = typeof matters.$inferInsert;
export type Document = typeof documents.$inferSelect;
export type NewDocument = typeof documents.$inferInsert;
export type Version = typeof versions.$inferSelect;
export type NewVersion = typeof versions.$inferInsert;
export type MatterMaterial = typeof matterMaterials.$inferSelect;
export type NewMatterMaterial = typeof matterMaterials.$inferInsert;
export type DocumentReference = typeof documentReferences.$inferSelect;
export type NewDocumentReference = typeof documentReferences.$inferInsert;
export type UserPreferences = typeof userPreferences.$inferSelect;
export type NewUserPreferences = typeof userPreferences.$inferInsert;
