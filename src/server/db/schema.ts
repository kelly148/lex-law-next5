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
 * Phase 4a scope: templates, template_versions, template_variable_schemas tables.
 * Phase 4b scope: information_requests, information_request_items, document_outlines,
 *                  feedback, feedback_evaluations, feedback_manual_selections,
 *                  review_sessions tables.
 */

import {
  mysqlTable,
  char,
  varchar,
  timestamp,
  date,
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
  'reviewer_feedback',
  'evaluator',
  // context_summary_generation is reserved but not actively implemented in v1 (Ch 8.3 / D6)
  'context_summary_generation',
  // matter_analysis — FOLD-L0-1 Layer-0 single-lane analysis generation (jobType column is
  // varchar(64), not a DB enum, so adding this value requires NO schema migration).
  'matter_analysis',
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

// FOLD-L0-1 (Fork D): Layer-0 analysis status is ORTHOGONAL to `phase` — it does NOT
// perturb the linear intake→drafting→complete enum. none = no Layer-0 analysis;
// in_analysis = an assessment-and-plan is being worked; plan_locked = closed on a locked
// plan (a non-document closure). Hard-block (Fork A): advancing to drafting / locking a
// plan is blocked while blocker-severity conflict hits are undispositioned.
export const MATTER_ANALYSIS_STATUS_VALUES = ['none', 'in_analysis', 'plan_locked'] as const;
export type MatterAnalysisStatus = (typeof MATTER_ANALYSIS_STATUS_VALUES)[number];

export const matters = mysqlTable(
  'matters',
  {
    id: char('id', { length: 36 }).primaryKey(),
    userId: char('userId', { length: 36 }).notNull(),
    title: varchar('title', { length: 256 }).notNull(),
    clientName: varchar('clientName', { length: 256 }),
    // practiceArea: freeform string in v1; Learning Mode in v2 will curate (Ch 5.4)
    practiceArea: varchar('practiceArea', { length: 128 }),
    // R2-PRE-JURIS-1: governing jurisdiction ('VA' | 'MD'; attorney is dual-licensed). Additive,
    // nullable; set only by an explicit attorney act (matter.create / updateMetadata), never
    // inferred. The R2 #3 readiness strip leads with it. Free VARCHAR (not enum) so future
    // jurisdictions never trip the Zod Wall; the UI constrains the choices.
    jurisdiction: varchar('jurisdiction', { length: 16 }),
    // FOLD-KB-1 (Fork E): attorney-CONFIRMED practice-area key that maps this matter's freeform
    // practiceArea to a pa_instruction_profiles paKey. NULL = no confirmed profile (base prompt).
    // Set/changed only by an explicit attorney act; never silently inferred. Additive, nullable.
    paKey: varchar('paKey', { length: 64 }),
    // FOLD-ORCH-1 Inc2b (Fork C): per-matter reviewer-lane override (claude/gpt/gemini/grok
    // booleans). NULL = no override => fall back to the global ReviewerEnablement default.
    // Additive, nullable; set only by an explicit attorney act (matter.setOrchestrationLanes).
    // Validated on read by the Zod Wall (MatterRowSchema.orchestrationLanes).
    orchestrationLanes: json('orchestrationLanes'),
    phase: mysqlEnum('phase', MATTER_PHASE_VALUES).notNull().default('intake'),
    // FOLD-L0-1 (Fork D): orthogonal Layer-0 analysis status; default 'none' (additive —
    // pre-L0 matters and all existing rows are 'none'). Does not affect `phase`.
    analysisStatus: mysqlEnum('analysisStatus', MATTER_ANALYSIS_STATUS_VALUES)
      .notNull()
      .default('none'),
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
    // FOLD-KB-1 (Fork A): durable provenance flag — set TRUE when an unverified KB memo is
    // adopted into this document; SURVIVES drafting/versioning (lives on the document, not a
    // version). FOLD-SEND-1 reads this to gate outbound. Additive, defaulted false.
    drewOnUnverifiedKb: boolean('drewOnUnverifiedKb').notNull().default(false),
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
    // Materials list for a matter, sorted by recency (recency context-priority ordering)
    idxMaterialsUserMatterCreated: index(
      'idx_materials_user_matter_created',
    ).on(table.userId, table.matterId, table.deletedAt, table.createdAt),
    // Pinned materials query (pinned context-priority pipeline)
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
// LLM context (decision #36 / Ch 20.2 sibling context priority).
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
// Ch 4.12 — templates, template_versions, template_variable_schemas
// ============================================================
// templates: one row per template library entry. activeVersionId points to the
// currently-activated version (NULL until first activation).
//
// template_versions: immutable version snapshots. Each upload creates a new row.
// handlebarsSource: the extracted Handlebars text from the uploaded .docx.
// validationStatus: set synchronously on upload (phase-1 validation, Ch 12.4).
// activated: true when this version is (or was) the active version.
//
// template_variable_schemas: 1:1 with template_versions. Attorney-confirmed
// variable schema (field names, types, required flags). Zod-validated on read.
//
// Indexes (Ch 4.12):
//   idx_templates_user_type (userId, documentType, archivedAt)
//   uniq_template_versions (templateId, versionNumber)
//   uniq_schema_version (templateVersionId)
// ============================================================

export const TEMPLATE_VALIDATION_STATUS_VALUES = [
  'pending',
  'valid',
  'invalid',
] as const;
export type TemplateValidationStatus =
  (typeof TEMPLATE_VALIDATION_STATUS_VALUES)[number];

export const templates = mysqlTable(
  'templates',
  {
    id: char('id', { length: 36 }).primaryKey(),
    userId: char('userId', { length: 36 }).notNull(),
    name: varchar('name', { length: 256 }).notNull(),
    // documentType: registry key matching documents.documentType (Ch 6.2)
    documentType: varchar('documentType', { length: 64 }).notNull(),
    // activeVersionId: FK to template_versions.id; NULL until first activation
    activeVersionId: char('activeVersionId', { length: 36 }),
    archivedAt: timestamp('archivedAt'),
    createdAt: timestamp('createdAt').notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp('updatedAt')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`)
      .onUpdateNow(),
  },
  (table) => ({
    idxTemplatesUserType: index('idx_templates_user_type').on(
      table.userId,
      table.documentType,
      table.archivedAt,
    ),
  }),
);

export const templateVersions = mysqlTable(
  'template_versions',
  {
    id: char('id', { length: 36 }).primaryKey(),
    templateId: char('templateId', { length: 36 }).notNull(),
    versionNumber: int('versionNumber').notNull(),
    // fileStorageKey: original .docx location in blob storage
    fileStorageKey: varchar('fileStorageKey', { length: 512 }).notNull(),
    // handlebarsSource: extracted Handlebars template text (MEDIUMTEXT)
    handlebarsSource: mediumtext('handlebarsSource').notNull(),
    // validationStatus: set synchronously on upload (Ch 12.4)
    validationStatus: mysqlEnum(
      'validationStatus',
      TEMPLATE_VALIDATION_STATUS_VALUES,
    )
      .notNull()
      .default('pending'),
    // validationErrors: structured error list for display when invalid
    validationErrors: json('validationErrors'),
    // activated: true when this version is (or was) the active version
    activated: boolean('activated').notNull().default(false),
    createdAt: timestamp('createdAt').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    uniqTemplateVersions: uniqueIndex('uniq_template_versions').on(
      table.templateId,
      table.versionNumber,
    ),
  }),
);

export const templateVariableSchemas = mysqlTable(
  'template_variable_schemas',
  {
    id: char('id', { length: 36 }).primaryKey(),
    templateVersionId: char('templateVersionId', { length: 36 }).notNull(),
    // schema: JSON blob; Zod-validated on read; field types, required flags, validation rules
    schema: json('schema').notNull(),
    createdAt: timestamp('createdAt').notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp('updatedAt')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`)
      .onUpdateNow(),
  },
  (table) => ({
    uniqSchemaVersion: uniqueIndex('uniq_schema_version').on(
      table.templateVersionId,
    ),
  }),
);

// ============================================================
// Ch 4.10 — information_requests and information_request_items
// ============================================================
// information_requests: one active matrix per matter at a time (R10).
// activeMatterKey generated column enforces the at-most-one-active invariant
// via a unique index (MySQL/TiDB does not support partial unique index predicates).
//
// Indexes (Ch 4.10):
//   idx_info_requests_matter (userId, matterId, archivedAt)
//   uniq_active_matrix_per_matter (activeMatterKey)
//   idx_info_items_request_order (informationRequestId, orderIndex)
// ============================================================
export const INFORMATION_REQUEST_STATUS_VALUES = [
  'draft',
  'exported',
  'receiving_answers',
  'complete',
] as const;
export type InformationRequestStatus =
  (typeof INFORMATION_REQUEST_STATUS_VALUES)[number];

export const informationRequests = mysqlTable(
  'information_requests',
  {
    id: char('id', { length: 36 }).primaryKey(),
    userId: char('userId', { length: 36 }).notNull(),
    matterId: char('matterId', { length: 36 }).notNull(),
    status: mysqlEnum('status', INFORMATION_REQUEST_STATUS_VALUES)
      .notNull()
      .default('draft'),
    archivedAt: timestamp('archivedAt'),
    // -----------------------------------------------------------------------
    // D.1.2 — GENERATED column (raw SQL migration, not drizzle builder API)
    // This is a GENERATED column in the database.
    // DO NOT write to this field from application code.
    // Any INSERT or UPDATE setting this column will be rejected by TiDB.
    // The schema declaration exists for TypeScript type inference on reads only.
    // Reference: R10 and Ch 4.10 / Ch 4.8.
    // Migration SQL: `activeMatterKey` CHAR(36) GENERATED ALWAYS AS
    //   (CASE WHEN archivedAt IS NULL THEN matterId ELSE NULL END) STORED
    // -----------------------------------------------------------------------
    activeMatterKey: char('activeMatterKey', { length: 36 }),

    createdAt: timestamp('createdAt').notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp('updatedAt')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`)
      .onUpdateNow(),
  },
  (table) => ({
    idxInfoRequestsMatter: index('idx_info_requests_matter').on(
      table.userId,
      table.matterId,
      table.archivedAt,
    ),
    uniqActiveMatrixPerMatter: uniqueIndex('uniq_active_matrix_per_matter').on(
      table.activeMatterKey,
    ),
  }),
);

export const informationRequestItems = mysqlTable(
  'information_request_items',
  {
    id: char('id', { length: 36 }).primaryKey(),
    informationRequestId: char('informationRequestId', { length: 36 }).notNull(),
    category: varchar('category', { length: 64 }).notNull(),
    questionText: text('questionText').notNull(),
    answerText: text('answerText'),
    orderIndex: int('orderIndex').notNull(),
    createdAt: timestamp('createdAt').notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp('updatedAt')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`)
      .onUpdateNow(),
  },
  (table) => ({
    idxInfoItemsRequestOrder: index('idx_info_items_request_order').on(
      table.informationRequestId,
      table.orderIndex,
    ),
  }),
);

// ============================================================
// Ch 4.11 — document_outlines
// ============================================================
// One outline per document (enforced at application level).
// status: draft → approved | skipped.
// sections: JSON array of { title, description, orderIndex }.
//
// Indexes (Ch 4.11):
//   idx_outlines_user_document (userId, documentId)
// ============================================================
export const DOCUMENT_OUTLINE_STATUS_VALUES = [
  'draft',
  'approved',
  'skipped',
] as const;
export type DocumentOutlineStatus =
  (typeof DOCUMENT_OUTLINE_STATUS_VALUES)[number];

export const documentOutlines = mysqlTable(
  'document_outlines',
  {
    id: char('id', { length: 36 }).primaryKey(),
    userId: char('userId', { length: 36 }).notNull(),
    documentId: char('documentId', { length: 36 }).notNull(),
    status: mysqlEnum('status', DOCUMENT_OUTLINE_STATUS_VALUES)
      .notNull()
      .default('draft'),
    // sections: JSON array of { title, description, orderIndex }
    sections: json('sections').notNull().default(sql`(JSON_ARRAY())`),
    generatedByJobId: char('generatedByJobId', { length: 36 }),
    approvedAt: timestamp('approvedAt'),
    createdAt: timestamp('createdAt').notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp('updatedAt')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`)
      .onUpdateNow(),
  },
  (table) => ({
    idxOutlinesUserDocument: index('idx_outlines_user_document').on(
      table.userId,
      table.documentId,
    ),
  }),
);

// ============================================================
// Ch 4.7 — feedback, feedback_evaluations, feedback_manual_selections
// ============================================================
// feedback: one row per reviewer-model invocation per document iteration.
// feedback_evaluations: evaluator pass over multiple reviewers' output.
// feedback_manual_selections: attorney adoption decisions (R5 positive-selection-only).
//
// Indexes (Ch 4.7):
//   idx_feedback_user_document_iter (userId, documentId, iterationNumber DESC)
//   idx_feedback_session (reviewSessionId)
//   idx_feedback_eval_document_iter (documentId, iterationNumber)
//   uniq_manual_selections (reviewSessionId, suggestionId)
//   idx_manual_selections_session (reviewSessionId)
//   idx_manual_selections_document_iter (documentId, iterationNumber)
// ============================================================
export const feedback = mysqlTable(
  'feedback',
  {
    id: char('id', { length: 36 }).primaryKey(),
    userId: char('userId', { length: 36 }).notNull(),
    documentId: char('documentId', { length: 36 }).notNull(),
    versionId: char('versionId', { length: 36 }).notNull(),
    iterationNumber: int('iterationNumber').notNull(),
    reviewSessionId: char('reviewSessionId', { length: 36 }),
    jobId: char('jobId', { length: 36 }).notNull(),
    reviewerRole: varchar('reviewerRole', { length: 32 }).notNull(),
    reviewerModel: varchar('reviewerModel', { length: 64 }).notNull(),
    reviewerTitle: varchar('reviewerTitle', { length: 128 }).notNull(),
    // suggestions: JSON array of { suggestionId, title, body, severity? }
    suggestions: json('suggestions').notNull(),
    createdAt: timestamp('createdAt').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    idxFeedbackUserDocumentIter: index('idx_feedback_user_document_iter').on(
      table.userId,
      table.documentId,
      table.iterationNumber,
    ),
    idxFeedbackSession: index('idx_feedback_session').on(table.reviewSessionId),
  }),
);

export const feedbackEvaluations = mysqlTable(
  'feedback_evaluations',
  {
    id: char('id', { length: 36 }).primaryKey(),
    userId: char('userId', { length: 36 }).notNull(),
    documentId: char('documentId', { length: 36 }).notNull(),
    iterationNumber: int('iterationNumber').notNull(),
    jobId: char('jobId', { length: 36 }).notNull(),
    // dispositions: JSON array of { suggestionId, disposition, synthesisBody? }
    dispositions: json('dispositions').notNull(),
    // FOLD-ORCH-1 Inc3b: the evaluator's advisory cross-reviewer issue grouping (EvaluatorOutput
    // .issueGroups, Inc2a) captured from the SAME call. The GROUPING SOURCE for consolidation.
    // Additive, nullable; NULL = no grouping emitted (degrades to all-per-item). Advisory only.
    issueGroups: json('issueGroups'),
    createdAt: timestamp('createdAt').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    idxFeedbackEvalDocumentIter: index('idx_feedback_eval_document_iter').on(
      table.documentId,
      table.iterationNumber,
    ),
  }),
);

export const feedbackManualSelections = mysqlTable(
  'feedback_manual_selections',
  {
    id: char('id', { length: 36 }).primaryKey(),
    userId: char('userId', { length: 36 }).notNull(),
    documentId: char('documentId', { length: 36 }).notNull(),
    iterationNumber: int('iterationNumber').notNull(),
    reviewSessionId: char('reviewSessionId', { length: 36 }).notNull(),
    suggestionId: varchar('suggestionId', { length: 64 }).notNull(),
    attorneyNote: text('attorneyNote'),
    createdAt: timestamp('createdAt').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    uniqManualSelections: uniqueIndex('uniq_manual_selections').on(
      table.reviewSessionId,
      table.suggestionId,
    ),
    idxManualSelectionsSession: index('idx_manual_selections_session').on(
      table.reviewSessionId,
    ),
    idxManualSelectionsDocumentIter: index('idx_manual_selections_document_iter').on(
      table.documentId,
      table.iterationNumber,
    ),
  }),
);

// ============================================================
// Ch 4.8 — review_sessions
// ============================================================
// One active session per (documentId, iterationNumber) at a time (R10).
// activeSessionKey generated column enforces the at-most-one-active invariant
// via a unique index (MySQL/TiDB does not support partial unique index predicates).
//
// Indexes (Ch 4.8):
//   idx_review_sessions_user_document (userId, documentId, iterationNumber DESC)
//   uniq_active_review_session (activeSessionKey)
// ============================================================
export const REVIEW_SESSION_STATE_VALUES = [
  'active',
  'regenerated',
  'abandoned',
] as const;
export type ReviewSessionState =
  (typeof REVIEW_SESSION_STATE_VALUES)[number];

export const reviewSessions = mysqlTable(
  'review_sessions',
  {
    id: char('id', { length: 36 }).primaryKey(),
    userId: char('userId', { length: 36 }).notNull(),
    documentId: char('documentId', { length: 36 }).notNull(),
    iterationNumber: int('iterationNumber').notNull(),
    state: mysqlEnum('state', REVIEW_SESSION_STATE_VALUES)
      .notNull()
      .default('active'),
    // selections: JSON array of { feedbackId: string, note: string | null }
    selections: json('selections').notNull().default(sql`(JSON_ARRAY())`),
    // selectedReviewers: JSON array of reviewer role identifiers (Zod Wall)
    selectedReviewers: json('selectedReviewers').notNull().default(sql`(JSON_ARRAY())`),
    globalInstructions: text('globalInstructions').notNull().default(''),
    lastAutosavedAt: timestamp('lastAutosavedAt'),
    // -----------------------------------------------------------------------
    // D.1.2 — GENERATED column (raw SQL migration, not drizzle builder API)
    // This is a GENERATED column in the database.
    // DO NOT write to this field from application code.
    // Any INSERT or UPDATE setting this column will be rejected by TiDB.
    // The schema declaration exists for TypeScript type inference on reads only.
    // Reference: R10 and Ch 4.10 / Ch 4.8.
    // Migration SQL: `activeSessionKey` VARCHAR(64) GENERATED ALWAYS AS
    //   (CASE WHEN state = 'active'
    //    THEN CONCAT(documentId, '-', LPAD(iterationNumber, 10, '0'))
    //    ELSE NULL END) STORED
    // -----------------------------------------------------------------------
    activeSessionKey: varchar('activeSessionKey', { length: 64 }),

    createdAt: timestamp('createdAt').notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp('updatedAt')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`)
      .onUpdateNow(),
  },
  (table) => ({
    idxReviewSessionsUserDocument: index('idx_review_sessions_user_document').on(
      table.userId,
      table.documentId,
      table.iterationNumber,
    ),
    uniqActiveReviewSession: uniqueIndex('uniq_active_review_session').on(
      table.activeSessionKey,
    ),
  }),
);

// ============================================================
// MR-CAL-6B — locked_decisions
// ============================================================
// Attorney-locked decisions a reviewer should respect ("do not re-raise
// absent a material new fact"). Phase A: DOCUMENT-LEVEL scope only (a lock
// applies to the document it was made on). The `scope` column exists so a
// future matter-level rollout is additive (no destructive migration).
//
// Created via two attorney actions (origin):
//   'declined' — decline-&-lock: a considered-and-declined suggestion
//   'adopted'  — lock-on-adopt: an adopted suggestion remembered as a decision
//
// Provenance: userId (who), sourceSuggestionId / sourceIterationNumber /
// reviewSessionId (where it came from), timestamps.
//
// Lifecycle: status 'active' -> 'unlocked' (unlock preserves the row for audit).
//
// Indexes:
//   idx_locked_decisions_document (documentId, status) — prompt-injection read path
//   idx_locked_decisions_user_document (userId, documentId)
//   uniq_locked_decision_suggestion (documentId, sourceSuggestionId)
// ============================================================
export const LOCKED_DECISION_SCOPE_VALUES = ['document'] as const;
export type LockedDecisionScope =
  (typeof LOCKED_DECISION_SCOPE_VALUES)[number];

export const LOCKED_DECISION_ORIGIN_VALUES = ['declined', 'adopted'] as const;
export type LockedDecisionOrigin =
  (typeof LOCKED_DECISION_ORIGIN_VALUES)[number];

export const LOCKED_DECISION_STATUS_VALUES = ['active', 'unlocked'] as const;
export type LockedDecisionStatus =
  (typeof LOCKED_DECISION_STATUS_VALUES)[number];

export const lockedDecisions = mysqlTable(
  'locked_decisions',
  {
    id: char('id', { length: 36 }).primaryKey(),
    userId: char('userId', { length: 36 }).notNull(),
    documentId: char('documentId', { length: 36 }).notNull(),
    // Denormalized for a future matter-level rollout + scoping.
    matterId: char('matterId', { length: 36 }).notNull(),
    // Phase A is always 'document'; column reserved for future matter-level.
    scope: mysqlEnum('scope', LOCKED_DECISION_SCOPE_VALUES)
      .notNull()
      .default('document'),
    origin: mysqlEnum('origin', LOCKED_DECISION_ORIGIN_VALUES).notNull(),
    // Provenance link to the originating feedback suggestion (nullable for safety).
    sourceSuggestionId: varchar('sourceSuggestionId', { length: 64 }),
    sourceIterationNumber: int('sourceIterationNumber'),
    reviewSessionId: char('reviewSessionId', { length: 36 }),
    // Short attorney-facing statement of what should not be re-raised.
    summary: text('summary').notNull(),
    // Attorney rationale (provenance). NOTE: flows to LLM providers (no redaction).
    rationale: text('rationale'),
    status: mysqlEnum('status', LOCKED_DECISION_STATUS_VALUES)
      .notNull()
      .default('active'),
    createdAt: timestamp('createdAt').notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp('updatedAt')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`)
      .onUpdateNow(),
  },
  (table) => ({
    idxLockedDecisionsDocument: index('idx_locked_decisions_document').on(
      table.documentId,
      table.status,
    ),
    idxLockedDecisionsUserDocument: index('idx_locked_decisions_user_document').on(
      table.userId,
      table.documentId,
    ),
    uniqLockedDecisionSuggestion: uniqueIndex('uniq_locked_decision_suggestion').on(
      table.documentId,
      table.sourceSuggestionId,
    ),
  }),
);

// ============================================================
// MR-CAL-7B — adopt_ledger
// ============================================================
// Cumulative record of reviewer suggestions the attorney ADOPTED (verbatim or
// modified), tracked across regeneration. Separate from locked_decisions (6B):
// locks = "do not re-raise" (suppression); ledger = "this was adopted; carry it
// forward + track survival". No auto-coupling between the two (MR-CAL-7A).
//
// Captured at the existing adopt/regenerate commit point alongside
// feedback_manual_selections (additive; selections keep their per-iteration role).
//
// disposition: adopted_verbatim | adopted_modified (adoptedText == originalText when verbatim).
// status: active | superseded | resolved | unresolved.
//   unresolved = adopted but not yet carried into a regeneration (no producedVersion).
//   active     = adopted and believed present in the current draft.
//   superseded = a newer version exists and advisory auto-detection no longer finds the text.
//   resolved   = attorney explicitly closed it.
// statusSource: auto | attorney. Auto-detection NEVER overwrites an attorney-set status,
//   never deletes/hides a row; the attorney can always override (advisory by design — LLM
//   drafter paraphrase makes exact survival detection unreliable; MR-CAL-7A/7B).
//
// Indexes:
//   idx_adopt_ledger_document (documentId, status) — prompt-injection + UI read path
//   idx_adopt_ledger_user_document (userId, documentId)
//   uniq_adopt_ledger_session_suggestion (reviewSessionId, sourceSuggestionId)
// ============================================================
export const ADOPT_LEDGER_DISPOSITION_VALUES = ['adopted_verbatim', 'adopted_modified'] as const;
export type AdoptLedgerDisposition =
  (typeof ADOPT_LEDGER_DISPOSITION_VALUES)[number];

export const ADOPT_LEDGER_STATUS_VALUES = ['active', 'superseded', 'resolved', 'unresolved'] as const;
export type AdoptLedgerStatus =
  (typeof ADOPT_LEDGER_STATUS_VALUES)[number];

export const ADOPT_LEDGER_STATUS_SOURCE_VALUES = ['auto', 'attorney'] as const;
export type AdoptLedgerStatusSource =
  (typeof ADOPT_LEDGER_STATUS_SOURCE_VALUES)[number];

export const adoptLedger = mysqlTable(
  'adopt_ledger',
  {
    id: char('id', { length: 36 }).primaryKey(),
    userId: char('userId', { length: 36 }).notNull(),
    documentId: char('documentId', { length: 36 }).notNull(),
    matterId: char('matterId', { length: 36 }).notNull(),
    sourceSuggestionId: varchar('sourceSuggestionId', { length: 64 }).notNull(),
    sourceReviewerRole: varchar('sourceReviewerRole', { length: 64 }).notNull(),
    sourceIterationNumber: int('sourceIterationNumber').notNull(),
    reviewSessionId: char('reviewSessionId', { length: 36 }).notNull(),
    disposition: mysqlEnum('disposition', ADOPT_LEDGER_DISPOSITION_VALUES).notNull(),
    // The suggestion text as the reviewer wrote it (provenance).
    originalText: text('originalText').notNull(),
    // What the attorney actually adopted (== originalText when verbatim). Flows to LLM providers.
    adoptedText: text('adoptedText').notNull(),
    // The document version current at adopt time (the regeneration INPUT version).
    adoptedIntoVersionId: char('adoptedIntoVersionId', { length: 36 }).notNull(),
    // The version produced by the regeneration that consumed this adoption (set when known).
    producedVersionId: char('producedVersionId', { length: 36 }),
    status: mysqlEnum('status', ADOPT_LEDGER_STATUS_VALUES).notNull().default('unresolved'),
    statusSource: mysqlEnum('statusSource', ADOPT_LEDGER_STATUS_SOURCE_VALUES)
      .notNull()
      .default('auto'),
    // FOLD-ORCH-1 Inc3 (audit named change): the per-item CONFIRMATION MODE — HOW the attorney
    // confirmed this adoption (bulk-acknowledged-low-severity-convergent vs individually-adopted
    // vs synthesis-adopted, etc). NEVER flattened to "adopted". Additive, nullable; legacy rows =
    // NULL. Values mirror CONFIRMATION_MODE_VALUES in shared/schemas/orchestration.ts.
    confirmationMode: varchar('confirmationMode', { length: 64 }),
    createdAt: timestamp('createdAt').notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp('updatedAt')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`)
      .onUpdateNow(),
  },
  (table) => ({
    idxAdoptLedgerDocument: index('idx_adopt_ledger_document').on(
      table.documentId,
      table.status,
    ),
    idxAdoptLedgerUserDocument: index('idx_adopt_ledger_user_document').on(
      table.userId,
      table.documentId,
    ),
    uniqAdoptLedgerSessionSuggestion: uniqueIndex('uniq_adopt_ledger_session_suggestion').on(
      table.reviewSessionId,
      table.sourceSuggestionId,
    ),
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
export type Template = typeof templates.$inferSelect;
export type NewTemplate = typeof templates.$inferInsert;
export type TemplateVersion = typeof templateVersions.$inferSelect;
export type NewTemplateVersion = typeof templateVersions.$inferInsert;
export type TemplateVariableSchema = typeof templateVariableSchemas.$inferSelect;
export type NewTemplateVariableSchema = typeof templateVariableSchemas.$inferInsert;
export type InformationRequest = typeof informationRequests.$inferSelect;
export type NewInformationRequest = typeof informationRequests.$inferInsert;
export type InformationRequestItem = typeof informationRequestItems.$inferSelect;
export type NewInformationRequestItem = typeof informationRequestItems.$inferInsert;
export type DocumentOutline = typeof documentOutlines.$inferSelect;
export type NewDocumentOutline = typeof documentOutlines.$inferInsert;
export type Feedback = typeof feedback.$inferSelect;
export type NewFeedback = typeof feedback.$inferInsert;
export type FeedbackEvaluation = typeof feedbackEvaluations.$inferSelect;
export type NewFeedbackEvaluation = typeof feedbackEvaluations.$inferInsert;
export type FeedbackManualSelection = typeof feedbackManualSelections.$inferSelect;
export type NewFeedbackManualSelection = typeof feedbackManualSelections.$inferInsert;
export type ReviewSession = typeof reviewSessions.$inferSelect;
export type NewReviewSession = typeof reviewSessions.$inferInsert;
export type LockedDecision = typeof lockedDecisions.$inferSelect;
export type NewLockedDecision = typeof lockedDecisions.$inferInsert;
export type AdoptLedger = typeof adoptLedger.$inferSelect;
export type NewAdoptLedger = typeof adoptLedger.$inferInsert;

// ============================================================
// FOLD-GOV-1a — audit_events (Audit-as-Matter-Record)
// ============================================================
// Immutable, append-only per-matter governance record, DISTINCT from the
// operational telemetry_events stream: what each model said, what was
// adopted/rejected/locked/sent/withheld, what authority was verified, what
// required judgment. Append-only — the query wrapper exposes insert + read only
// (no updatedAt; rows are never modified after insert).
// Indexes: (matterId, createdAt) read path; (userId, matterId) owner scope.
// ============================================================
// FOLD-L1-1 (Fork C / operator disposition item 4): 'disposition' is added so an
// attorney decision (accept/override of an evaluator disposition, open-item, or
// source tier) is recorded in the SAME append-only audit_events stream. Disposition
// history is a READ-PROJECTION over audit_events — there is no separate authoritative
// dispositions table.
export const AUDIT_EVENT_TYPE_VALUES = [
  'model_output',
  'adopted',
  'rejected',
  'locked',
  'unlocked',
  'sent',
  'withheld',
  'authority_verified',
  'judgment_required',
  'disposition',
  // FOLD-PM-1 Inc 3 — deadline engine system events (audited DISTINCTLY from attorney disposition).
  'deadline_fired', // the system surfaced a tickler/deadline (system actor; not an acknowledgment)
  'deadline_acknowledged', // the attorney acknowledged a fired tickler (distinct from the firing)
] as const;
export type AuditEventType = (typeof AUDIT_EVENT_TYPE_VALUES)[number];

export const AUDIT_EVENT_ACTOR_VALUES = ['model', 'attorney', 'system'] as const;
export type AuditEventActor = (typeof AUDIT_EVENT_ACTOR_VALUES)[number];

export const auditEvents = mysqlTable(
  'audit_events',
  {
    id: char('id', { length: 36 }).primaryKey(),
    userId: char('userId', { length: 36 }).notNull(),
    matterId: char('matterId', { length: 36 }).notNull(),
    documentId: char('documentId', { length: 36 }),
    eventType: mysqlEnum('eventType', AUDIT_EVENT_TYPE_VALUES).notNull(),
    actor: mysqlEnum('actor', AUDIT_EVENT_ACTOR_VALUES).notNull(),
    actorModel: varchar('actorModel', { length: 64 }),
    summary: text('summary').notNull(),
    payload: json('payload'),
    reviewSessionId: char('reviewSessionId', { length: 36 }),
    sourceSuggestionId: varchar('sourceSuggestionId', { length: 64 }),
    versionId: char('versionId', { length: 36 }),
    // --------------------------------------------------------------------------
    // FOLD-L1-1 (Fork C / disposition item 4) — disposition-detail columns.
    // ADDITIVE (migration 0005 ALTER TABLE ... ADD COLUMN). All nullable so every
    // pre-existing audit_events row remains valid. These let audit_events carry the
    // full attorney-decision record (and back the disposition-history read-projection)
    // without a new authoritative table:
    //   targetType — what the decision acted on ('open_item','source_authority',
    //                'adopt_ledger','locked_decision','document','matter', …)
    //   targetId   — the acted-on row id (open_items.id, source_authority.id, …)
    //   action     — the decision verb ('open','resolve','withdraw','set_tier',
    //                'accept','override', …)
    //   rationale  — attorney rationale (provenance; flows to LLM providers, no redaction)
    //   scope      — 'matter' | 'document' (matter-vs-document scope of the decision)
    // --------------------------------------------------------------------------
    targetType: varchar('targetType', { length: 32 }),
    targetId: varchar('targetId', { length: 64 }),
    action: varchar('action', { length: 64 }),
    rationale: text('rationale'),
    scope: varchar('scope', { length: 16 }),
    createdAt: timestamp('createdAt').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    idxAuditEventsMatter: index('idx_audit_events_matter').on(table.matterId, table.createdAt),
    idxAuditEventsUserMatter: index('idx_audit_events_user_matter').on(table.userId, table.matterId),
    // FOLD-L1-1: disposition-history read-projection path (decisions about a target).
    idxAuditEventsTarget: index('idx_audit_events_target').on(table.matterId, table.targetType, table.targetId),
  }),
);

export type AuditEvent = typeof auditEvents.$inferSelect;
export type NewAuditEvent = typeof auditEvents.$inferInsert;

// ============================================================
// FOLD-L1-1 (Fork A) — source_authority
// ============================================================
// Source-of-truth tier/authority for the materials and document artifacts in play.
// DEDICATED TABLE (operator disposition item 3), NOT a column on matter_materials,
// so the two axes stay first-class and a tier is an explicit attorney act with a
// conservative default — NEVER inferred. This is DISTINCT from context/pipeline.ts
// `contextPriority` (pinned|recency), which is context-WINDOW priority, not authority.
//
// Two orthogonal axes (disposition item 3):
//   authorityOrigin — WHERE the authority comes from / whose instrument it is
//                     (operative | counterparty | firm | client | model_derived | reference)
//   lifecycle       — currency/recency (current_draft | operative | superseded)
//
// Plus: designationSource (who set the tier), verificationStatus + staleness columns
// (added now, NO currency/jurisdiction CHECKING behavior — disposition item 8), and a
// supersession chain (effectiveFrom / supersededAt / supersededById).
//
// Subject: the artifact this authority record describes (a material, a document, or a
// specific version). matterId is denormalized (notNull) for matter-scoping + the
// owner/integrity invariant; documentId is nullable (matter-level rows leave it null).
//
// Indexes:
//   idx_source_authority_matter (userId, matterId)
//   idx_source_authority_subject (matterId, subjectType, subjectId)
//   idx_source_authority_lifecycle (matterId, lifecycle)
// ============================================================
export const SOURCE_AUTHORITY_ORIGIN_VALUES = [
  'operative',
  'counterparty',
  'firm',
  'client',
  'model_derived',
  'reference',
] as const;
export type SourceAuthorityOrigin =
  (typeof SOURCE_AUTHORITY_ORIGIN_VALUES)[number];

export const SOURCE_AUTHORITY_LIFECYCLE_VALUES = [
  'current_draft',
  'operative',
  'superseded',
] as const;
export type SourceAuthorityLifecycle =
  (typeof SOURCE_AUTHORITY_LIFECYCLE_VALUES)[number];

export const SOURCE_AUTHORITY_DESIGNATION_SOURCE_VALUES = [
  'attorney',
  'system',
  'imported',
  'counterparty',
  'client',
] as const;
export type SourceAuthorityDesignationSource =
  (typeof SOURCE_AUTHORITY_DESIGNATION_SOURCE_VALUES)[number];

export const SOURCE_AUTHORITY_VERIFICATION_STATUS_VALUES = [
  'unverified',
  'verified',
  'stale',
] as const;
export type SourceAuthorityVerificationStatus =
  (typeof SOURCE_AUTHORITY_VERIFICATION_STATUS_VALUES)[number];

export const SOURCE_AUTHORITY_SUBJECT_TYPE_VALUES = [
  'material',
  'document',
  'version',
] as const;
export type SourceAuthoritySubjectType =
  (typeof SOURCE_AUTHORITY_SUBJECT_TYPE_VALUES)[number];

export const sourceAuthority = mysqlTable(
  'source_authority',
  {
    id: char('id', { length: 36 }).primaryKey(),
    userId: char('userId', { length: 36 }).notNull(),
    matterId: char('matterId', { length: 36 }).notNull(),
    // Nullable: matter-level authority rows leave documentId null (Fork D).
    documentId: char('documentId', { length: 36 }),
    // The artifact this authority record describes.
    subjectType: mysqlEnum('subjectType', SOURCE_AUTHORITY_SUBJECT_TYPE_VALUES).notNull(),
    subjectId: char('subjectId', { length: 36 }).notNull(),
    // Axis 1 — authority/origin. Conservative default; an attorney act overrides it.
    authorityOrigin: mysqlEnum('authorityOrigin', SOURCE_AUTHORITY_ORIGIN_VALUES)
      .notNull()
      .default('reference'),
    // Axis 2 — lifecycle/recency.
    lifecycle: mysqlEnum('lifecycle', SOURCE_AUTHORITY_LIFECYCLE_VALUES)
      .notNull()
      .default('operative'),
    // Who set the tier. Default 'system' (the conservative default); 'attorney' once
    // an attorney explicitly designates — the tier is NEVER inferred from content.
    designationSource: mysqlEnum('designationSource', SOURCE_AUTHORITY_DESIGNATION_SOURCE_VALUES)
      .notNull()
      .default('system'),
    // Attorney-facing label/notes (provenance; flows to LLM providers, no redaction).
    label: varchar('label', { length: 256 }),
    notes: text('notes'),
    // Staleness/verification — COLUMNS ONLY, no checking behavior (disposition item 8).
    verificationStatus: mysqlEnum('verificationStatus', SOURCE_AUTHORITY_VERIFICATION_STATUS_VALUES)
      .notNull()
      .default('unverified'),
    lastVerifiedAt: timestamp('lastVerifiedAt'),
    stalenessReason: varchar('stalenessReason', { length: 256 }),
    // Supersession chain.
    effectiveFrom: timestamp('effectiveFrom'),
    supersededAt: timestamp('supersededAt'),
    supersededById: char('supersededById', { length: 36 }),
    createdAt: timestamp('createdAt').notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp('updatedAt')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`)
      .onUpdateNow(),
  },
  (table) => ({
    idxSourceAuthorityMatter: index('idx_source_authority_matter').on(
      table.userId,
      table.matterId,
    ),
    idxSourceAuthoritySubject: index('idx_source_authority_subject').on(
      table.matterId,
      table.subjectType,
      table.subjectId,
    ),
    idxSourceAuthorityLifecycle: index('idx_source_authority_lifecycle').on(
      table.matterId,
      table.lifecycle,
    ),
  }),
);

export type SourceAuthority = typeof sourceAuthority.$inferSelect;
export type NewSourceAuthority = typeof sourceAuthority.$inferInsert;

// ============================================================
// FOLD-L1-1 (Fork B + Fork D) — open_items
// ============================================================
// Persistent registry of open items / blockers still requiring attorney action —
// the durable lifecycle that sendability blockers (MR-CAL-8C, advisory + non-persisted)
// never had. Matter-level AND document-level from day one (Fork D): matter-level rows
// (jurisdiction, client objective, negotiation posture, internal thresholds) leave
// documentId null and are NEVER forced onto a document; document-level rows roll up to
// the matter summary.
//
// DEFAULT-SAFE (operator disposition item 6): auto-detection MAY create or refresh an
// item (statusSource='auto', lastSeenAt bumped) but NEVER closes an attorney-opened or
// attorney-confirmed item. Escalation is by SEVERITY: BLOCKER (and material SUBSTANTIVE
// / attorney-confirmed / recurring) auto-register; POLISH does not. Resolution links to
// the immutable audit_events row that recorded the decision (resolvedByEventId) plus a
// rationale.
//
// Indexes:
//   idx_open_items_matter (userId, matterId)
//   idx_open_items_matter_status (matterId, status)
//   idx_open_items_document_status (documentId, status)
// ============================================================
export const OPEN_ITEM_SEVERITY_VALUES = ['blocker', 'substantive', 'polish'] as const;
export type OpenItemSeverity = (typeof OPEN_ITEM_SEVERITY_VALUES)[number];

export const OPEN_ITEM_STATUS_VALUES = ['open', 'resolved', 'withdrawn'] as const;
export type OpenItemStatus = (typeof OPEN_ITEM_STATUS_VALUES)[number];

export const OPEN_ITEM_STATUS_SOURCE_VALUES = ['auto', 'attorney'] as const;
export type OpenItemStatusSource = (typeof OPEN_ITEM_STATUS_SOURCE_VALUES)[number];

export const OPEN_ITEM_CONFIDENCE_VALUES = ['low', 'medium', 'high'] as const;
export type OpenItemConfidence = (typeof OPEN_ITEM_CONFIDENCE_VALUES)[number];

export const openItems = mysqlTable(
  'open_items',
  {
    id: char('id', { length: 36 }).primaryKey(),
    userId: char('userId', { length: 36 }).notNull(),
    matterId: char('matterId', { length: 36 }).notNull(),
    // Nullable: matter-level items leave documentId null (Fork D); they are never
    // forced onto a document.
    documentId: char('documentId', { length: 36 }),
    // Freeform category (e.g. sendability blocker categories, 'governing_law',
    // 'jurisdiction', 'client_objective', 'negotiation_posture').
    category: varchar('category', { length: 64 }).notNull(),
    severity: mysqlEnum('severity', OPEN_ITEM_SEVERITY_VALUES).notNull(),
    summary: text('summary').notNull(),
    status: mysqlEnum('status', OPEN_ITEM_STATUS_VALUES).notNull().default('open'),
    // auto-detection NEVER overwrites an attorney-set status (mirrors adopt_ledger).
    statusSource: mysqlEnum('statusSource', OPEN_ITEM_STATUS_SOURCE_VALUES)
      .notNull()
      .default('auto'),
    // Provenance (disposition item 6).
    origin: varchar('origin', { length: 64 }).notNull(),
    confidence: mysqlEnum('confidence', OPEN_ITEM_CONFIDENCE_VALUES),
    requiresAttorneyConfirmation: boolean('requiresAttorneyConfirmation')
      .notNull()
      .default(false),
    sourceSuggestionId: varchar('sourceSuggestionId', { length: 64 }),
    reviewSessionId: char('reviewSessionId', { length: 36 }),
    versionId: char('versionId', { length: 36 }),
    // Auto-detection refresh timestamp (create-or-refresh, never close).
    lastSeenAt: timestamp('lastSeenAt'),
    // Resolution link to the immutable audit_events decision + rationale.
    resolvedByEventId: char('resolvedByEventId', { length: 36 }),
    resolutionRationale: text('resolutionRationale'),
    // FOLD-ORCH-1 Inc3 (Fork E): content-preserving payload for a divergent reviewer item — the
    // per-reviewer positions (severity + rationale excerpt), optional evaluator synthesis, and
    // source session, so the disagreement survives intact (not collapsed to the summary string).
    // Additive, nullable JSON; non-orchestration open items leave it NULL. Validated by the
    // orchestration layer (DivergentOpenItemSchema) on write/read.
    detail: json('detail'),
    createdAt: timestamp('createdAt').notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp('updatedAt')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`)
      .onUpdateNow(),
  },
  (table) => ({
    idxOpenItemsMatter: index('idx_open_items_matter').on(table.userId, table.matterId),
    idxOpenItemsMatterStatus: index('idx_open_items_matter_status').on(
      table.matterId,
      table.status,
    ),
    idxOpenItemsDocumentStatus: index('idx_open_items_document_status').on(
      table.documentId,
      table.status,
    ),
  }),
);

export type OpenItem = typeof openItems.$inferSelect;
export type NewOpenItem = typeof openItems.$inferInsert;

// ============================================================
// FOLD-DRAFT-1 — provision_provenance (Increment 1: data core)
// ============================================================
// Per draft SECTION (provision), where it came from. Version-anchored. DEFAULT-SAFE: recorded +
// surfaced, NEVER used to auto-justify outbound legal assertions (mirrors KB private-by-default).
// recordedBy distinguishes an attorney attribution from a system one. No prompt injection / no
// auto-use in Increment 1. Enum values mirror ProvisionProvenanceRowSchema (shared Zod Wall).
// ============================================================
export const PROVISION_ORIGIN_TYPE_VALUES = [
  'operative_source',
  'material',
  'adopted_suggestion',
  'template',
  'attorney_authored',
  'model_generated',
  'loi',
] as const;
export type ProvisionOriginType = (typeof PROVISION_ORIGIN_TYPE_VALUES)[number];

export const PROVISION_RECORDED_BY_VALUES = ['attorney', 'system'] as const;
export type ProvisionRecordedBy = (typeof PROVISION_RECORDED_BY_VALUES)[number];

export const provisionProvenance = mysqlTable(
  'provision_provenance',
  {
    id: char('id', { length: 36 }).primaryKey(),
    userId: char('userId', { length: 36 }).notNull(),
    matterId: char('matterId', { length: 36 }).notNull(),
    documentId: char('documentId', { length: 36 }).notNull(),
    versionId: char('versionId', { length: 36 }).notNull(),
    // The provision = an outline section, identified by its order index + title for this version.
    orderIndex: int('orderIndex').notNull(),
    sectionTitle: varchar('sectionTitle', { length: 256 }).notNull(),
    originType: mysqlEnum('originType', PROVISION_ORIGIN_TYPE_VALUES).notNull(),
    // The source/material/adoption/template id (NULL for attorney_authored / model_generated).
    originId: varchar('originId', { length: 64 }),
    originLabel: varchar('originLabel', { length: 512 }),
    recordedBy: mysqlEnum('recordedBy', PROVISION_RECORDED_BY_VALUES).notNull(),
    notes: text('notes'),
    createdAt: timestamp('createdAt').notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp('updatedAt')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`)
      .onUpdateNow(),
  },
  (table) => ({
    idxProvisionProvenanceVersion: index('idx_provision_provenance_version').on(table.versionId),
    idxProvisionProvenanceDocument: index('idx_provision_provenance_document').on(table.documentId),
    idxProvisionProvenanceUserMatter: index('idx_provision_provenance_user_matter').on(
      table.userId,
      table.matterId,
    ),
  }),
);

export type ProvisionProvenance = typeof provisionProvenance.$inferSelect;
export type NewProvisionProvenance = typeof provisionProvenance.$inferInsert;

// ============================================================
// FOLD-DRAFT-1 / LDD — ldd_key_term (Increment 1: data core)
// ============================================================
// The "key-term dictionary" behind the LDD (LOI-vs-draft diff): per document+version, the defined
// terms whose agreed VALUE must stay consistent between the operative source (LOI / material) and
// the current draft. DEFAULT-SAFE / READ-ONLY: recorded + surfaced and (later increment) compared
// to FLAG drift; never edits the draft, never auto-justifies an outbound assertion. recordedBy
// distinguishes an attorney entry from a system one. Enum values mirror LddKeyTermRowSchema (shared
// Zod Wall). The sourceType<->sourceId invariant is a later-increment record-time rule.
// ============================================================
export const LDD_KEY_TERM_SOURCE_TYPE_VALUES = [
  'loi',
  'operative_source',
  'material',
  'attorney_specified',
] as const;
export type LddKeyTermSourceType = (typeof LDD_KEY_TERM_SOURCE_TYPE_VALUES)[number];

export const LDD_KEY_TERM_RECORDED_BY_VALUES = ['attorney', 'system'] as const;
export type LddKeyTermRecordedBy = (typeof LDD_KEY_TERM_RECORDED_BY_VALUES)[number];

export const lddKeyTerm = mysqlTable(
  'ldd_key_term',
  {
    id: char('id', { length: 36 }).primaryKey(),
    userId: char('userId', { length: 36 }).notNull(),
    matterId: char('matterId', { length: 36 }).notNull(),
    documentId: char('documentId', { length: 36 }).notNull(),
    versionId: char('versionId', { length: 36 }).notNull(),
    // The defined/operative term whose value must stay consistent (e.g. "Governing Law").
    termLabel: varchar('termLabel', { length: 256 }).notNull(),
    // The agreed value for that term, taken from the operative source / LOI (e.g. "Virginia").
    expectedValue: text('expectedValue').notNull(),
    sourceType: mysqlEnum('sourceType', LDD_KEY_TERM_SOURCE_TYPE_VALUES).notNull(),
    // The LOI/source/material id (NULL for attorney_specified, which has no concrete source).
    sourceId: varchar('sourceId', { length: 64 }),
    notes: text('notes'),
    recordedBy: mysqlEnum('recordedBy', LDD_KEY_TERM_RECORDED_BY_VALUES).notNull(),
    createdAt: timestamp('createdAt').notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp('updatedAt')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`)
      .onUpdateNow(),
  },
  (table) => ({
    idxLddKeyTermVersion: index('idx_ldd_key_term_version').on(table.versionId),
    idxLddKeyTermDocument: index('idx_ldd_key_term_document').on(table.documentId),
    idxLddKeyTermUserMatter: index('idx_ldd_key_term_user_matter').on(table.userId, table.matterId),
  }),
);

export type LddKeyTerm = typeof lddKeyTerm.$inferSelect;
export type NewLddKeyTerm = typeof lddKeyTerm.$inferInsert;

// ============================================================
// FOLD-DRAFT-1 / package — closure_package_item (Increment 1: data core)
// ============================================================
// The "closing package": per matter, the artifacts (documents/materials/sources) + checklist items
// gathered into a named, self-contained bundle for hand-off/closure, each marked required-vs-optional
// and present/missing/not-applicable. A package = rows sharing (matterId, packageName). DEFAULT-SAFE
// / ADVISORY: records + surfaces contents and (later increment) computes a completeness check; it
// NEVER finalizes, sends, or locks anything (sending is FOLD-SEND-1). recordedBy distinguishes an
// attorney entry from a system one. Enum values mirror ClosurePackageItemRowSchema (shared Zod Wall).
// The itemType<->refId invariant is a later-increment record-time rule.
// ============================================================
export const CLOSURE_PACKAGE_ITEM_TYPE_VALUES = ['document', 'material', 'source', 'checklist'] as const;
export type ClosurePackageItemType = (typeof CLOSURE_PACKAGE_ITEM_TYPE_VALUES)[number];

export const CLOSURE_PACKAGE_REQUIREMENT_VALUES = ['required', 'optional'] as const;
export type ClosurePackageRequirement = (typeof CLOSURE_PACKAGE_REQUIREMENT_VALUES)[number];

export const CLOSURE_PACKAGE_ITEM_STATUS_VALUES = ['present', 'missing', 'not_applicable'] as const;
export type ClosurePackageItemStatus = (typeof CLOSURE_PACKAGE_ITEM_STATUS_VALUES)[number];

export const CLOSURE_PACKAGE_RECORDED_BY_VALUES = ['attorney', 'system'] as const;
export type ClosurePackageRecordedBy = (typeof CLOSURE_PACKAGE_RECORDED_BY_VALUES)[number];

export const closurePackageItem = mysqlTable(
  'closure_package_item',
  {
    id: char('id', { length: 36 }).primaryKey(),
    userId: char('userId', { length: 36 }).notNull(),
    matterId: char('matterId', { length: 36 }).notNull(),
    // Groups items into a named package (a package = rows sharing matterId+packageName).
    packageName: varchar('packageName', { length: 256 }).notNull(),
    itemType: mysqlEnum('itemType', CLOSURE_PACKAGE_ITEM_TYPE_VALUES).notNull(),
    // The document/material/source id (NULL for a free-form checklist item).
    refId: varchar('refId', { length: 64 }),
    label: varchar('label', { length: 512 }).notNull(),
    requirement: mysqlEnum('requirement', CLOSURE_PACKAGE_REQUIREMENT_VALUES).notNull(),
    status: mysqlEnum('status', CLOSURE_PACKAGE_ITEM_STATUS_VALUES).notNull(),
    notes: text('notes'),
    recordedBy: mysqlEnum('recordedBy', CLOSURE_PACKAGE_RECORDED_BY_VALUES).notNull(),
    createdAt: timestamp('createdAt').notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp('updatedAt')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`)
      .onUpdateNow(),
  },
  (table) => ({
    idxClosurePackageMatter: index('idx_closure_package_matter').on(table.matterId),
    idxClosurePackageUserMatter: index('idx_closure_package_user_matter').on(table.userId, table.matterId),
  }),
);

export type ClosurePackageItem = typeof closurePackageItem.$inferSelect;
export type NewClosurePackageItem = typeof closurePackageItem.$inferInsert;

// ============================================================
// FOLD-SEND-1 — export-safety / outbound-readiness data core (Increment 1)
// ============================================================
// Deterministic block/warn/pass gate data core (triad-reviewed; docs/reviews/FOLD-SEND-1_disposition.md).
// Inc 1 = tables + idempotent firm-default seeds only; NO behavior change; SENDABILITY_GATE_ENABLED
// default OFF. Enum values mirror src/shared/schemas/sendability.ts (Zod Wall). Legacy `sendability_*`
// code name kept; user-facing copy says "export safety / outbound readiness".
// ============================================================
export const SENDABILITY_CHECK_CATEGORY_VALUES = [
  'wrong_matter_id', 'stale_baseline', 'missing_required_signer', 'open_execution_item',
  'unverified_statute_citation', 'tone', 'package_completeness', 'low_confidence_match', 'audience_leak',
] as const;
export const SENDABILITY_RULE_LEVEL_VALUES = ['block', 'warn', 'off'] as const;
export const SENDABILITY_VERDICT_VALUES = ['block', 'warn', 'pass'] as const;
export const SENDABILITY_DEGRADATION_VALUES = ['none', 'partial', 'error'] as const;
export const SENDABILITY_OVERRIDE_REASON_VALUES = [
  'verified_correct', 'intentional_choice', 'will_correct_before_send', 'not_applicable', 'other',
] as const;
export const JURISDICTION_REQUIREMENT_VALUES = [
  'notary', 'two_witnesses', 'self_proving_affidavit', 'signer_capacity_recital',
] as const;

// sendability_rule — which checks are enabled + at what level; owner-null = firm default (no UI v1).
export const sendabilityRule = mysqlTable(
  'sendability_rule',
  {
    id: char('id', { length: 36 }).primaryKey(),
    userId: char('userId', { length: 36 }), // NULL = firm default
    category: mysqlEnum('category', SENDABILITY_CHECK_CATEGORY_VALUES).notNull(),
    documentType: varchar('documentType', { length: 128 }), // NULL = all types
    level: mysqlEnum('level', SENDABILITY_RULE_LEVEL_VALUES).notNull(),
    notes: text('notes'),
    createdAt: timestamp('createdAt').notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp('updatedAt').notNull().default(sql`CURRENT_TIMESTAMP`).onUpdateNow(),
  },
  (table) => ({
    idxSendabilityRuleCategory: index('idx_sendability_rule_category').on(table.category),
  }),
);

// jurisdiction_rule — document-type-scoped, source-tagged execution formalities (scope-guarded).
export const jurisdictionRule = mysqlTable(
  'jurisdiction_rule',
  {
    id: char('id', { length: 36 }).primaryKey(),
    userId: char('userId', { length: 36 }), // NULL = firm default
    jurisdiction: varchar('jurisdiction', { length: 16 }).notNull(),
    documentType: varchar('documentType', { length: 128 }).notNull(),
    requirement: mysqlEnum('requirement', JURISDICTION_REQUIREMENT_VALUES).notNull(),
    sourceTag: varchar('sourceTag', { length: 256 }).notNull(),
    notes: text('notes'),
    createdAt: timestamp('createdAt').notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp('updatedAt').notNull().default(sql`CURRENT_TIMESTAMP`).onUpdateNow(),
  },
  (table) => ({
    idxJurisdictionRuleType: index('idx_jurisdiction_rule_type').on(table.jurisdiction, table.documentType),
  }),
);

// sendability_override — APPEND-ONLY; content-hash-bound; supersedes on version change.
export const sendabilityOverride = mysqlTable(
  'sendability_override',
  {
    id: char('id', { length: 36 }).primaryKey(),
    userId: char('userId', { length: 36 }).notNull(),
    matterId: char('matterId', { length: 36 }).notNull(),
    documentId: char('documentId', { length: 36 }).notNull(),
    versionId: char('versionId', { length: 36 }).notNull(),
    contentHash: varchar('contentHash', { length: 128 }).notNull(),
    category: mysqlEnum('category', SENDABILITY_CHECK_CATEGORY_VALUES).notNull(),
    blockPayload: json('blockPayload'),
    reasonCode: mysqlEnum('reasonCode', SENDABILITY_OVERRIDE_REASON_VALUES).notNull(),
    reasonText: text('reasonText'),
    createdAt: timestamp('createdAt').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    idxSendabilityOverrideVersion: index('idx_sendability_override_version').on(table.versionId),
    idxSendabilityOverrideUserMatter: index('idx_sendability_override_user_matter').on(table.userId, table.matterId),
  }),
);

// sendability_evaluation — APPEND-ONLY log of every evaluation (incl. shadow mode).
export const sendabilityEvaluation = mysqlTable(
  'sendability_evaluation',
  {
    id: char('id', { length: 36 }).primaryKey(),
    userId: char('userId', { length: 36 }).notNull(),
    matterId: char('matterId', { length: 36 }).notNull(),
    documentId: char('documentId', { length: 36 }).notNull(),
    versionId: char('versionId', { length: 36 }).notNull(),
    verdict: mysqlEnum('verdict', SENDABILITY_VERDICT_VALUES).notNull(),
    blocks: json('blocks').notNull(),
    warnings: json('warnings').notNull(),
    llmComponentUsed: boolean('llmComponentUsed').notNull().default(false),
    degraded: mysqlEnum('degraded', SENDABILITY_DEGRADATION_VALUES).notNull().default('none'),
    durationMs: int('durationMs').notNull().default(0),
    enforced: boolean('enforced').notNull().default(false),
    createdAt: timestamp('createdAt').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    idxSendabilityEvalVersion: index('idx_sendability_eval_version').on(table.versionId),
    idxSendabilityEvalUserMatter: index('idx_sendability_eval_user_matter').on(table.userId, table.matterId),
  }),
);

export type SendabilityRule = typeof sendabilityRule.$inferSelect;
export type JurisdictionRule = typeof jurisdictionRule.$inferSelect;
export type SendabilityOverride = typeof sendabilityOverride.$inferSelect;
export type SendabilityEvaluation = typeof sendabilityEvaluation.$inferSelect;

// ============================================================
// FOLD-L1-4 — reusable_artifacts (MM-8a registry + MM-8b cross-matter gate)
// ============================================================
// Reusable artifacts (templates / clauses / memos / snippets) that may be invoked
// across matters — UNDER a contamination gate. ANTI-CONTAMINATION is the whole point:
//   - originMatterId records where the artifact came from (nullable = firm-level, not
//     derived from a specific client matter).
//   - reusableScope defaults to 'matter_only' (an artifact derived from matter A may NOT
//     be invoked in matter B unless the attorney EXPLICITLY widens it to 'cross_matter').
//   - Even when 'cross_matter', each cross-matter invocation requires an explicit per-use
//     opt-in (enforced by the gate service, not the schema) and is fail-visibly audited.
// The scope is an explicit attorney act with a conservative default — never inferred.
//
// Indexes:
//   idx_reusable_artifacts_user (userId)
//   idx_reusable_artifacts_origin (userId, originMatterId)
//   idx_reusable_artifacts_kind (userId, kind)
// ============================================================
export const REUSABLE_ARTIFACT_KIND_VALUES = ['template', 'clause', 'memo', 'snippet'] as const;
export type ReusableArtifactKind = (typeof REUSABLE_ARTIFACT_KIND_VALUES)[number];

export const REUSABLE_ARTIFACT_SCOPE_VALUES = ['matter_only', 'cross_matter'] as const;
export type ReusableArtifactScope = (typeof REUSABLE_ARTIFACT_SCOPE_VALUES)[number];

export const reusableArtifacts = mysqlTable(
  'reusable_artifacts',
  {
    id: char('id', { length: 36 }).primaryKey(),
    userId: char('userId', { length: 36 }).notNull(),
    // Provenance: the matter this artifact was derived from. NULL = firm-level/not
    // client-derived (no cross-matter contamination risk by origin).
    originMatterId: char('originMatterId', { length: 36 }),
    // Optional link to the source document the artifact was extracted from.
    sourceDocumentId: char('sourceDocumentId', { length: 36 }),
    kind: mysqlEnum('kind', REUSABLE_ARTIFACT_KIND_VALUES).notNull(),
    title: varchar('title', { length: 256 }).notNull(),
    body: mediumtext('body').notNull(),
    // ANTI-CONTAMINATION default: matter_only. Widening to cross_matter is an explicit
    // attorney act; the gate still requires per-use opt-in on top of this.
    reusableScope: mysqlEnum('reusableScope', REUSABLE_ARTIFACT_SCOPE_VALUES)
      .notNull()
      .default('matter_only'),
    createdAt: timestamp('createdAt').notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp('updatedAt')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`)
      .onUpdateNow(),
  },
  (table) => ({
    idxReusableArtifactsUser: index('idx_reusable_artifacts_user').on(table.userId),
    idxReusableArtifactsOrigin: index('idx_reusable_artifacts_origin').on(
      table.userId,
      table.originMatterId,
    ),
    idxReusableArtifactsKind: index('idx_reusable_artifacts_kind').on(table.userId, table.kind),
  }),
);

export type ReusableArtifact = typeof reusableArtifacts.$inferSelect;
export type NewReusableArtifact = typeof reusableArtifacts.$inferInsert;

// ============================================================
// FOLD-L0-1 — Layer-0 Matter Intake & Analysis (Phase 3)
// ============================================================
// Analysis-first intake: matter_parties (Fork B, thin/interim) feed the deterministic
// conflicts-at-intake check (conflict_checks + conflict_hits, Fork A); matter_analysis
// (Fork C) is the internal assessment-and-plan that closes on a locked plan (Fork F:
// categorically NON-SENDABLE by type). All owner-scoped, additive. Conflicts matching is
// deterministic DB-side — NO LLM in the check (Fork G).
// ============================================================

// --- matter_parties (Fork B — thin/interim; full cross-matter identity is FOLD-PM-3) ---
export const MATTER_PARTY_ROLE_VALUES = ['client', 'adverse', 'related', 'other'] as const;
export type MatterPartyRole = (typeof MATTER_PARTY_ROLE_VALUES)[number];

export const MATTER_PARTY_TYPE_VALUES = ['person', 'entity', 'unknown'] as const;
export type MatterPartyType = (typeof MATTER_PARTY_TYPE_VALUES)[number];

export const matterParties = mysqlTable(
  'matter_parties',
  {
    id: char('id', { length: 36 }).primaryKey(),
    userId: char('userId', { length: 36 }).notNull(),
    matterId: char('matterId', { length: 36 }).notNull(),
    role: mysqlEnum('role', MATTER_PARTY_ROLE_VALUES).notNull(),
    displayName: varchar('displayName', { length: 256 }).notNull(),
    // normalizedName: lower/trim/collapse-ws/strip-punct — the conflicts match key.
    normalizedName: varchar('normalizedName', { length: 256 }).notNull(),
    partyType: mysqlEnum('partyType', MATTER_PARTY_TYPE_VALUES).notNull().default('unknown'),
    // source: where the party came from. 'attorney'/'intake'/'imported' (manual);
    // 'auto_from_clientName' (R2-PRE-CONFLICT-1 Inc 2 auto-create); 'migration' (Inc 5 retroactive).
    source: varchar('source', { length: 64 }).notNull().default('attorney'),
    // R2-PRE-CONFLICT-1 §3F: explicit-attorney-confirmation lifecycle. Existing rows default TRUE
    // (attorney-added). Auto-created/migration parties are confirmed=FALSE: screened immediately
    // but NOT clearance-satisfying until the attorney confirms identity (an explicit, logged act).
    confirmed: boolean('confirmed').notNull().default(true),
    confirmedAt: timestamp('confirmedAt'),
    confirmedByUserId: char('confirmedByUserId', { length: 36 }),
    // Forward-safe (nullable) hooks for FOLD-PM-3 cross-matter identity — unused in L0-1.
    aliasOfPartyId: char('aliasOfPartyId', { length: 36 }),
    externalIdentityKey: varchar('externalIdentityKey', { length: 128 }),
    createdAt: timestamp('createdAt').notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp('updatedAt')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`)
      .onUpdateNow(),
  },
  (table) => ({
    idxMatterPartiesMatter: index('idx_matter_parties_matter').on(table.userId, table.matterId),
    // The cross-matter conflicts read path: match by owner + normalized name across matters.
    idxMatterPartiesNorm: index('idx_matter_parties_norm').on(table.userId, table.normalizedName),
  }),
);
export type MatterParty = typeof matterParties.$inferSelect;
export type NewMatterParty = typeof matterParties.$inferInsert;

// --- conflict_checks (Fork A) ---
export const CONFLICT_CHECK_STATUS_VALUES = ['clear', 'hits_pending', 'dispositioned'] as const;
export type ConflictCheckStatus = (typeof CONFLICT_CHECK_STATUS_VALUES)[number];

export const conflictChecks = mysqlTable(
  'conflict_checks',
  {
    id: char('id', { length: 36 }).primaryKey(),
    userId: char('userId', { length: 36 }).notNull(),
    matterId: char('matterId', { length: 36 }).notNull(),
    status: mysqlEnum('status', CONFLICT_CHECK_STATUS_VALUES).notNull().default('clear'),
    runAt: timestamp('runAt').notNull().default(sql`CURRENT_TIMESTAMP`),
    // R2-PRE-CONFLICT-1 §3D: snapshot of the party-id set this check evaluated (JSON array). A
    // party mutation after a terminal check invalidates the clear (re-check required). Set in Inc 4.
    checkedPartyIds: json('checkedPartyIds'),
    createdAt: timestamp('createdAt').notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp('updatedAt')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`)
      .onUpdateNow(),
  },
  (table) => ({
    idxConflictChecksMatter: index('idx_conflict_checks_matter').on(table.userId, table.matterId),
  }),
);
export type ConflictCheck = typeof conflictChecks.$inferSelect;
export type NewConflictCheck = typeof conflictChecks.$inferInsert;

// --- conflict_hits (Fork A) ---
// severity: BLOCKER = client-here/adverse-there crossing (or same entity opposing posture,
//   plausible prior rep in a substantially related matter); REVIEW = weak/partial match,
//   related/other role, same client with no adverse role. matchBasis records WHY a hit
//   appeared (shown to the attorney). disposition: an UNDISPOSITIONED blocker hard-blocks
//   plan-lock + advance-to-drafting; clearing a blocker REQUIRES a rationale (RPC record).
export const CONFLICT_HIT_SEVERITY_VALUES = ['blocker', 'review'] as const;
export type ConflictHitSeverity = (typeof CONFLICT_HIT_SEVERITY_VALUES)[number];

export const CONFLICT_HIT_DISPOSITION_VALUES = ['pending', 'cleared', 'screened', 'declined'] as const;
export type ConflictHitDisposition = (typeof CONFLICT_HIT_DISPOSITION_VALUES)[number];

export const conflictHits = mysqlTable(
  'conflict_hits',
  {
    id: char('id', { length: 36 }).primaryKey(),
    userId: char('userId', { length: 36 }).notNull(),
    checkId: char('checkId', { length: 36 }).notNull(),
    // this matter + the matched (other) matter, with the parties that crossed.
    matterId: char('matterId', { length: 36 }).notNull(),
    matchedMatterId: char('matchedMatterId', { length: 36 }).notNull(),
    thisPartyId: char('thisPartyId', { length: 36 }),
    matchedPartyId: char('matchedPartyId', { length: 36 }),
    // human-readable WHY, e.g. "client here ('Acme') is adverse in matter <id>".
    matchBasis: varchar('matchBasis', { length: 512 }).notNull(),
    matchType: varchar('matchType', { length: 64 }).notNull(),
    severity: mysqlEnum('severity', CONFLICT_HIT_SEVERITY_VALUES).notNull(),
    disposition: mysqlEnum('disposition', CONFLICT_HIT_DISPOSITION_VALUES).notNull().default('pending'),
    dispositionRationale: text('dispositionRationale'),
    dispositionedByEventId: char('dispositionedByEventId', { length: 36 }),
    createdAt: timestamp('createdAt').notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp('updatedAt')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`)
      .onUpdateNow(),
  },
  (table) => ({
    idxConflictHitsCheck: index('idx_conflict_hits_check').on(table.checkId),
    idxConflictHitsMatter: index('idx_conflict_hits_matter').on(table.userId, table.matterId, table.disposition),
  }),
);
export type ConflictHit = typeof conflictHits.$inferSelect;
export type NewConflictHit = typeof conflictHits.$inferInsert;

// --- matter_analysis (Fork C — internal work-product; Fork F — categorically non-sendable) ---
export const MATTER_ANALYSIS_RECORD_STATUS_VALUES = ['draft', 'locked', 'superseded'] as const;
export type MatterAnalysisRecordStatus = (typeof MATTER_ANALYSIS_RECORD_STATUS_VALUES)[number];

export const MATTER_ANALYSIS_MODEL_LANE_VALUES = ['single', 'multi'] as const;
export type MatterAnalysisModelLane = (typeof MATTER_ANALYSIS_MODEL_LANE_VALUES)[number];

export const matterAnalysis = mysqlTable(
  'matter_analysis',
  {
    id: char('id', { length: 36 }).primaryKey(),
    userId: char('userId', { length: 36 }).notNull(),
    matterId: char('matterId', { length: 36 }).notNull(),
    status: mysqlEnum('status', MATTER_ANALYSIS_RECORD_STATUS_VALUES).notNull().default('draft'),
    // Internal work-product (JSON; Zod-validated on read).
    assessment: json('assessment'),
    plan: json('plan'),
    openQuestions: json('openQuestions'),
    // STRUCTURED planned-deliverables (not just prose) — feeds the later plan->drafting bridge.
    recommendedDocuments: json('recommendedDocuments'),
    // Conflicts linkage (Fork A/C): the check this plan was cleared against + the flag.
    conflictCheckId: char('conflictCheckId', { length: 36 }),
    conflictsClearedForPlanning: boolean('conflictsClearedForPlanning').notNull().default(false),
    // Model lane (Fork E): single (Claude default) | multi (attorney-invoked, suggest-only).
    modelLane: mysqlEnum('modelLane', MATTER_ANALYSIS_MODEL_LANE_VALUES).notNull().default('single'),
    generatedByJobId: char('generatedByJobId', { length: 36 }),
    // Plan lock = explicit attorney act (audit_events disposition); never inferred.
    lockedByEventId: char('lockedByEventId', { length: 36 }),
    lockedAt: timestamp('lockedAt'),
    lockRationale: text('lockRationale'),
    supersededById: char('supersededById', { length: 36 }),
    // Fork F — categorically NON-SENDABLE by TYPE (the type is the enforcement, not a
    // missing button). FOLD-SEND-1 must read these and return "N/A — not a sendable type".
    artifactKind: varchar('artifactKind', { length: 32 }).notNull().default('matter_analysis'),
    outboundEligible: boolean('outboundEligible').notNull().default(false),
    sendabilityRequired: boolean('sendabilityRequired').notNull().default(false),
    sendabilityStatus: varchar('sendabilityStatus', { length: 32 }).notNull().default('not_applicable'),
    createdAt: timestamp('createdAt').notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp('updatedAt')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`)
      .onUpdateNow(),
  },
  (table) => ({
    idxMatterAnalysisMatter: index('idx_matter_analysis_matter').on(table.userId, table.matterId, table.status),
  }),
);
export type MatterAnalysis = typeof matterAnalysis.$inferSelect;
export type NewMatterAnalysis = typeof matterAnalysis.$inferInsert;

// ============================================================
// FOLD-KB-1 — Practice Knowledge Base (Phase 3) — Increment 1 data core
// ============================================================
// Two owner-private stores. Additive. The per-PA master-prompt layer auto-loads (it is
// the attorney's own instruction); practice memos NEVER auto-inject (surface-not-inject).

export const paInstructionProfiles = mysqlTable(
  'pa_instruction_profiles',
  {
    id: char('id', { length: 36 }).primaryKey(),
    userId: char('userId', { length: 36 }).notNull(),
    // Owner-defined practice-area key the matter's freeform practiceArea maps to (by
    // EXPLICIT attorney confirmation — never silent string-guessing).
    paKey: varchar('paKey', { length: 64 }).notNull(),
    title: varchar('title', { length: 256 }).notNull(),
    // The tuned master prompt (the attorney's own instruction layer).
    body: mediumtext('body').notNull(),
    version: varchar('version', { length: 32 }).notNull(),
    // At most one active profile per (userId, paKey); activation is an explicit attorney act.
    active: boolean('active').notNull().default(false),
    supersededById: char('supersededById', { length: 36 }),
    createdAt: timestamp('createdAt').notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp('updatedAt').notNull().default(sql`CURRENT_TIMESTAMP`).onUpdateNow(),
  },
  (table) => ({
    idxPaInstructionProfilesUser: index('idx_pa_instruction_profiles_user').on(table.userId),
    idxPaInstructionProfilesPakey: index('idx_pa_instruction_profiles_pakey').on(table.userId, table.paKey),
    idxPaInstructionProfilesActive: index('idx_pa_instruction_profiles_active').on(table.userId, table.paKey, table.active),
  }),
);
export type PaInstructionProfile = typeof paInstructionProfiles.$inferSelect;
export type NewPaInstructionProfile = typeof paInstructionProfiles.$inferInsert;

// practice_memos enum domains (stored as varchar; validated at the Zod Wall).
export const MEMO_VERIFICATION_STATUS_VALUES = [
  'unverified',
  'attorney_verified_current',
  'stale',
  'superseded',
  'not_legal_authority',
] as const;
export type MemoVerificationStatus = (typeof MEMO_VERIFICATION_STATUS_VALUES)[number];

export const MEMO_PRIVILEGE_TAG_VALUES = ['client_confidential', 'abstracted', 'public'] as const;
export type MemoPrivilegeTag = (typeof MEMO_PRIVILEGE_TAG_VALUES)[number];

export const MEMO_ABSTRACTION_STATUS_VALUES = ['raw', 'abstracted'] as const;
export type MemoAbstractionStatus = (typeof MEMO_ABSTRACTION_STATUS_VALUES)[number];

export const MEMO_ABSTRACTED_BY_VALUES = ['attorney', 'system_assisted_attorney'] as const;
export type MemoAbstractedBy = (typeof MEMO_ABSTRACTED_BY_VALUES)[number];

export const MEMO_REUSE_SCOPE_VALUES = ['matter_only', 'firm_wide'] as const;
export type MemoReuseScope = (typeof MEMO_REUSE_SCOPE_VALUES)[number];

export const practiceMemos = mysqlTable(
  'practice_memos',
  {
    id: char('id', { length: 36 }).primaryKey(),
    userId: char('userId', { length: 36 }).notNull(),
    // NULL = firm-level (not client-derived).
    originMatterId: char('originMatterId', { length: 36 }),
    sourceAnalysisId: char('sourceAnalysisId', { length: 36 }),
    sourceDocumentId: char('sourceDocumentId', { length: 36 }),
    title: varchar('title', { length: 256 }).notNull(),
    body: mediumtext('body').notNull(),
    practiceArea: varchar('practiceArea', { length: 128 }),
    jurisdiction: varchar('jurisdiction', { length: 128 }),
    // Structured authorities relied on (JSON; Zod-validated on read).
    lawReliedOn: json('lawReliedOn'),
    topicTags: json('topicTags'),
    writtenOn: timestamp('writtenOn'),
    // Currency (Fork C): discrete status, separate from lastVerifiedAt; never age-derived.
    verificationStatus: varchar('verificationStatus', { length: 32 }).notNull().default('unverified'),
    lastVerifiedAt: timestamp('lastVerifiedAt'),
    verifiedThroughDate: timestamp('verifiedThroughDate'),
    verificationMethod: varchar('verificationMethod', { length: 64 }),
    verificationNote: text('verificationNote'),
    // Privilege / abstraction (Fork B/G): most-private defaults.
    privilegeTag: varchar('privilegeTag', { length: 32 }).notNull().default('client_confidential'),
    abstractionStatus: varchar('abstractionStatus', { length: 16 }).notNull().default('raw'),
    abstractionAttestedByEventId: char('abstractionAttestedByEventId', { length: 36 }),
    abstractedAt: timestamp('abstractedAt'),
    abstractedBy: varchar('abstractedBy', { length: 32 }),
    reuseScope: varchar('reuseScope', { length: 16 }).notNull().default('matter_only'),
    // Owner-only link from an abstracted memo back to its raw origin; never exposed cross-matter.
    abstractedFromMemoId: char('abstractedFromMemoId', { length: 36 }),
    supersededById: char('supersededById', { length: 36 }),
    createdAt: timestamp('createdAt').notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp('updatedAt').notNull().default(sql`CURRENT_TIMESTAMP`).onUpdateNow(),
  },
  (table) => ({
    idxPracticeMemosUser: index('idx_practice_memos_user').on(table.userId),
    idxPracticeMemosOrigin: index('idx_practice_memos_origin').on(table.userId, table.originMatterId),
    idxPracticeMemosPa: index('idx_practice_memos_pa').on(table.userId, table.practiceArea),
    idxPracticeMemosReuse: index('idx_practice_memos_reuse').on(table.userId, table.reuseScope, table.abstractionStatus),
    idxPracticeMemosVerification: index('idx_practice_memos_verification').on(table.userId, table.verificationStatus),
  }),
);
export type PracticeMemo = typeof practiceMemos.$inferSelect;
export type NewPracticeMemo = typeof practiceMemos.$inferInsert;

// kb_adoptions — FOLD-KB-1 Increment 2 (Fork A). Durable, matter-scoped provenance of a
// memo pulled into a matter / work product. Snapshots the memo's currency posture at adoption.
export const kbAdoptions = mysqlTable(
  'kb_adoptions',
  {
    id: char('id', { length: 36 }).primaryKey(),
    userId: char('userId', { length: 36 }).notNull(),
    matterId: char('matterId', { length: 36 }).notNull(),
    documentId: char('documentId', { length: 36 }),
    kbMemoId: char('kbMemoId', { length: 36 }).notNull(),
    // Version proxy: practice_memos.updatedAt at adoption (memos version via updatedAt).
    kbMemoUpdatedAtAtAdoption: timestamp('kbMemoUpdatedAtAtAdoption'),
    verificationStatusAtAdoption: varchar('verificationStatusAtAdoption', { length: 32 }).notNull(),
    lastVerifiedAtAtAdoption: timestamp('lastVerifiedAtAtAdoption'),
    kbDerived: boolean('kbDerived').notNull().default(true),
    currencyVerifiedForOutbound: boolean('currencyVerifiedForOutbound').notNull().default(false),
    adoptedByEventId: char('adoptedByEventId', { length: 36 }),
    createdAt: timestamp('createdAt').notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp('updatedAt').notNull().default(sql`CURRENT_TIMESTAMP`).onUpdateNow(),
  },
  (table) => ({
    idxKbAdoptionsUser: index('idx_kb_adoptions_user').on(table.userId),
    idxKbAdoptionsMatter: index('idx_kb_adoptions_matter').on(table.userId, table.matterId),
    idxKbAdoptionsDocument: index('idx_kb_adoptions_document').on(table.userId, table.documentId),
    idxKbAdoptionsMemo: index('idx_kb_adoptions_memo').on(table.userId, table.kbMemoId),
  }),
);
export type KbAdoption = typeof kbAdoptions.$inferSelect;
export type NewKbAdoption = typeof kbAdoptions.$inferInsert;

// kb_events — FOLD-KB-1 Increment 3. Owner-scoped, APPEND-ONLY audit trail for FIRM-LEVEL
// (matter-less) KB attorney acts. audit_events stays the per-matter record; this is the KB
// record. Insert + read only.
export const kbEvents = mysqlTable(
  'kb_events',
  {
    id: char('id', { length: 36 }).primaryKey(),
    userId: char('userId', { length: 36 }).notNull(),
    action: varchar('action', { length: 48 }).notNull(),
    targetType: varchar('targetType', { length: 32 }).notNull(),
    targetId: char('targetId', { length: 36 }).notNull(),
    summary: varchar('summary', { length: 512 }).notNull(),
    rationale: text('rationale'),
    payload: json('payload'),
    createdAt: timestamp('createdAt').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    idxKbEventsUser: index('idx_kb_events_user').on(table.userId),
    idxKbEventsTarget: index('idx_kb_events_target').on(table.userId, table.targetType, table.targetId),
    idxKbEventsAction: index('idx_kb_events_action').on(table.userId, table.action),
  }),
);
export type KbEvent = typeof kbEvents.$inferSelect;
export type NewKbEvent = typeof kbEvents.$inferInsert;

// ============================================================
// FOLD-PM-1 — deadline / tickler engine data core (Increment 1)
// ============================================================
// Phase-4 head. The first feature that computes legally consequential dates. Design triad-reviewed +
// operator-APPROVED (FOLD-PM-1_consolidated_disposition_2026-06-07.md). Inc 1 = tables + schemas +
// idempotent seeds; NO behavior; flag DEADLINE_ENGINE_ENABLED default OFF; NO egress/autonomous action
// exists anywhere by design. Enum values mirror src/shared/schemas/deadline.ts (Zod Wall). Additive
// only; nullable owner key (NULL = firm default); ownerScope() at the query layer; camelCase FKs.
//
// G-A: constraints are a first-class unresolved-input concept (the engine never emits a confidently
//   wrong compound date). The runtime computeDeadline() contract freezes at the G-A review (pre Inc 2);
//   here we store only the rule-declared constraintsSpec + the per-instance resolved snapshot.
// G-B: 1031 rules are SEEDED with enabled=false; activation is hard-blocked on attorney-approved
//   1031-0 fixtures. Disabled state is unmistakable in the data (deadline_rule.enabled = 0).
// G-C: pending_confirm + expired_unresolved are first-class statuses (no silent states).
// ============================================================
export const DEADLINE_FAMILY_VALUES = [
  'exchange_1031', 'contract_contingency', 'closing_recording', 'trust_funding', 'corporate_filing',
] as const;
export const DAY_CONVENTION_VALUES = ['calendar_no_roll', 'calendar_roll_forward', 'business_days'] as const;
export const ROLL_RULE_VALUES = ['none', 'next_business_day', 'previous_business_day'] as const;
export const DEADLINE_STATUS_VALUES = [
  'pending_confirm', 'active', 'satisfied', 'waived', 'expired_unresolved',
] as const;
export const ANCHOR_SOURCE_VALUES = ['attorney_entered', 'document_linked'] as const;

// deadline_rule — a rule's identity + enable switch + pointer to its current immutable revision.
export const deadlineRule = mysqlTable(
  'deadline_rule',
  {
    id: char('id', { length: 36 }).primaryKey(),
    userId: char('userId', { length: 36 }), // NULL = firm default
    family: mysqlEnum('family', DEADLINE_FAMILY_VALUES).notNull(),
    ruleKey: varchar('ruleKey', { length: 128 }).notNull(), // stable id for idempotent seeding + lookup
    label: varchar('label', { length: 256 }).notNull(),
    enabled: boolean('enabled').notNull().default(false), // 1031 seeds land disabled (G-B)
    currentRevisionId: char('currentRevisionId', { length: 36 }), // operative revision pointer
    createdAt: timestamp('createdAt').notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp('updatedAt').notNull().default(sql`CURRENT_TIMESTAMP`).onUpdateNow(),
  },
  (table) => ({
    idxDeadlineRuleFamily: index('idx_deadline_rule_family').on(table.family),
    uqDeadlineRuleKey: uniqueIndex('uq_deadline_rule_key').on(table.ruleKey),
  }),
);

// deadline_rule_revision — IMMUTABLE legal-content snapshot. A rule edit writes a NEW revision; a
// matter_deadline that snapshotted an older revision keeps its historical basis (never silently mutates).
export const deadlineRuleRevision = mysqlTable(
  'deadline_rule_revision',
  {
    id: char('id', { length: 36 }).primaryKey(),
    ruleId: char('ruleId', { length: 36 }).notNull(),
    jurisdiction: varchar('jurisdiction', { length: 16 }), // NULL = federal/any
    anchorType: varchar('anchorType', { length: 64 }).notNull(),
    offsetDays: int('offsetDays'), // NULL = recurrence/fixed-date driven (no simple offset)
    dayConvention: mysqlEnum('dayConvention', DAY_CONVENTION_VALUES).notNull(),
    rollRule: mysqlEnum('rollRule', ROLL_RULE_VALUES).notNull(),
    recurrence: json('recurrence'), // null | {type:'annual_fixed',month,day} | {type:'annual_anniversary_month_end'}
    leadTimeDefaults: json('leadTimeDefaults').notNull(), // number[] of lead days (T-N)
    constraintsSpec: json('constraintsSpec'), // null | DeadlineConstraintSpec[] (rule-declared compound caps)
    sourceTag: varchar('sourceTag', { length: 256 }).notNull(), // attorney-verified legal authority
    notes: text('notes'),
    createdAt: timestamp('createdAt').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    idxDeadlineRevRule: index('idx_deadline_rev_rule').on(table.ruleId),
  }),
);

// matter_deadline — per-matter instance (computed from a rule revision, or manual). anchorDate is
// visibly attorney-asserted. status lifecycle per G-C (pending_confirm fires ticklers; expired_unresolved
// is permanent until a reasoned satisfy/waive).
export const matterDeadline = mysqlTable(
  'matter_deadline',
  {
    id: char('id', { length: 36 }).primaryKey(),
    userId: char('userId', { length: 36 }).notNull(),
    matterId: char('matterId', { length: 36 }).notNull(),
    ruleRevisionId: char('ruleRevisionId', { length: 36 }), // NULL = manual/ad-hoc (first-class)
    family: mysqlEnum('family', DEADLINE_FAMILY_VALUES).notNull(),
    description: varchar('description', { length: 512 }).notNull(),
    anchorType: varchar('anchorType', { length: 64 }).notNull(),
    anchorDate: date('anchorDate', { mode: 'string' }).notNull(), // date-only, America/New_York
    anchorSource: mysqlEnum('anchorSource', ANCHOR_SOURCE_VALUES).notNull(),
    anchorBasis: text('anchorBasis'),
    anchorDocumentId: char('anchorDocumentId', { length: 36 }), // deadline<->source-document linkage
    computedDueDate: date('computedDueDate', { mode: 'string' }),
    constraints: json('constraints').notNull(), // resolved DeadlineConstraint[] snapshot (may be [])
    attorneyOverrideDate: date('attorneyOverrideDate', { mode: 'string' }),
    overrideReason: text('overrideReason'), // required when override set (app layer)
    status: mysqlEnum('status', DEADLINE_STATUS_VALUES).notNull().default('pending_confirm'),
    confirmedByUserId: char('confirmedByUserId', { length: 36 }),
    confirmedAt: timestamp('confirmedAt'),
    ruleSnapshot: json('ruleSnapshot'), // operative rule fields snapshotted at confirmation
    dispositionBasis: text('dispositionBasis'), // basis on satisfy/waive (satisfy records a basis too)
    createdAt: timestamp('createdAt').notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp('updatedAt').notNull().default(sql`CURRENT_TIMESTAMP`).onUpdateNow(),
  },
  (table) => ({
    idxMatterDeadlineMatter: index('idx_matter_deadline_matter').on(table.userId, table.matterId),
    idxMatterDeadlineStatus: index('idx_matter_deadline_status').on(table.userId, table.status),
  }),
);

// tickler — per-deadline lead-time reminder rows, materialized over a rolling 12-month horizon and
// refreshed deterministically on-load. ack/snooze keyed to the LOGICAL lead-time (leadDays) so the
// state survives regeneration on recompute.
export const tickler = mysqlTable(
  'tickler',
  {
    id: char('id', { length: 36 }).primaryKey(),
    userId: char('userId', { length: 36 }).notNull(),
    matterDeadlineId: char('matterDeadlineId', { length: 36 }).notNull(),
    leadDays: int('leadDays').notNull(), // logical lead-time; ack/snooze keys to this
    fireAt: date('fireAt', { mode: 'string' }).notNull(),
    acknowledgedByUserId: char('acknowledgedByUserId', { length: 36 }),
    acknowledgedAt: timestamp('acknowledgedAt'),
    snoozedUntil: date('snoozedUntil', { mode: 'string' }),
    snoozeReason: text('snoozeReason'),
    createdAt: timestamp('createdAt').notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp('updatedAt').notNull().default(sql`CURRENT_TIMESTAMP`).onUpdateNow(),
  },
  (table) => ({
    idxTicklerDeadline: index('idx_tickler_deadline').on(table.matterDeadlineId),
    idxTicklerUserFire: index('idx_tickler_user_fire').on(table.userId, table.fireAt),
  }),
);

// holiday_calendar — jurisdiction + date + label; business-day math unions US (federal) + the matter's
// state. A coverage guard (computation core) returns a CONSTRAINT past the seeded range, never assumes.
export const holidayCalendar = mysqlTable(
  'holiday_calendar',
  {
    id: char('id', { length: 36 }).primaryKey(),
    jurisdiction: varchar('jurisdiction', { length: 16 }).notNull(), // 'US' | 'VA' | 'MD'
    date: date('date', { mode: 'string' }).notNull(),
    label: varchar('label', { length: 256 }).notNull(),
    createdAt: timestamp('createdAt').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    uqHolidayJurisdictionDate: uniqueIndex('uq_holiday_jurisdiction_date').on(table.jurisdiction, table.date),
  }),
);

export type DeadlineRule = typeof deadlineRule.$inferSelect;
export type NewDeadlineRule = typeof deadlineRule.$inferInsert;
export type DeadlineRuleRevision = typeof deadlineRuleRevision.$inferSelect;
export type NewDeadlineRuleRevision = typeof deadlineRuleRevision.$inferInsert;
export type MatterDeadline = typeof matterDeadline.$inferSelect;
export type NewMatterDeadline = typeof matterDeadline.$inferInsert;
export type Tickler = typeof tickler.$inferSelect;
export type NewTickler = typeof tickler.$inferInsert;
export type HolidayCalendar = typeof holidayCalendar.$inferSelect;
export type NewHolidayCalendar = typeof holidayCalendar.$inferInsert;
