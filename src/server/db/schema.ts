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
// REVIEWER-ASYNC-DISPLAY-1 (Component C): single source of the reviewer-lane status vocabulary.
import { REVIEWER_LANE_STATUS_VALUES } from '../../shared/schemas/reviewerLaneState.js';
// EGRESS-CONTROL-PLANE-1: surface-agnostic egress ledger + scoped-hold enum vocabularies (Zod Wall sync).
import {
  EGRESS_SURFACE_VALUES,
  EGRESS_SUBJECT_TYPE_VALUES,
  EGRESS_HOLD_SCOPE_VALUES,
  EGRESS_HOLD_FLAG_VALUES,
  EGRESS_DECISION_VALUES,
  EGRESS_STATUS_VALUES,
} from '../../shared/schemas/egress.js';
// CHAT-COPILOT-1 (Inc 1): single source of the chat-copilot enum vocabularies (kept in sync with the Zod Wall).
import {
  CHAT_CONVERSATION_RETENTION_CLASS_VALUES,
  CHAT_MESSAGE_ROLE_VALUES,
  // CHAT-COPILOT-2 Increment A (egress control plane): holdFlag + egress-event vocabularies.
  CHAT_HOLD_FLAG_VALUES,
  CHAT_EGRESS_KIND_VALUES,
  CHAT_EGRESS_DECISION_VALUES,
  CHAT_EGRESS_AUTH_BASIS_VALUES,
  CHAT_EGRESS_STATUS_VALUES,
  // CHAT-COPILOT-2 A2 (ephemeral attachments): party-attribution kind.
  CHAT_ATTACHMENT_ATTRIBUTION_VALUES,
  // CHAT-COPILOT-2 Increment B (multi-model review panel): run/lane/disposition vocabularies.
  CHAT_REVIEW_RUN_STATUS_VALUES,
  CHAT_REVIEW_DISPOSITIONER_STATUS_VALUES,
  CHAT_REVIEW_LANE_STATUS_VALUES,
  CHAT_REVIEW_DISPOSITION_VALUES,
  CHAT_REVIEW_CITATION_STATUS_VALUES,
  CHAT_REVIEW_ATTORNEY_DECISION_VALUES,
} from '../../shared/schemas/chatCopilot.js';
// FOLD-PM-4: single source of the matter-deliverable status vocabulary (kept in sync with the Zod Wall).
import { MATTER_DELIVERABLE_STATUS_VALUES } from '../../shared/schemas/matterDeliverables.js';
// FOLD-PM-2: single source of the document-type vocabulary (kept in sync with the Zod Wall).
import { DOCUMENT_TYPE_VALUES } from '../../shared/schemas/documentExtraction.js';
// KB-PROVENANCE-1: single source of the legal-authority-type vocabulary (kept in sync with the Zod Wall).
import { AUTHORITY_TYPE_VALUES } from '../../shared/schemas/authoritySource.js';
// FOLD-PM-3: single source of the entity-kind + contact-type vocabularies (kept in sync with the Zod Wall).
import {
  MATTER_ENTITY_KIND_VALUES,
  MATTER_ENTITY_CONTACT_TYPE_VALUES,
} from '../../shared/schemas/partyModel.js';
// FOLD-NOTIFY-1: single source of the notification-type vocabulary (kept in sync with the Zod Wall).
import { NOTIFICATION_TYPE_VALUES } from '../../shared/schemas/notifications.js';

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
  // chat_turn — CHAT-DISPATCH-1 single chat turn routed through the canonical LLM chokepoint
  // (behind CHAT_DISPATCH_ENABLED, default OFF). Same varchar(64) column → NO migration.
  'chat_turn',
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
    // idempotencyKey: EGRESS-CONTROL-PLANE-1 Inc 2 durable-outbox key per (session, lane) on reviewer
    // dispatch = `${reviewSessionId}:${reviewerRole}`; NULL for every other job type (the unique index
    // permits multiple NULLs). Dedupes a resume / recovered re-dispatch so confidential content can never
    // double-transmit; the per-reviewer egress dedup is enforced fully in Increment 3.
    idempotencyKey: varchar('idempotencyKey', { length: 128 }),
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
    // REVIEWER-LATENCY-1 Step 0: provider-reported reasoning/thinking tokens, stored AS-REPORTED
    // (no normalization). Per-provider semantics differ — OpenAI reasoning_tokens is a SUBSET of
    // tokensCompletion; Gemini thoughtsTokenCount is SEPARATE from it; xAI best-effort; Anthropic
    // not captured -> NULL. NULL means "not reported for this provider/model", distinct from 0.
    tokensReasoning: int('tokensReasoning'),
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
    // EGRESS-CONTROL-PLANE-1 Inc 2: at most one reviewer job per (session, lane). NULLs (every
    // non-reviewer job) are exempt — MySQL/TiDB unique indexes permit multiple NULL values.
    uniqJobsIdempotencyKey: uniqueIndex('uniq_jobs_idempotency_key').on(table.idempotencyKey),
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

// INSTR-2B-title: the firm CAPACITY this matter is handled in. Kept in sync with the Zod Wall
// copy in src/shared/schemas/matters.ts (MATTER_ENGAGEMENT_CAPACITY_VALUES). Additive, NOT NULL
// DEFAULT 'law_firm' so every existing row is the safe default.
export const MATTER_ENGAGEMENT_CAPACITY_VALUES = ['law_firm', 'title_settlement_agent'] as const;
export type MatterEngagementCapacity = (typeof MATTER_ENGAGEMENT_CAPACITY_VALUES)[number];

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
    // INSTR-2B-title (Fork: capacity election): which capacity the firm acts in for this matter.
    // Additive, NOT NULL DEFAULT 'law_firm' (the safe default) so every existing row stays valid.
    // 'title_settlement_agent' (an affirmative attorney election) is what routes drafting to the
    // Title master; absent/law_firm => the 2B-core safe default. Set only by an explicit attorney
    // act (matter.create / matter.setEngagementCapacity); never inferred.
    engagementCapacity: mysqlEnum('engagementCapacity', MATTER_ENGAGEMENT_CAPACITY_VALUES)
      .notNull()
      .default('law_firm'),
    // CAPACITY-ELECTION-UX (R1): additive, NULLABLE marker recording that an AFFIRMATIVE capacity
    // election was made (NULL = never elected). Distinguishes "attorney elected law_firm" from "the
    // column defaulted to law_firm and nobody chose" — the residual engagementCapacity (NOT NULL
    // DEFAULT 'law_firm') cannot represent alone. Plain nullable timestamp (like archivedAt) so the
    // inferred type is Date | null; NO .$type<Date>() (that would drop the null). Set on intake when an
    // explicit capacity is passed (matter.create) and on every matter.setEngagementCapacity. NO backfill.
    engagementCapacityElectedAt: timestamp('engagementCapacityElectedAt'),
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
    // W3c (ULTRABUILD-1) — deed provenance: 'agent_assembled' (the deterministic deed agent minted it) vs
    // 'llm_authored' (a legacy generic-LLM deed). Durable + artifact-level; SURVIVES versioning (lives on the
    // document, mirrors drewOnUnverifiedKb). NULL = unknown/legacy → treated as NON-sanctioned by the LIVE-9
    // export scanner (fail-closed), closing the residual where a legacy 'deed' was indistinguishable from
    // agent output. Additive, nullable.
    provenance: varchar('provenance', { length: 32 }),
    // DOC-CLIENT-TARGET-1: RESERVED for `derived` document types (cert-of-trust / funding letter
    // inherit their party binding from a source document). Nullable; populated by the derived flow
    // (fast-follow). Present now so the bucket + provenance are complete.
    sourceDocumentId: char('sourceDocumentId', { length: 36 }),
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
// DOC-CLIENT-TARGET-1 — document_party (join table)
// ============================================================
// Binds a document instance to a matter party in a declared ROLE. A document's relationship to a
// matter's parties is a role binding, NOT a scalar: an individual instrument (POA/will/directive)
// binds exactly one `subject`; a joint instrument (trust) binds an explicit settlor set; a role-sided
// instrument (deed) binds grantor + grantee groups. roleKey is a string validated at WRITE against the
// document type's declared roles (src/shared/docTypes/docTypeConfig.ts) — no DB enum, so a new role
// needs no migration. NO role_label_snapshot: the label derives from the type's config; provenance is
// the config-version snapshot at finalize. The disposition's logical key (documentId, partyId, roleKey)
// is the UNIQUE index; the table keeps the repo's `id` PK. A bound party is soft-/block-deleted, never
// hard-deleted out from under a finalized document.
//
// Indexes:
//   uq_document_party_doc_party_role (documentId, partyId, roleKey)  — the logical key
//   idx_document_party_doc   (userId, documentId)  — "this document's bound parties"
//   idx_document_party_party (userId, partyId)     — "documents bound to this party" (block-delete guard)
// ============================================================

export const documentParty = mysqlTable(
  'document_party',
  {
    id: char('id', { length: 36 }).primaryKey(),
    userId: char('userId', { length: 36 }).notNull(),
    matterId: char('matterId', { length: 36 }).notNull(),
    documentId: char('documentId', { length: 36 }).notNull(),
    partyId: char('partyId', { length: 36 }).notNull(),
    // roleKey: validated at write against the document type's declared requiredRoles/designationRoles.
    roleKey: varchar('roleKey', { length: 64 }).notNull(),
    sortOrder: int('sortOrder').notNull().default(0),
    createdBy: char('createdBy', { length: 36 }).notNull(),
    createdAt: timestamp('createdAt').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    uniqDocumentPartyRole: uniqueIndex('uq_document_party_doc_party_role').on(
      table.documentId,
      table.partyId,
      table.roleKey,
    ),
    idxDocumentPartyDoc: index('idx_document_party_doc').on(table.userId, table.documentId),
    idxDocumentPartyParty: index('idx_document_party_party').on(table.userId, table.partyId),
  }),
);
export type DocumentParty = typeof documentParty.$inferSelect;
export type NewDocumentParty = typeof documentParty.$inferInsert;

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
  // MATERIALS-DROPZONE-1 Inc B (image + scanned-PDF OCR): async-OCR lifecycle states.
  // 'processing' — OCR queued/running (set at upload, cleared when OCR finishes).
  // 'low_confidence' — OCR ran but fell below the confidence floor; text is shown to the
  //   user but EXCLUDED from the assessment context (honesty floor; see analysisContext).
  'processing',
  'low_confidence',
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
    // EGRESS-CONTROL-PLANE-1 Inc 2 (CR-4) — the lifecycle SUB-state machine, a COMPANION to `state`
    // (which is unchanged: migration 0043 — `state` is locked by the activeSessionKey generated column,
    // so the new phases live here). NULL = idle/active-normal (created, reviewers running, or the
    // attorney reviewing/selecting); 'dispatching' = the brief post-commit transmit handoff window
    // (recovery-refusal marker); 'completed' = all expected lanes terminal; 'held' / 'blocked_by_hold' /
    // 'partial_blocked_by_hold' are SET by the egress gate in Increment 3 (recovery already refuses them).
    // The Zod Wall reads it .nullable().optional().
    lifecyclePhase: varchar('lifecyclePhase', { length: 32 }),
    // partialReason: 'non_response' (some reviewers failed/timed-out — informational) vs 'blocked_by_hold'
    // (a no_external hold blocked reviewers — Inc 3's send gate requires the recorded one-click attorney
    // acknowledgment). NULL = clean / not partial. The Inc-2 data foundation for the Inc-3 send gate.
    partialReason: varchar('partialReason', { length: 32 }),
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
  // EGRESS-CONTROL-PLANE-1 Inc 2 (CR-4): a review-session lifecycle transition (auto-recovery /
  // attorney-initiated / hold-frozen — the reason is in the audit payload). Durable + append-only so a
  // silent abandon can never occur (spoliation / incomplete-production exposure under long retention).
  'review_session_transition',
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
// CONFLICT-GATE-OVERRIDE-1 — gate_override (attested per-matter, per-precondition gate override)
// ============================================================
// APPEND-ONLY record of an attorney attesting an override of ONE fail-closed drafting precondition
// (conflicts clearance OR party identity verification) for ONE matter. The gate DEFAULT is UNCHANGED —
// this records an explicit attorney act the gate CONSULTS, never a global toggle. snapshot/snapshotHash
// bind the override to the precondition STATE at attestation; a material change re-arms it (the current
// state's hash no longer matches the stored hash), the same "supersedes on change" pattern as
// sendability_override.contentHash. Immutable (no updatedAt); a re-attestation appends a new row.
// Enum literals are kept in sync (by hand) with src/shared/schemas/gateOverride.ts (a guard test pins it).
export const GATE_OVERRIDE_PRECONDITION_VALUES = ['conflicts', 'identity'] as const;
export const GATE_OVERRIDE_REASON_CODE_VALUES = [
  'cleared_out_of_band',
  'verified_out_of_band',
  'waived_professional_judgment',
  'testing',
  'other',
] as const;

export const gateOverride = mysqlTable(
  'gate_override',
  {
    id: char('id', { length: 36 }).primaryKey(),
    userId: char('userId', { length: 36 }).notNull(),
    matterId: char('matterId', { length: 36 }).notNull(),
    precondition: mysqlEnum('precondition', GATE_OVERRIDE_PRECONDITION_VALUES).notNull(),
    snapshot: json('snapshot').notNull(),
    snapshotHash: varchar('snapshotHash', { length: 128 }).notNull(),
    reasonCode: mysqlEnum('reasonCode', GATE_OVERRIDE_REASON_CODE_VALUES).notNull(),
    reasonText: text('reasonText'),
    createdAt: timestamp('createdAt').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    idxGateOverrideMatter: index('idx_gate_override_matter').on(
      table.userId,
      table.matterId,
      table.precondition,
      table.createdAt,
    ),
    idxGateOverrideMatterCreated: index('idx_gate_override_matter_created').on(table.matterId, table.createdAt),
  }),
);
export type GateOverride = typeof gateOverride.$inferSelect;
export type NewGateOverride = typeof gateOverride.$inferInsert;

// ============================================================
// CONFLICT-TOGGLE-1 (Inc 1) — firm_conflict_policy (firm-scoped conflicts posture policy)
// ============================================================
// APPEND-ONLY: one row per version of a firm's conflicts posture policy; the latest row (by
// firmOwnerUserId, createdAt) is current, and the row history IS the tamper-evident settings-audit. The
// policy relaxes only through an explicit, audited INSERT — never UPDATE/DELETE. FIRM-scoped (keyed by the
// firm's owning attorney, firm-shaped for a later multi-user firm), NOT per-user. NO DB FK (app-layer
// ownerScope). Index is INLINE (migration 0047). DORMANT in Inc 1 — nothing reads the posture yet.
export const firmConflictPolicy = mysqlTable(
  'firm_conflict_policy',
  {
    id: char('id', { length: 36 }).primaryKey(),
    firmOwnerUserId: char('firmOwnerUserId', { length: 36 }).notNull(),
    policy: json('policy').notNull(),
    changedByUserId: char('changedByUserId', { length: 36 }).notNull(),
    reasonText: text('reasonText'),
    createdAt: timestamp('createdAt').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    idxFirmConflictPolicyOwner: index('idx_firm_conflict_policy_owner').on(
      table.firmOwnerUserId,
      table.createdAt,
    ),
  }),
);
export type FirmConflictPolicy = typeof firmConflictPolicy.$inferSelect;
export type NewFirmConflictPolicy = typeof firmConflictPolicy.$inferInsert;

// CONFLICT-TOGGLE-1 (Inc 2) — matter_conflict_posture (per-matter elected posture). APPEND-ONLY: latest row
// (by userId, matterId, createdAt) is the matter's current election; history is the tamper-evident audit. A
// matter relaxes to ADVISORY only via an explicit, audited INSERT carrying the attestation reason. Owner-
// scoped; NO DB FK; index INLINE (migration 0048). DORMANT in Inc 2 unless CONFLICT_GATE_ENABLED.
export const matterConflictPosture = mysqlTable(
  'matter_conflict_posture',
  {
    id: char('id', { length: 36 }).primaryKey(),
    userId: char('userId', { length: 36 }).notNull(),
    matterId: char('matterId', { length: 36 }).notNull(),
    posture: varchar('posture', { length: 16 }).notNull(),
    reasonText: text('reasonText'),
    changedByUserId: char('changedByUserId', { length: 36 }).notNull(),
    createdAt: timestamp('createdAt').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    idxMatterConflictPosture: index('idx_matter_conflict_posture').on(
      table.userId,
      table.matterId,
      table.createdAt,
    ),
  }),
);
export type MatterConflictPosture = typeof matterConflictPosture.$inferSelect;
export type NewMatterConflictPosture = typeof matterConflictPosture.$inferInsert;

// FOLD-DEED-1 (Inc 1 foundation) — deed_gate (per-deed-document recordability gate state). One row per deed
// document (documentId UNIQUE), holding the attorney-recorded affirmative-act checklist as a Zod-validated
// JSON blob. The permanent record of each act is the audit_events Matter-Record event; this is the current
// operational state. Owner+matter-scoped; NO DB FK; indexes INLINE (migration 0049). DORMANT unless
// DEED_GATE_ENABLED. FAIL-CLOSED + KB-mandatory (no locality KB → never recordable).
export const deedGate = mysqlTable(
  'deed_gate',
  {
    id: char('id', { length: 36 }).primaryKey(),
    userId: char('userId', { length: 36 }).notNull(),
    matterId: char('matterId', { length: 36 }).notNull(),
    documentId: char('documentId', { length: 36 }).notNull(),
    state: json('state').notNull(),
    changedByUserId: char('changedByUserId', { length: 36 }).notNull(),
    createdAt: timestamp('createdAt').notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp('updatedAt').notNull().default(sql`CURRENT_TIMESTAMP`).onUpdateNow(),
  },
  (table) => ({
    uxDeedGateDocument: uniqueIndex('ux_deed_gate_document').on(table.documentId),
    idxDeedGateMatter: index('idx_deed_gate_matter').on(table.userId, table.matterId),
  }),
);
export type DeedGate = typeof deedGate.$inferSelect;
export type NewDeedGate = typeof deedGate.$inferInsert;

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
    // DOC-CLIENT-TARGET-1: soft-delete (mirrors matter_materials Ch 21.6). A party bound to a
    // finalized document is BLOCK-deleted (refused) at the app layer; an unbound party removal sets
    // deletedAt instead of hard-deleting, so a party_id correction never vanishes under a finalized
    // instrument. List reads + conflicts screening exclude soft-deleted rows.
    deletedAt: timestamp('deletedAt'),
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

// KNOWLEDGE-BACKBONE-PHASE2 (I1) — minimal-floor scope-metadata risk classification (low|medium|high).
// A v1 input to a FUTURE auto-apply gate (I3); I1 only STORES it. Stored as varchar; validated at the Zod Wall.
export const MEMO_RISK_LEVEL_VALUES = ['low', 'medium', 'high'] as const;
export type MemoRiskLevel = (typeof MEMO_RISK_LEVEL_VALUES)[number];

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
    // KB-PROVENANCE-1 (WHEREAS_KB_CONSTITUTION §8 provenance/currency fields). Additive nullable.
    // verified_date intentionally NOT added (duplicates verifiedThroughDate/lastVerifiedAt);
    // supersedes_id deferred per §8 (supersededById already exists above).
    effectiveDate: date('effectiveDate', { mode: 'string' }),
    reviewBy: date('reviewBy', { mode: 'string' }),
    authoritySnapshotId: char('authoritySnapshotId', { length: 36 }),
    negativeTreatmentFlag: boolean('negativeTreatmentFlag'),
    // KNOWLEDGE-BACKBONE-PHASE2 (I1) scope-metadata floor (minimal now, accrete later) — the v1 inputs to a
    // FUTURE auto-apply gate (I3); I1 only STORES them, never applies. documentType + riskLevel are scope tags
    // (riskLevel validated low|medium|high at the Zod Wall). autoApplyEligible defaults FALSE and may be flipped
    // true ONLY for an abstracted + firm-wide (graduated) entry — raw decision-stream entries never auto-apply
    // (D3). conflictsHook holds origin-matter conflict metadata captured at graduation (cheap now, impossible to
    // reconstruct retroactively — D2); store-only this increment.
    documentType: varchar('documentType', { length: 64 }),
    riskLevel: varchar('riskLevel', { length: 16 }),
    autoApplyEligible: boolean('autoApplyEligible').notNull().default(false),
    conflictsHook: json('conflictsHook'),
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
    // NOTIFY-SUITE-1 N2: per-tickler "alerted-at" cursor (NULL = not yet alerted). Additive (migration 0046).
    notifiedAt: timestamp('notifiedAt'),
    createdAt: timestamp('createdAt').notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp('updatedAt').notNull().default(sql`CURRENT_TIMESTAMP`).onUpdateNow(),
  },
  (table) => ({
    idxTicklerDeadline: index('idx_tickler_deadline').on(table.matterDeadlineId),
    idxTicklerUserFire: index('idx_tickler_user_fire').on(table.userId, table.fireAt),
    // NOTIFY-SUITE-1 N2: the producer's "owner's not-yet-alerted ticklers" read (userId, notifiedAt).
    idxTicklerUserNotified: index('idx_tickler_user_notified').on(table.userId, table.notifiedAt),
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

// ============================================================
// INSTR-1A0 (INSTRUCTIONS-LEG-1) — prompt_snapshots (migration 0026)
// ============================================================
// APPEND-ONLY per-draft-job record of the FULL composed system text actually sent to the
// provider (both paths, flag on or off), with its SHA-256, the composed asset's logical
// ID + manifest hash (or 'legacy'), the flag state at dispatch, and model/provider/adapter.
// Written best-effort at the LLM-dispatch chokepoint AFTER all assembly (master swap or the
// legacy matter-state/PA-profile injections) so the row is byte-faithful to the request.
// IMMUTABLE (no updatedAt); insert-only in 1A0 (read path + Zod wall arrive with a consumer).

export const promptSnapshots = mysqlTable(
  'prompt_snapshots',
  {
    id: char('id', { length: 36 }).primaryKey(),
    userId: char('userId', { length: 36 }).notNull(),
    jobId: char('jobId', { length: 36 }).notNull(),
    matterId: char('matterId', { length: 36 }),
    documentId: char('documentId', { length: 36 }),
    jobType: varchar('jobType', { length: 64 }).notNull(),
    callRole: varchar('callRole', { length: 32 }).notNull(),
    // 'master/claude/te' when composed; 'legacy' otherwise.
    source: varchar('source', { length: 64 }).notNull(),
    // Composed-path provenance; both NULL on the legacy path.
    assetId: varchar('assetId', { length: 64 }),
    assetSha256: char('assetSha256', { length: 64 }),
    // The full system block actually sent + its hash (the audit core of the experiment).
    systemText: mediumtext('systemText').notNull(),
    systemSha256: char('systemSha256', { length: 64 }).notNull(),
    flagEnabled: boolean('flagEnabled').notNull(),
    modelString: varchar('modelString', { length: 128 }).notNull(),
    providerId: varchar('providerId', { length: 32 }).notNull(),
    modelId: varchar('modelId', { length: 96 }).notNull(),
    // The registry maps provider -> adapter 1:1 today; recorded separately so a future
    // multi-adapter provider stays distinguishable in old rows.
    adapterId: varchar('adapterId', { length: 32 }).notNull(),
    createdAt: timestamp('createdAt').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    idxPromptSnapshotsJob: index('idx_prompt_snapshots_job').on(table.jobId),
    idxPromptSnapshotsUserCreated: index('idx_prompt_snapshots_user_created').on(table.userId, table.createdAt),
  }),
);
export type PromptSnapshot = typeof promptSnapshots.$inferSelect;
export type NewPromptSnapshot = typeof promptSnapshots.$inferInsert;

// ============================================================
// CHAT-UI-1 W2 — posture_provenance (durable posture audit ledger, PROVENANCE-LEDGER-1)
// ============================================================
// Append-only, owner-scoped, per-matter audit ledger for the CHAT-UI-1 posture-confirm discipline.
// One row per meaningful accept or dirty->confirmed transition (eventClass), carrying the full
// resolved {issuer, privilege, recipient} triple (typed columns), the incoherence verdict, the
// hard-stop act, actor, slider position, trigger source, and the attorney confirm timestamp.
// Tamper-EVIDENT via a per-matter sha256 hash chain (prevHash -> entryHash). Insert + read only (no
// update/delete). Entirely behind CHAT_UI_1_ENABLED; inert (no rows) when off. ADDITIVE (migration
// 0028, CREATE TABLE) — no existing table is altered.
export const POSTURE_PROVENANCE_EVENT_CLASS_VALUES = ['meaningful_accept', 'dirty_confirmed'] as const;
export const POSTURE_PROVENANCE_ACT_VALUES = [
  'lock',
  'tier_source',
  'disposition',
  'send',
  'matter_identity',
  'issuer',
  'privilege',
  'recipient',
] as const;
export const POSTURE_PROVENANCE_CAPACITY_VALUES = ['counsel', 'principal'] as const;
export const POSTURE_PROVENANCE_PRIVILEGE_VALUES = ['privileged', 'not_privileged', 'undetermined'] as const;
export const POSTURE_PROVENANCE_RECIPIENT_VALUES = [
  'internal_client',
  'co_counsel_agent',
  'neutral_third_party',
  'regulator_court',
  'adverse',
  'public',
] as const;
export const POSTURE_PROVENANCE_VERDICT_VALUES = ['hard', 'soft', 'none'] as const;

export const postureProvenance = mysqlTable(
  'posture_provenance',
  {
    id: char('id', { length: 36 }).primaryKey(),
    userId: char('userId', { length: 36 }).notNull(),
    matterId: char('matterId', { length: 36 }).notNull(),
    documentId: char('documentId', { length: 36 }),
    // Per-matter monotonic sequence — the chain order (TIMESTAMP is second-resolution and can tie).
    seq: int('seq').notNull(),
    eventClass: mysqlEnum('eventClass', POSTURE_PROVENANCE_EVENT_CLASS_VALUES).notNull(),
    act: mysqlEnum('act', POSTURE_PROVENANCE_ACT_VALUES).notNull(),
    actor: varchar('actor', { length: 128 }).notNull(),
    sliderPosition: varchar('sliderPosition', { length: 64 }).notNull(),
    triggerSource: text('triggerSource').notNull(),
    confirmedAt: varchar('confirmedAt', { length: 32 }).notNull(),
    // Resolved triple (typed, first-class). NULL for a non-posture act (no triple).
    issuerEntity: varchar('issuerEntity', { length: 255 }),
    issuerCapacity: mysqlEnum('issuerCapacity', POSTURE_PROVENANCE_CAPACITY_VALUES),
    issuerDisplay: text('issuerDisplay'),
    privilege: mysqlEnum('privilege', POSTURE_PROVENANCE_PRIVILEGE_VALUES),
    recipient: mysqlEnum('recipient', POSTURE_PROVENANCE_RECIPIENT_VALUES),
    // Supplementary + the incoherence-table verdict.
    priorTriple: json('priorTriple'),
    verdictSeverity: mysqlEnum('verdictSeverity', POSTURE_PROVENANCE_VERDICT_VALUES).notNull(),
    findings: json('findings').notNull(),
    // CHAT-UI-1 W3 (migration 0029) — the non-posture act's target (matter identity, undo, ...).
    subject: json('subject'),
    // Per-matter tamper-evident hash chain.
    prevHash: varchar('prevHash', { length: 64 }).notNull(),
    entryHash: varchar('entryHash', { length: 64 }).notNull(),
    createdAt: timestamp('createdAt').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    idxPostureProvenanceMatter: index('idx_posture_provenance_matter').on(table.matterId, table.seq),
    idxPostureProvenanceUserMatter: index('idx_posture_provenance_user_matter').on(table.userId, table.matterId),
  }),
);
export type PostureProvenance = typeof postureProvenance.$inferSelect;
export type NewPostureProvenance = typeof postureProvenance.$inferInsert;

// ============================================================
// REVIEWER-ASYNC-DISPLAY-1 (Gate 0, Component C) — reviewer_lanes
// ============================================================
// One row per EXPECTED reviewer of an async multi-reviewer review iteration (the immutable expected
// set, persisted at create BEFORE dispatch — condition 2). Server-owned per-reviewer terminal status
// (a DIFFERENT vocabulary than job status) + a C-owned terminalDeadlineAt (condition 4, defense-in-
// depth). Additive table (migration 0030_*); matter-scoped (purged with the matter). Written ONLY on
// the async path (REVIEWER_ASYNC_ENABLED). Status values are sourced from the shared lane module.
export const reviewerLanes = mysqlTable(
  'reviewer_lanes',
  {
    id: char('id', { length: 36 }).primaryKey(),
    userId: char('userId', { length: 36 }).notNull(),
    matterId: char('matterId', { length: 36 }).notNull(),
    documentId: char('documentId', { length: 36 }).notNull(),
    // versionId: the document revision under review at dispatch (== feedback.versionId) — condition 6
    versionId: char('versionId', { length: 36 }).notNull(),
    reviewSessionId: char('reviewSessionId', { length: 36 }).notNull(),
    iterationNumber: int('iterationNumber').notNull(),
    // reviewerRole: free VARCHAR like feedback.reviewerRole (no DB enum — claude/gpt/gemini/grok + *_lite)
    reviewerRole: varchar('reviewerRole', { length: 64 }).notNull(),
    reviewerTitle: varchar('reviewerTitle', { length: 128 }).notNull(),
    // jobId: the dispatched reviewer job (null until dispatched / if dispatch_failed)
    jobId: char('jobId', { length: 36 }),
    status: mysqlEnum('status', REVIEWER_LANE_STATUS_VALUES).notNull().default('pending'),
    suggestionCount: int('suggestionCount'),
    feedbackRowId: char('feedbackRowId', { length: 36 }),
    failureReason: text('failureReason'),
    terminalDeadlineAt: timestamp('terminalDeadlineAt').notNull(),
    terminalizedAt: timestamp('terminalizedAt'),
    createdAt: timestamp('createdAt').notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp('updatedAt').notNull().default(sql`CURRENT_TIMESTAMP`).onUpdateNow(),
  },
  (table) => ({
    idxReviewerLanesSession: index('idx_reviewer_lanes_session').on(table.reviewSessionId),
    idxReviewerLanesMatter: index('idx_reviewer_lanes_matter').on(table.matterId, table.userId),
    // for C's per-lane deadline sweep: non-terminal lanes past terminalDeadlineAt
    idxReviewerLanesDeadline: index('idx_reviewer_lanes_deadline').on(table.status, table.terminalDeadlineAt),
    // one lane per reviewer per session (latest-terminal-per-reviewer dedupe — condition 1)
    uniqReviewerLaneSessionReviewer: uniqueIndex('uniq_reviewer_lane_session_reviewer').on(
      table.reviewSessionId,
      table.reviewerRole,
    ),
  }),
);
export type ReviewerLane = typeof reviewerLanes.$inferSelect;
export type NewReviewerLane = typeof reviewerLanes.$inferInsert;

// ============================================================
// CHAT-COPILOT-1 (Inc 1) — chat_conversations / chat_messages / chat_summaries
// ============================================================
// Persisted matter-scoped chat copilot. Additive (migration 0033); written ONLY when
// CHAT_COPILOT_ENABLED is ON (default OFF). STORE-BY-REFERENCE by construction: there is NO column for
// the compiled master body, raw assembled context, source chunks, or NPI field values. Isolation is
// app-layer (immutable matterId/documentId/capacitySnapshot + ownerScope() + the assertConversationContext
// guard + capacity-bound summaries); no DB FK (codebase convention; matterPurge cascades in app code).
export const chatConversations = mysqlTable(
  'chat_conversations',
  {
    id: char('id', { length: 36 }).primaryKey(),
    userId: char('userId', { length: 36 }).notNull(),
    // Immutable binding — a conversation belongs to exactly one matter, forever (never updated).
    matterId: char('matterId', { length: 36 }).notNull(),
    // Immutable / explicitly-versioned document binding (nullable — a conversation need not be doc-bound).
    documentId: char('documentId', { length: 36 }),
    documentVersionId: char('documentVersionId', { length: 36 }),
    title: varchar('title', { length: 256 }),
    // capacitySnapshot: { engagementCapacity, electionMarker, titleSignal } at conversation start.
    capacitySnapshot: json('capacitySnapshot').notNull(),
    retentionClass: mysqlEnum('retentionClass', CHAT_CONVERSATION_RETENTION_CLASS_VALUES)
      .notNull()
      .default('active_matter_plus_5y'),
    legalHold: boolean('legalHold').notNull().default(false),
    legalHoldReason: text('legalHoldReason'),
    doNotPersist: boolean('doNotPersist').notNull().default(false),
    excludeFromGrounding: boolean('excludeFromGrounding').notNull().default(false),
    // CHAT-COPILOT-2 G2: external-egress hold. 'no_external' blocks the primary model call AND grounding
    // egress for this conversation (an NDA / own-confidentiality conversation). Default 'none'.
    holdFlag: mysqlEnum('holdFlag', CHAT_HOLD_FLAG_VALUES).notNull().default('none'),
    // Inc 2 freeze-on-capacity-divergence (column added now so Inc 2 needs no new migration).
    frozenAt: timestamp('frozenAt'),
    freezeReason: text('freezeReason'),
    closedAt: timestamp('closedAt'),
    exportedAt: timestamp('exportedAt'),
    exportRef: varchar('exportRef', { length: 255 }),
    deletedAt: timestamp('deletedAt'),
    createdAt: timestamp('createdAt').notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp('updatedAt').notNull().default(sql`CURRENT_TIMESTAMP`).onUpdateNow(),
  },
  (table) => ({
    idxChatConversationsMatter: index('idx_chat_conversations_matter').on(table.matterId, table.userId),
    idxChatConversationsOwner: index('idx_chat_conversations_owner').on(table.userId, table.createdAt),
  }),
);
export type ChatConversation = typeof chatConversations.$inferSelect;
export type NewChatConversation = typeof chatConversations.$inferInsert;

export const chatMessages = mysqlTable(
  'chat_messages',
  {
    id: char('id', { length: 36 }).primaryKey(),
    userId: char('userId', { length: 36 }).notNull(),
    matterId: char('matterId', { length: 36 }).notNull(),
    conversationId: char('conversationId', { length: 36 }).notNull(),
    seq: int('seq').notNull(),
    role: mysqlEnum('role', CHAT_MESSAGE_ROLE_VALUES).notNull(),
    // content: attorney turn text OR model response. NULL on a do-not-persist tombstone. NEVER the
    // compiled master body or raw assembled context (store-by-reference).
    content: mediumtext('content'),
    contentHash: varchar('contentHash', { length: 64 }),
    // masterApplied / masterSource: AUDIT-ONLY — never short-circuit the fresh per-turn gate.
    masterApplied: boolean('masterApplied').notNull().default(false),
    masterSource: varchar('masterSource', { length: 64 }),
    capacitySnapshot: json('capacitySnapshot'),
    // draftingGateDecisionId: deterministic hash of the resolveDraftingGate decision at turn time.
    draftingGateDecisionId: varchar('draftingGateDecisionId', { length: 128 }),
    // citations: [{ sourceId, locator }] references ONLY (Inc 3 populates) — never copied chunk text.
    citations: json('citations'),
    modelProvider: varchar('modelProvider', { length: 64 }),
    modelId: varchar('modelId', { length: 64 }),
    doNotPersist: boolean('doNotPersist').notNull().default(false),
    excludeFromGrounding: boolean('excludeFromGrounding').notNull().default(false),
    createdAt: timestamp('createdAt').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    idxChatMessagesConversation: index('idx_chat_messages_conversation').on(table.conversationId, table.seq),
    idxChatMessagesMatter: index('idx_chat_messages_matter').on(table.matterId, table.userId),
    uniqChatMessageConversationSeq: uniqueIndex('uniq_chat_message_conversation_seq').on(
      table.conversationId,
      table.seq,
    ),
  }),
);
export type ChatMessage = typeof chatMessages.$inferSelect;
export type NewChatMessage = typeof chatMessages.$inferInsert;

export const chatSummaries = mysqlTable(
  'chat_summaries',
  {
    id: char('id', { length: 36 }).primaryKey(),
    userId: char('userId', { length: 36 }).notNull(),
    matterId: char('matterId', { length: 36 }).notNull(),
    conversationId: char('conversationId', { length: 36 }).notNull(),
    // matter-bound AND capacity-bound; posture is STRUCTURED metadata (never just prose).
    capacitySnapshot: json('capacitySnapshot').notNull(),
    posture: json('posture').notNull(),
    coversFromSeq: int('coversFromSeq').notNull(),
    coversToSeq: int('coversToSeq').notNull(),
    summaryText: mediumtext('summaryText').notNull(),
    createdAt: timestamp('createdAt').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    idxChatSummariesConversation: index('idx_chat_summaries_conversation').on(table.conversationId, table.coversToSeq),
    idxChatSummariesMatter: index('idx_chat_summaries_matter').on(table.matterId, table.userId),
  }),
);
export type ChatSummary = typeof chatSummaries.$inferSelect;
export type NewChatSummary = typeof chatSummaries.$inferInsert;

// CHAT-COPILOT-2 Increment A (G1/G3) — the append-only egress audit log. Every copilot egress decision
// (allowed OR blocked) is written here in the SAME transaction as the gate decision, BY CONSTRUCTION:
// the broker (src/server/llm/egressClient.ts) cannot dispatch a copilot send without first writing a row.
// STORE-BY-REFERENCE / no-content: there is deliberately NO column for the prompt/payload, the response,
// or any NPI value — only metadata + a salted/keyed hash over the MINIMIZED payload (inputBundleHash).
// Append-only: only the dispatch-outcome fields (status/failureReason/completedAt/token counts) are
// filled in by a single completion update; the decision + hash + metadata are never mutated. No DB FK
// (app-layer isolation, codebase convention). Written ONLY when CHAT_COPILOT_ENABLED is ON (default OFF).
export const chatEgressEvents = mysqlTable(
  'chat_egress_events',
  {
    id: char('id', { length: 36 }).primaryKey(),
    userId: char('userId', { length: 36 }).notNull(),
    matterId: char('matterId', { length: 36 }).notNull(),
    conversationId: char('conversationId', { length: 36 }),
    messageId: char('messageId', { length: 36 }),
    gateDecisionId: varchar('gateDecisionId', { length: 128 }),
    kind: mysqlEnum('kind', CHAT_EGRESS_KIND_VALUES).notNull(),
    decision: mysqlEnum('decision', CHAT_EGRESS_DECISION_VALUES).notNull(),
    blockReason: varchar('blockReason', { length: 128 }),
    allowlistVersion: varchar('allowlistVersion', { length: 128 }),
    authorizationBasis: mysqlEnum('authorizationBasis', CHAT_EGRESS_AUTH_BASIS_VALUES)
      .notNull()
      .default('config_allowlist'),
    provider: varchar('provider', { length: 64 }).notNull(),
    model: varchar('model', { length: 128 }).notNull(),
    minimizationApplied: boolean('minimizationApplied').notNull().default(false),
    minimizationProfile: varchar('minimizationProfile', { length: 64 }),
    // JSON arrays of category labels / ids only — NEVER NPI values.
    npiCategoriesIncluded: json('npiCategoriesIncluded'),
    npiCategoriesWithheld: json('npiCategoriesWithheld'),
    holdHonored: boolean('holdHonored').notNull().default(false),
    holdExcludedAttachmentIds: json('holdExcludedAttachmentIds'),
    // Q1 hash-at-gate: salted/keyed hash over the COPILOT-COMPOSED minimized, hold-filtered bundle
    // (system + any layered master + grounded context + history + turn). NOT the raw payload (a
    // low-entropy field is not recoverable from the hash). Does NOT yet cover the platform's downstream
    // matter-state metadata block (documented A1 follow-up — see egressClient EgressAuditContext).
    inputBundleHash: varchar('inputBundleHash', { length: 128 }),
    attachmentIds: json('attachmentIds'),
    region: varchar('region', { length: 64 }),
    correlationId: char('correlationId', { length: 36 }).notNull(),
    requestId: varchar('requestId', { length: 128 }),
    status: mysqlEnum('status', CHAT_EGRESS_STATUS_VALUES).notNull().default('pending'),
    failureReason: varchar('failureReason', { length: 255 }),
    includedAttachmentCount: int('includedAttachmentCount').notNull().default(0),
    npiWithheldCount: int('npiWithheldCount').notNull().default(0),
    createdAt: timestamp('createdAt').notNull().default(sql`CURRENT_TIMESTAMP`),
    completedAt: timestamp('completedAt'),
  },
  (table) => ({
    // Supervision queries (Q7): by matter, by provider, by recency.
    idxChatEgressMatter: index('idx_chat_egress_matter').on(table.matterId, table.userId, table.createdAt),
    idxChatEgressProvider: index('idx_chat_egress_provider').on(table.provider, table.createdAt),
    idxChatEgressConversation: index('idx_chat_egress_conversation').on(table.conversationId, table.createdAt),
  }),
);
export type ChatEgressEvent = typeof chatEgressEvents.$inferSelect;
export type NewChatEgressEvent = typeof chatEgressEvents.$inferInsert;

// EGRESS-CONTROL-PLANE-1 (Increment 1) — the surface-agnostic egress audit ledger. Every external-model
// send of client/matter content writes ONE durable decision row here BEFORE dispatch (allowed OR blocked +
// reason). Store-by-reference: inputBundleHash is a salted/keyed hash over the minimized payload — NEVER
// the draft text. chat_egress_events is untouched; the DOCUMENT egress path (sendability pilot) writes here.
export const egressEvents = mysqlTable(
  'egress_events',
  {
    id: char('id', { length: 36 }).primaryKey(),
    userId: char('userId', { length: 36 }).notNull(),
    matterId: char('matterId', { length: 36 }).notNull(),
    surface: mysqlEnum('surface', EGRESS_SURFACE_VALUES).notNull(),
    subjectType: mysqlEnum('subjectType', EGRESS_SUBJECT_TYPE_VALUES).notNull(),
    // Polymorphic subject scope (nullable per type). A document send leaves conversationId NULL.
    conversationId: char('conversationId', { length: 36 }),
    documentId: char('documentId', { length: 36 }),
    documentVersionId: char('documentVersionId', { length: 36 }),
    jobId: char('jobId', { length: 36 }),
    holdScope: mysqlEnum('holdScope', EGRESS_HOLD_SCOPE_VALUES),
    decision: mysqlEnum('decision', EGRESS_DECISION_VALUES).notNull(),
    blockReason: varchar('blockReason', { length: 128 }),
    provider: varchar('provider', { length: 64 }).notNull(),
    model: varchar('model', { length: 128 }).notNull(),
    policyVersion: varchar('policyVersion', { length: 128 }),
    inputBundleHash: varchar('inputBundleHash', { length: 128 }),
    correlationId: char('correlationId', { length: 36 }).notNull(),
    status: mysqlEnum('status', EGRESS_STATUS_VALUES).notNull().default('pending'),
    failureReason: varchar('failureReason', { length: 255 }),
    createdAt: timestamp('createdAt').notNull().default(sql`CURRENT_TIMESTAMP`),
    completedAt: timestamp('completedAt'),
  },
  (table) => ({
    idxEgressEventsMatter: index('idx_egress_events_matter').on(table.matterId, table.userId, table.createdAt),
    idxEgressEventsSurface: index('idx_egress_events_surface').on(table.surface, table.createdAt),
    idxEgressEventsDocument: index('idx_egress_events_document').on(table.documentId, table.createdAt),
    idxEgressEventsDecision: index('idx_egress_events_decision').on(table.decision, table.matterId, table.userId),
  }),
);
export type EgressEvent = typeof egressEvents.$inferSelect;
export type NewEgressEvent = typeof egressEvents.$inferInsert;

// EGRESS-CONTROL-PLANE-1 (Increment 1) — a scoped external-egress hold (matter/global; conversation.holdFlag
// covers chat). subjectId = conversationId | matterId (NULL for scope='global'). matterId is set for
// conversation/matter scope (purges WITH the matter); NULL for a firm-level global hold (retained across
// matter purge). Release is audit-preserving (active=false + releasedAt; no in-operation row delete).
export const egressHold = mysqlTable(
  'egress_hold',
  {
    id: char('id', { length: 36 }).primaryKey(),
    userId: char('userId', { length: 36 }).notNull(),
    scope: mysqlEnum('scope', EGRESS_HOLD_SCOPE_VALUES).notNull(),
    subjectId: char('subjectId', { length: 36 }),
    matterId: char('matterId', { length: 36 }),
    holdFlag: mysqlEnum('holdFlag', EGRESS_HOLD_FLAG_VALUES).notNull().default('no_external'),
    reason: text('reason'),
    active: boolean('active').notNull().default(true),
    createdByUserId: char('createdByUserId', { length: 36 }).notNull(),
    createdAt: timestamp('createdAt').notNull().default(sql`CURRENT_TIMESTAMP`),
    releasedAt: timestamp('releasedAt'),
  },
  (table) => ({
    uniqEgressHoldScopeSubject: uniqueIndex('uniq_egress_hold_scope_subject').on(table.userId, table.scope, table.subjectId),
    idxEgressHoldMatter: index('idx_egress_hold_matter').on(table.matterId, table.userId),
    idxEgressHoldActive: index('idx_egress_hold_active').on(table.userId, table.active, table.scope),
  }),
);
export type EgressHold = typeof egressHold.$inferSelect;
export type NewEgressHold = typeof egressHold.$inferInsert;

// CHAT-COPILOT-2 A2 — ephemeral chat attachments. Store BY-REFERENCE (extracted text + metadata, NOT raw
// file bytes — storageKey is a placeholder like matter_materials), conversation-scoped, EPHEMERAL by
// default (purged at conversation end / immediately on do-not-persist; a `pinned` provenance attachment
// survives). textContent follows the honesty floor (NULL on low-confidence). Written ONLY when
// CHAT_COPILOT_ENABLED is ON (default OFF). No DB FK (app-layer isolation, codebase convention).
export const chatAttachments = mysqlTable(
  'chat_attachments',
  {
    id: char('id', { length: 36 }).primaryKey(),
    userId: char('userId', { length: 36 }).notNull(),
    matterId: char('matterId', { length: 36 }).notNull(),
    conversationId: char('conversationId', { length: 36 }).notNull(),
    filename: varchar('filename', { length: 512 }),
    mimeType: varchar('mimeType', { length: 128 }),
    fileSize: int('fileSize'),
    storageKey: varchar('storageKey', { length: 512 }),
    // contentHash: SHA-256 of the uploaded bytes — cross-matter duplicate detection (Q3). NOT NPI.
    contentHash: varchar('contentHash', { length: 64 }),
    textContent: mediumtext('textContent'),
    extractionStatus: mysqlEnum('extractionStatus', EXTRACTION_STATUS_VALUES).notNull(),
    extractionError: text('extractionError'),
    // ocrQuality: { meanConfidence, perPageConfidence, warnings, dangerousMiddleFieldTypes, ... } — labels
    // + confidences ONLY, never the field values (no NPI).
    ocrQuality: json('ocrQuality'),
    holdFlag: mysqlEnum('holdFlag', CHAT_HOLD_FLAG_VALUES).notNull().default('none'),
    acceptedWithWarning: boolean('acceptedWithWarning').notNull().default(false),
    pinned: boolean('pinned').notNull().default(false),
    savedMaterialId: char('savedMaterialId', { length: 36 }),
    seq: int('seq').notNull().default(0),
    deletedAt: timestamp('deletedAt'),
    createdAt: timestamp('createdAt').notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp('updatedAt').notNull().default(sql`CURRENT_TIMESTAMP`).onUpdateNow(),
  },
  (table) => ({
    idxChatAttachmentsConversation: index('idx_chat_attachments_conversation').on(table.conversationId, table.seq),
    idxChatAttachmentsMatter: index('idx_chat_attachments_matter').on(table.matterId, table.userId),
    // Cross-matter duplicate lookup (Q3): owner-scoped by content hash.
    idxChatAttachmentsHash: index('idx_chat_attachments_hash').on(table.userId, table.contentHash),
  }),
);
export type ChatAttachment = typeof chatAttachments.$inferSelect;
export type NewChatAttachment = typeof chatAttachments.$inferInsert;

// CHAT-COPILOT-2 A2 — optional party attribution captured at save-to-matter (Q3): which matter party a
// document belongs to, so role-based intra-matter exclusion is enforceable rather than aspirational.
export const chatAttachmentParty = mysqlTable(
  'chat_attachment_party',
  {
    id: char('id', { length: 36 }).primaryKey(),
    userId: char('userId', { length: 36 }).notNull(),
    matterId: char('matterId', { length: 36 }).notNull(),
    attachmentId: char('attachmentId', { length: 36 }).notNull(),
    partyId: char('partyId', { length: 36 }),
    partyRole: varchar('partyRole', { length: 64 }),
    attribution: mysqlEnum('attribution', CHAT_ATTACHMENT_ATTRIBUTION_VALUES).notNull(),
    createdAt: timestamp('createdAt').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    idxChatAttachmentPartyAttachment: index('idx_chat_attachment_party_attachment').on(table.attachmentId),
    idxChatAttachmentPartyMatter: index('idx_chat_attachment_party_matter').on(table.matterId, table.userId),
  }),
);
export type ChatAttachmentPartyRowDb = typeof chatAttachmentParty.$inferSelect;
export type NewChatAttachmentParty = typeof chatAttachmentParty.$inferInsert;

// CHAT-COPILOT-2 Increment B — multi-model review panel. THREE additive, owner+matter-scoped tables
// (migration 0040). WORK-PRODUCT: they purge WITH the matter (NOT in EVERYDAY_DELETE_PRESERVE). Written
// ONLY when CHAT_REVIEW_PANEL_ENABLED is ON (default OFF). No DB FK (app-layer ownerScope isolation).
//
// chat_review_runs — one on-demand panel review of a chat work product: the panel-confirmed reviewer set
// + the provenance hashes (the work product reviewed + the minimized, hold-filtered bundle that actually
// transmitted). The row id IS the panelConfirmId.
export const chatReviewRuns = mysqlTable(
  'chat_review_runs',
  {
    id: char('id', { length: 36 }).primaryKey(),
    userId: char('userId', { length: 36 }).notNull(),
    matterId: char('matterId', { length: 36 }).notNull(),
    conversationId: char('conversationId', { length: 36 }).notNull(),
    messageId: char('messageId', { length: 36 }),
    workProductHash: varchar('workProductHash', { length: 128 }).notNull(),
    bundleHash: varchar('bundleHash', { length: 128 }).notNull(),
    // The attorney-selected reviewer model keys (e.g. ['gpt','gemini']); NEVER 'claude' (self-review).
    reviewerModels: json('reviewerModels').notNull(),
    status: mysqlEnum('status', CHAT_REVIEW_RUN_STATUS_VALUES).notNull().default('prepared'),
    dispositionerStatus: mysqlEnum('dispositionerStatus', CHAT_REVIEW_DISPOSITIONER_STATUS_VALUES)
      .notNull()
      .default('pending'),
    createdAt: timestamp('createdAt').notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp('updatedAt').notNull().default(sql`CURRENT_TIMESTAMP`).onUpdateNow(),
  },
  (table) => ({
    idxChatReviewRunsConversation: index('idx_chat_review_runs_conversation').on(table.conversationId, table.createdAt),
    idxChatReviewRunsMatter: index('idx_chat_review_runs_matter').on(table.matterId, table.userId),
  }),
);
export type ChatReviewRunRowDb = typeof chatReviewRuns.$inferSelect;
export type NewChatReviewRun = typeof chatReviewRuns.$inferInsert;

// chat_review_raw_outputs — the VERBATIM raw reviewer output, BY-REFERENCE and DISTINCT from the itemized
// suggestions (synthesis fidelity). One row per reviewer lane; carries the per-lane status + the egress
// back-link (every lane is its own logged egress event).
export const chatReviewRawOutputs = mysqlTable(
  'chat_review_raw_outputs',
  {
    id: char('id', { length: 36 }).primaryKey(),
    userId: char('userId', { length: 36 }).notNull(),
    matterId: char('matterId', { length: 36 }).notNull(),
    runId: char('runId', { length: 36 }).notNull(),
    reviewerModel: varchar('reviewerModel', { length: 64 }).notNull(),
    rawText: mediumtext('rawText'),
    laneStatus: mysqlEnum('laneStatus', CHAT_REVIEW_LANE_STATUS_VALUES).notNull().default('pending'),
    laneFailureReason: varchar('laneFailureReason', { length: 255 }),
    egressEventId: char('egressEventId', { length: 36 }),
    createdAt: timestamp('createdAt').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    idxChatReviewRawRun: index('idx_chat_review_raw_run').on(table.runId),
    idxChatReviewRawMatter: index('idx_chat_review_raw_matter').on(table.matterId, table.userId),
  }),
);
export type ChatReviewRawOutputRowDb = typeof chatReviewRawOutputs.$inferSelect;
export type NewChatReviewRawOutput = typeof chatReviewRawOutputs.$inferInsert;

// chat_review_items — ONE itemized reviewer suggestion + its PRIMARY disposition. 1:1 traceability (every
// reviewer suggestion -> exactly one item; suggestionHash is the key), by-reference link to the raw
// output, the flag-not-reject citation status, and the attorney's FINAL decision (nothing auto-applies).
export const chatReviewItems = mysqlTable(
  'chat_review_items',
  {
    id: char('id', { length: 36 }).primaryKey(),
    userId: char('userId', { length: 36 }).notNull(),
    matterId: char('matterId', { length: 36 }).notNull(),
    runId: char('runId', { length: 36 }).notNull(),
    reviewerModel: varchar('reviewerModel', { length: 64 }).notNull(),
    rawOutputRef: char('rawOutputRef', { length: 36 }),
    suggestionHash: varchar('suggestionHash', { length: 128 }).notNull(),
    suggestion: mediumtext('suggestion').notNull(),
    primaryDisposition: mysqlEnum('primaryDisposition', CHAT_REVIEW_DISPOSITION_VALUES),
    primaryReasoning: mediumtext('primaryReasoning'),
    citationStatus: mysqlEnum('citationStatus', CHAT_REVIEW_CITATION_STATUS_VALUES),
    attorneyDecision: mysqlEnum('attorneyDecision', CHAT_REVIEW_ATTORNEY_DECISION_VALUES)
      .notNull()
      .default('pending'),
    attorneyOverrideReason: text('attorneyOverrideReason'),
    laneStatus: mysqlEnum('laneStatus', CHAT_REVIEW_LANE_STATUS_VALUES).notNull().default('success'),
    createdAt: timestamp('createdAt').notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp('updatedAt').notNull().default(sql`CURRENT_TIMESTAMP`).onUpdateNow(),
  },
  (table) => ({
    idxChatReviewItemsRun: index('idx_chat_review_items_run').on(table.runId),
    idxChatReviewItemsMatter: index('idx_chat_review_items_matter').on(table.matterId, table.userId),
  }),
);
export type ChatReviewItemRowDb = typeof chatReviewItems.$inferSelect;
export type NewChatReviewItem = typeof chatReviewItems.$inferInsert;

// ============================================================
// FOLD-PM-4 — matter_deliverable (ongoing-matters / to-do list)
// ============================================================
// A simple owner+matter-scoped to-do item: one deliverable on one matter, owned by
// one attorney. Additive, no DB FK by convention (app-layer ownerScope isolation).
// Status enum is the single source from src/shared/schemas/matterDeliverables.ts.
// Behind MATTER_DELIVERABLE_ENABLED (default OFF).
export const matterDeliverable = mysqlTable(
  'matter_deliverable',
  {
    id: char('id', { length: 36 }).primaryKey(),
    userId: char('userId', { length: 36 }).notNull(),
    matterId: char('matterId', { length: 36 }).notNull(),
    title: varchar('title', { length: 256 }).notNull(),
    status: mysqlEnum('status', MATTER_DELIVERABLE_STATUS_VALUES).notNull().default('open'),
    dueDate: date('dueDate', { mode: 'string' }), // date-only (YYYY-MM-DD), America/New_York; nullable
    notes: text('notes'),
    createdAt: timestamp('createdAt').notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp('updatedAt')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`)
      .onUpdateNow(),
  },
  (table) => ({
    // matter-scoped reads (owner + matter), and portfolio reads (owner + status).
    idxMatterDeliverableMatter: index('idx_matter_deliverable_matter').on(
      table.userId,
      table.matterId,
      table.status,
    ),
    idxMatterDeliverableOwnerStatus: index('idx_matter_deliverable_owner_status').on(
      table.userId,
      table.status,
    ),
  }),
);
export type MatterDeliverable = typeof matterDeliverable.$inferSelect;
export type NewMatterDeliverable = typeof matterDeliverable.$inferInsert;

// ============================================================
// FOLD-PM-2 — material_extraction (document-type structured extraction)
// ============================================================
// One latest structured extraction per material (commitment/deed/survey/settlement),
// produced by the PURE no-egress document-type parsers over the material's already-
// extracted text. Owner+matter scoped; additive; NO DB FK (app-layer ownerScope).
// Behind DOCUMENT_EXTRACTION_ENABLED (default OFF). The document-type enum is the
// single source from src/shared/schemas/documentExtraction.ts.
export const materialExtraction = mysqlTable(
  'material_extraction',
  {
    id: char('id', { length: 36 }).primaryKey(),
    userId: char('userId', { length: 36 }).notNull(),
    matterId: char('matterId', { length: 36 }).notNull(),
    materialId: char('materialId', { length: 36 }).notNull(),
    documentType: mysqlEnum('documentType', DOCUMENT_TYPE_VALUES).notNull(),
    typeConfidence: int('typeConfidence').notNull().default(0),
    overallConfidence: int('overallConfidence').notNull().default(0),
    lowConfidence: boolean('lowConfidence').notNull().default(true),
    fields: json('fields').notNull(), // ExtractedField[] (labels + values + confidence)
    warnings: json('warnings').notNull(), // string[]
    createdAt: timestamp('createdAt').notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp('updatedAt')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`)
      .onUpdateNow(),
  },
  (table) => ({
    // one extraction per material; owner-scoped lookups by material and by matter.
    uxMaterialExtractionMaterial: uniqueIndex('ux_material_extraction_material').on(table.materialId),
    idxMaterialExtractionMatter: index('idx_material_extraction_matter').on(table.userId, table.matterId),
  }),
);
export type MaterialExtraction = typeof materialExtraction.$inferSelect;
export type NewMaterialExtraction = typeof materialExtraction.$inferInsert;

// ============================================================
// KB-PROVENANCE-1 — authority_source (firm/jurisdiction legal-authority registry)
// ============================================================
// A DURABLE firm/jurisdiction-level legal-authority (citation) registry — generalizes the
// embedded practice_memos.lawReliedOn structure into a first-class row. Owner/firm-level
// (userId, NO matterId) so it SURVIVES matter closure and is NOT matter-purged (unlike the
// matter-scoped source_authority artifact-tier table — do NOT conflate the two). Additive;
// NO DB FK (app-layer ownerScope). authorityType enum is the single source from
// src/shared/schemas/authoritySource.ts. supersedes/superseded-by DEFERRED per Constitution §8;
// the §2 pinned-citation+signature gate is enforced at the app-layer promotion boundary.
export const authoritySource = mysqlTable(
  'authority_source',
  {
    id: char('id', { length: 36 }).primaryKey(),
    userId: char('userId', { length: 36 }).notNull(),
    jurisdiction: varchar('jurisdiction', { length: 128 }).notNull(),
    authorityType: mysqlEnum('authorityType', AUTHORITY_TYPE_VALUES).notNull(),
    citationText: varchar('citationText', { length: 512 }).notNull(),
    pinpoint: varchar('pinpoint', { length: 256 }),
    sourceUrlOrLocation: text('sourceUrlOrLocation'),
    sourceSnapshotHash: varchar('sourceSnapshotHash', { length: 128 }),
    effectiveDate: date('effectiveDate', { mode: 'string' }),
    lastCheckedDate: date('lastCheckedDate', { mode: 'string' }),
    reviewByDate: date('reviewByDate', { mode: 'string' }),
    checkedBy: varchar('checkedBy', { length: 128 }),
    notes: text('notes'),
    createdAt: timestamp('createdAt').notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp('updatedAt')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`)
      .onUpdateNow(),
  },
  (table) => ({
    idxAuthoritySourceOwner: index('idx_authority_source_owner').on(table.userId, table.jurisdiction),
    idxAuthoritySourceReview: index('idx_authority_source_review').on(table.userId, table.reviewByDate),
  }),
);
export type AuthoritySource = typeof authoritySource.$inferSelect;
export type NewAuthoritySource = typeof authoritySource.$inferInsert;

// ============================================================
// FOLD-PM-3 — party / entity / contact data model (within-matter; owner-scoped)
// ============================================================
// An ADDITIVE, owner+matter-scoped entity/contact model that underpins conflicts +
// persistent reference and unblocks FOLD-DEED-1. It does NOT alter or replace
// matter_parties (the thin conflicts party, FOLD-L0-1): a matter_entity is a richer
// record that may OPTIONALLY reference a matter_parties row WITHIN THE SAME MATTER via
// `partyRef` (nullable; a same-matter soft link, NOT a DB FK). matter_entity_contact
// rows hang off a matter_entity (one entity, many contact points). No DB FK by
// convention — owner + matter isolation is enforced in the app layer (ownerScope).
// Behind PARTY_MODEL_ENABLED (default OFF).
//
// SCOPE FENCE: WITHIN-MATTER only. externalIdentityKey is a stable owner-scoped opaque
// grouping string DEFINED so a FUTURE cross-matter identity resolver CAN group entities
// later — NO cross-matter read/match/join is written in FOLD-PM-3. The enums are the
// single source from src/shared/schemas/partyModel.ts.

export const matterEntity = mysqlTable(
  'matter_entity',
  {
    id: char('id', { length: 36 }).primaryKey(),
    userId: char('userId', { length: 36 }).notNull(),
    matterId: char('matterId', { length: 36 }).notNull(),
    entityKind: mysqlEnum('entityKind', MATTER_ENTITY_KIND_VALUES).notNull().default('unknown'),
    displayName: varchar('displayName', { length: 256 }).notNull(),
    // normalizedName: lower/trim/collapse-ws/strip-punct — the WITHIN-MATTER lookup key
    // (same normalizeName() the conflicts engine uses).
    normalizedName: varchar('normalizedName', { length: 256 }).notNull(),
    legalName: varchar('legalName', { length: 256 }),
    // partyRef: OPTIONAL same-matter soft link to matter_parties.id. Nullable; NOT a DB
    // FK; NEVER cross-matter.
    partyRef: char('partyRef', { length: 36 }),
    // externalIdentityKey: forward-safe (nullable) hook for a FUTURE cross-matter identity
    // resolver to group on. DEFINED, never matched/joined in FOLD-PM-3.
    externalIdentityKey: varchar('externalIdentityKey', { length: 128 }),
    notes: text('notes'),
    deletedAt: timestamp('deletedAt'),
    createdAt: timestamp('createdAt').notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp('updatedAt')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`)
      .onUpdateNow(),
  },
  (table) => ({
    // The within-matter entity list read (owner + matter). Leading userId keeps it owner-scoped.
    idxMatterEntityMatter: index('idx_matter_entity_matter').on(table.userId, table.matterId),
    // Within-matter name lookup (owner + matter + normalized name).
    idxMatterEntityNorm: index('idx_matter_entity_norm').on(
      table.userId,
      table.matterId,
      table.normalizedName,
    ),
  }),
);
export type MatterEntity = typeof matterEntity.$inferSelect;
export type NewMatterEntity = typeof matterEntity.$inferInsert;

export const matterEntityContact = mysqlTable(
  'matter_entity_contact',
  {
    id: char('id', { length: 36 }).primaryKey(),
    userId: char('userId', { length: 36 }).notNull(),
    matterId: char('matterId', { length: 36 }).notNull(),
    // entityId binds a contact point to its matter_entity (same owner + same matter).
    entityId: char('entityId', { length: 36 }).notNull(),
    contactType: mysqlEnum('contactType', MATTER_ENTITY_CONTACT_TYPE_VALUES).notNull(),
    label: varchar('label', { length: 128 }),
    value: varchar('value', { length: 1024 }).notNull(),
    isPrimary: boolean('isPrimary').notNull().default(false),
    deletedAt: timestamp('deletedAt'),
    createdAt: timestamp('createdAt').notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp('updatedAt')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`)
      .onUpdateNow(),
  },
  (table) => ({
    // Contacts for one entity (owner + entity). Leading userId keeps it owner-scoped.
    idxMatterEntityContactEntity: index('idx_matter_entity_contact_entity').on(
      table.userId,
      table.entityId,
    ),
    // Owner + matter sweep (all contacts in a matter).
    idxMatterEntityContactMatter: index('idx_matter_entity_contact_matter').on(
      table.userId,
      table.matterId,
    ),
  }),
);
export type MatterEntityContact = typeof matterEntityContact.$inferSelect;
export type NewMatterEntityContact = typeof matterEntityContact.$inferInsert;

// ============================================================
// FOLD-NOTIFY-1 — in-app notification core (store + read + display; owner-scoped)
// ============================================================
// An ADDITIVE, OWNER-scoped in-app notification record. One row is one informational
// notice for ONE attorney, OPTIONALLY about one matter (matterId is nullable — a matter-
// less owner-level notice is valid). readAt is the per-user "seen" marker (null = unread).
// INFORMATIONAL ONLY: nothing here auto-adopts, auto-sends, or decides. No DB FK by
// convention — owner isolation is enforced in the app layer (ownerScope). Behind
// NOTIFICATIONS_ENABLED (default OFF). The type enum is the single source from
// src/shared/schemas/notifications.ts.
//
// SCOPE FENCE (FOLD-NOTIFY-1): this is the STORE + READ + DISPLAY tier ONLY. The OUTBOX-
// EMIT WIRING (producers that create notifications) and the hold/ack types are DEFERRED to
// after EGRESS Inc 3b — no producer is wired now, so the table may sit empty until then.
//
// PURGE: matterId-bearing rows purge WITH the matter (matterPurge.ts cascade); a matter-
// less (NULL matterId) owner-level notice is retained by byMatter (never matches NULL).

export const notifications = mysqlTable(
  'notifications',
  {
    id: char('id', { length: 36 }).primaryKey(),
    userId: char('userId', { length: 36 }).notNull(),
    // matterId: OPTIONAL — a matter-scoped notice (drives the per-matter "ready" badge) or
    // a matter-less owner-level notice. Nullable; NOT a DB FK; NEVER cross-owner.
    matterId: char('matterId', { length: 36 }),
    type: mysqlEnum('type', NOTIFICATION_TYPE_VALUES).notNull().default('generic'),
    title: varchar('title', { length: 256 }).notNull(),
    body: text('body'),
    // readAt: the per-user "seen" marker. null = unread; a timestamp = seen by the owner.
    readAt: timestamp('readAt'),
    createdAt: timestamp('createdAt').notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp('updatedAt')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`)
      .onUpdateNow(),
  },
  (table) => ({
    // The owner notification feed (newest-first list + unread count). Leading userId keeps
    // it owner-scoped; createdAt orders the feed.
    idxNotificationsOwner: index('idx_notifications_owner').on(table.userId, table.createdAt),
    // Per-matter "ready" badge lookup (owner + matter). Leading userId keeps it owner-scoped.
    idxNotificationsMatter: index('idx_notifications_matter').on(table.userId, table.matterId),
  }),
);
export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;

// ============================================================
// EXPRESS-AUTO-REVIEW-LOOP-1 (E4b + E7b) — durable decision-ledger + attorney-approval attestation
// ============================================================
// ULTRABUILD-1 W1. Replaces the IN-MEMORY-ONLY E4a decision ledger (decisionLedger.ts) and E7a structural
// approval predicate (approvalGate.ts) with DURABLE tables, so the supervision story for an Express
// auto-review run — what auto-adopted/escalated, and the attorney's complete per-escalation sign-off — is
// reconstructable after the fact (Fable audit Top-5 #2; E4b/E7b are blocking preconditions to Express
// activation). DORMANT: nothing reads/writes these unless EXPRESS_DURABLE_RECORDS_ENABLED is ON (default OFF)
// AND the Express loop is enabled (AUTO_REVIEW_LOOP_ENABLED default OFF). Additive migration 0051, operator-
// applied out-of-band (NOT on the auto-apply allowlist).
//
// FORK-C CONSISTENCY (FOLD-L1-1): audit_events is the SINGLE source of truth for ATTORNEY DECISIONS and
// disposition history is a read-projection over it. Every attorney adopt/reject on an escalation and the
// approval attestation act are ALSO written to audit_events (eventType='disposition',
// targetType='express_escalation'/'express_loop_run', action='adopt'/'reject'/'approve') — these tables do
// NOT introduce a competing authoritative decision record. express_approval_attestation holds current
// attestation STATE + a pointer (approvalEventId) to the deciding audit_events row; per-escalation decision
// HISTORY projects from audit_events (queries/expressDurableRecords.ts).
//
// NO isFinal/sendable column anywhere — the ABSENCE of a finality field IS the structural inertness E7a
// guarantees (approvalGate.ts §E7): an Express candidate is never final/recordable.
export const EXPRESS_LEDGER_ROUTE_VALUES = ['auto_adopt', 'escalate'] as const;
export type ExpressLedgerRoute = (typeof EXPRESS_LEDGER_ROUTE_VALUES)[number];

export const EXPRESS_RISK_BUCKET_VALUES = ['high', 'medium', 'low'] as const;
export type ExpressRiskBucket = (typeof EXPRESS_RISK_BUCKET_VALUES)[number];

// express_loop_run — APPEND-ONLY snapshot of one completed bounded loop run (the E4b container). One per run.
export const expressLoopRun = mysqlTable(
  'express_loop_run',
  {
    id: char('id', { length: 36 }).primaryKey(),
    userId: char('userId', { length: 36 }).notNull(),
    matterId: char('matterId', { length: 36 }).notNull(),
    documentId: char('documentId', { length: 36 }).notNull(),
    documentVersionId: char('documentVersionId', { length: 36 }).notNull(),
    // The reviewer model string the loop dispatched with (provenance; A-6 model-drift audit).
    reviewerModel: varchar('reviewerModel', { length: 128 }).notNull(),
    rounds: int('rounds').notNull(),
    converged: boolean('converged').notNull(),
    hitCap: boolean('hitCap').notNull(),
    adoptedCount: int('adoptedCount').notNull(),
    escalationCount: int('escalationCount').notNull(),
    // The NON-FINAL candidate the run produced (audit; never sendable/recordable).
    candidateText: mediumtext('candidateText').notNull(),
    redline: json('redline').notNull(), // the cumulative v1->candidate redline (E4a buildRedline output)
    roundSummaries: json('roundSummaries').notNull(), // per-round summaries (round-cap + convergence audit)
    createdAt: timestamp('createdAt').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    idxExpressLoopRunUserMatter: index('idx_express_loop_run_user_matter').on(table.userId, table.matterId),
    idxExpressLoopRunDocument: index('idx_express_loop_run_document').on(table.documentId, table.createdAt),
  }),
);

// express_ledger_entry — one row per E4a LedgerEntry. MUTABLE: `reverted` flips when an attorney unwinds an
// auto-adoption; the unwind DECISION is an audit_events row (revertedByEventId points to it — Fork C).
export const expressLedgerEntry = mysqlTable(
  'express_ledger_entry',
  {
    id: char('id', { length: 36 }).primaryKey(),
    runId: char('runId', { length: 36 }).notNull(),
    userId: char('userId', { length: 36 }).notNull(),
    matterId: char('matterId', { length: 36 }).notNull(),
    documentId: char('documentId', { length: 36 }).notNull(),
    // The deterministic in-run id ('e<round>-<seq>') — unique WITHIN a run only (id above is the global PK).
    ledgerEntryId: varchar('ledgerEntryId', { length: 32 }).notNull(),
    round: int('round').notNull(),
    route: mysqlEnum('route', EXPRESS_LEDGER_ROUTE_VALUES).notNull(),
    riskScore: int('riskScore').notNull(),
    riskBucket: mysqlEnum('riskBucket', EXPRESS_RISK_BUCKET_VALUES).notNull(),
    immutabilityForced: boolean('immutabilityForced').notNull(),
    isDeletion: boolean('isDeletion').notNull(),
    beforeText: mediumtext('beforeText').notNull(),
    afterText: mediumtext('afterText').notNull(),
    offsetStart: int('offsetStart').notNull(),
    offsetEnd: int('offsetEnd').notNull(),
    // Nested E1/E2/E3 verdicts JSON-encoded to stay migration-free (LocusResult, ClassAResult|null,
    // InlineEscalationEvent|null).
    locus: json('locus').notNull(),
    classA: json('classA'),
    inlineEvent: json('inlineEvent'),
    reverted: boolean('reverted').notNull().default(false),
    // Pointer to the audit_events row recording the attorney's unwind decision (Fork C: the DECISION lives in
    // audit_events; this row holds current STATE). Null until an unwind is recorded.
    revertedByEventId: char('revertedByEventId', { length: 36 }),
    createdAt: timestamp('createdAt').notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp('updatedAt').notNull().default(sql`CURRENT_TIMESTAMP`).onUpdateNow(),
  },
  (table) => ({
    idxExpressLedgerEntryRun: index('idx_express_ledger_entry_run').on(table.runId),
    idxExpressLedgerEntryUserMatter: index('idx_express_ledger_entry_user_matter').on(
      table.userId,
      table.matterId,
    ),
    uniqExpressLedgerEntry: uniqueIndex('uniq_express_ledger_entry').on(table.runId, table.ledgerEntryId),
  }),
);

// express_approval_attestation — APPEND-ONLY durable E7b attestation (the E7a predicate's deferred durable
// form). One row per COMPLETE attorney sign-off act; content-hash-bound + supersede-on-change (mirrors
// gate_override / sendability_override). attestedAt == createdAt. attorneyUserId = WHO; decisionsSnapshot =
// WHICH (the full per-escalation adopt/reject map at attestation time); approvalEventId points to the
// audit_events approval row = the Fork-C decision act.
export const expressApprovalAttestation = mysqlTable(
  'express_approval_attestation',
  {
    id: char('id', { length: 36 }).primaryKey(),
    runId: char('runId', { length: 36 }).notNull(),
    userId: char('userId', { length: 36 }).notNull(),
    matterId: char('matterId', { length: 36 }).notNull(),
    documentId: char('documentId', { length: 36 }).notNull(),
    documentVersionId: char('documentVersionId', { length: 36 }).notNull(),
    // WHO affirmatively signed off (the attorney). Explicit for the record even in single-attorney mode.
    attorneyUserId: char('attorneyUserId', { length: 36 }).notNull(),
    // The outcome of recordAttorneyApproval — TRUE only when EVERY escalation carried an explicit decision.
    approved: boolean('approved').notNull(),
    // WHICH: the complete per-escalation adopt/reject map + escalation-id list, snapshotted at attestation.
    decisionsSnapshot: json('decisionsSnapshot').notNull(),
    escalationCount: int('escalationCount').notNull(),
    // Binds the attestation to the run+candidate+decisions STATE; a material change re-arms it (stored hash !=
    // recomputed hash), the same supersede-on-change pattern as sendability_override.contentHash.
    contentHash: varchar('contentHash', { length: 128 }).notNull(),
    // Pointer to the audit_events row recording the approval decision act (Fork C source of truth).
    approvalEventId: char('approvalEventId', { length: 36 }).notNull(),
    createdAt: timestamp('createdAt').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    idxExpressAttestationRun: index('idx_express_attestation_run').on(table.runId),
    idxExpressAttestationUserMatter: index('idx_express_attestation_user_matter').on(
      table.userId,
      table.matterId,
    ),
    idxExpressAttestationVersion: index('idx_express_attestation_version').on(table.documentVersionId),
  }),
);

export type ExpressLoopRun = typeof expressLoopRun.$inferSelect;
export type NewExpressLoopRun = typeof expressLoopRun.$inferInsert;
export type ExpressLedgerEntry = typeof expressLedgerEntry.$inferSelect;
export type NewExpressLedgerEntry = typeof expressLedgerEntry.$inferInsert;
export type ExpressApprovalAttestation = typeof expressApprovalAttestation.$inferSelect;
export type NewExpressApprovalAttestation = typeof expressApprovalAttestation.$inferInsert;
