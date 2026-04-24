/**
 * Telemetry Event Catalog — Lex Law Next v1
 *
 * This file is the authoritative TypeScript representation of the telemetry catalog
 * defined in Chapter 25 and Appendix E of the specification.
 *
 * R14 — No Duplicate Primitives: This is the single authoritative module for
 * telemetry event names. No other file may define a local TelemetryEventName type.
 *
 * R1 — Spec Is Absolute: Event names are verbatim from the spec. Do not normalize,
 * shorten, or rename. A new event requires a spec revision before code may emit it.
 *
 * The emitter (server/telemetry/emitTelemetry.ts) uses this union for compile-time
 * validation. A non-catalog string passed to emitTelemetry() is a TypeScript error.
 */

// ============================================================
// E.1 / Ch 25.2 — Matter lifecycle events
// ============================================================
type MatterLifecycleEvent =
  | 'matter_created'
  | 'matter_metadata_updated'
  | 'matter_phase_advanced'
  | 'matter_archived'
  | 'matter_unarchived';

// ============================================================
// E.2 / Ch 25.3 — Document lifecycle events
// ============================================================
type DocumentLifecycleEvent =
  | 'document_created'
  | 'document_metadata_updated'
  | 'document_state_transitioned'
  | 'document_detached_from_template'
  | 'document_archived'
  | 'document_unarchived'
  | 'document_exported'
  | 'heading_fallback_applied'
  | 'substantive_accepted'
  | 'substantive_reopened'
  | 'substantive_accepted_unformatted'
  | 'finalize_started'
  | 'unfinalized'
  | 'staleness_acknowledged';

// ============================================================
// E.3 / Ch 25.4 — Job lifecycle events
// ============================================================
type JobLifecycleEvent =
  | 'job_queued'
  | 'job_started'
  | 'job_completed'
  | 'job_failed'
  | 'job_timed_out'
  | 'job_cancelled';

// ============================================================
// E.4 / Ch 25.5 — Operation-level events
// ============================================================
type OperationLevelEvent =
  | 'generation_started'
  | 'generation_completed'
  | 'generation_reset'
  | 'review_requested'
  | 'extraction_started'
  | 'populate_from_matter_clicked'
  | 'template_rendered';

// ============================================================
// E.5 / Ch 25.6 — Review pane events
// ============================================================
type ReviewPaneEvent =
  | 'review_session_created'
  | 'review_selection_changed'
  | 'global_instructions_updated'
  | 'regeneration_started'
  | 'review_session_abandoned'
  | 'reviewer_enablement_changed';

// ============================================================
// E.6 / Ch 25.7 — Materials library events
// ============================================================
type MaterialsLibraryEvent =
  | 'material_uploaded'
  | 'material_pasted'
  | 'material_metadata_updated'
  | 'material_pinned'
  | 'material_unpinned'
  | 'material_deleted'
  | 'material_undeleted'
  | 'material_hard_deleted'
  | 'material_manually_supplemented'
  | 'materials_included_in_operation'
  | 'tier2_truncation_acknowledged';

// ============================================================
// E.7 / Ch 25.8 — Template events
// ============================================================
type TemplateEvent =
  | 'template_uploaded'
  | 'schema_updated'
  | 'schema_confirmed'
  | 'template_activated'
  | 'template_sandbox_render'
  | 'template_archived'
  | 'template_unarchived';

// ============================================================
// E.8 / Ch 25.8a — Matter-level artifact events (matrix, outline)
// ============================================================
type MatrixOutlineEvent =
  | 'matrix_generation_started'
  | 'matrix_item_added'
  | 'matrix_item_edited'
  | 'matrix_item_deleted'
  | 'matrix_exported'
  | 'matrix_answer_attached'
  | 'matrix_marked_complete'
  | 'matrix_archived'
  | 'outline_generation_started'
  | 'outline_regeneration_started'
  | 'outline_edited'
  | 'outline_approved'
  | 'outline_reopened'
  | 'outline_skipped';

// ============================================================
// E.9 / Ch 25.9 — Conflict and error events
// ============================================================
type ConflictErrorEvent =
  | 'mutation_conflict_detected'
  | 'prompt_version_changed'
  | 'procedure_error'
  | 'zod_parse_failed';

// ============================================================
// E.10 — Reference events
// ============================================================
type ReferenceEvent =
  | 'reference_added'
  | 'reference_removed';

// ============================================================
// TelemetryEventName — the complete union
// This is the compile-time gate for emitTelemetry().
// Any string not in this union is a TypeScript error at the call site.
// ============================================================
export type TelemetryEventName =
  | MatterLifecycleEvent
  | DocumentLifecycleEvent
  | JobLifecycleEvent
  | OperationLevelEvent
  | ReviewPaneEvent
  | MaterialsLibraryEvent
  | TemplateEvent
  | MatrixOutlineEvent
  | ConflictErrorEvent
  | ReferenceEvent;

// ============================================================
// Payload types per event (Appendix E full schemas)
// ============================================================

// Common envelope (Ch 25.1) — populated by emitTelemetry, not by callers
export interface TelemetryEnvelope {
  eventId: string;
  eventType: TelemetryEventName;
  userId: string;
  matterId: string | null;
  documentId: string | null;
  jobId: string | null;
  timestamp: string; // ISO-8601 with ms
}

// Payload map — keyed by event name for type-safe emitter signature
export interface TelemetryPayload {
  // E.1 Matter lifecycle
  matter_created: { title: string; clientName?: string; practiceArea?: string };
  matter_metadata_updated: { fields: Record<string, { old: unknown; new: unknown }> };
  matter_phase_advanced: {
    fromPhase: string;
    toPhase: string;
    trigger: 'first_document_created' | 'all_documents_complete' | 'any_document_unfinalized' | 'manual';
  };
  matter_archived: Record<string, never>;
  matter_unarchived: Record<string, never>;

  // E.2 Document lifecycle
  document_created: {
    matterId: string;
    documentType: string;
    customTypeLabel?: string;
    draftingMode: 'template' | 'iterative';
    templateVersionId?: string;
    title: string;
  };
  document_metadata_updated: { fields: Record<string, unknown> };
  document_state_transitioned: { fromState: string; toState: string; trigger: string };
  document_detached_from_template: { previousTemplateVersionId: string; snapshotVariableCount: number };
  document_archived: Record<string, never>;
  document_unarchived: Record<string, never>;
  document_exported: { versionId: string; watermarkState: string; expiresAt: string };
  heading_fallback_applied: { versionId: string; h4PlusCount: number };
  substantive_accepted: { versionId: string; versionNumber: number };
  substantive_reopened: Record<string, never>;
  substantive_accepted_unformatted: { versionId: string; versionNumber: number };
  finalize_started: { versionId: string };
  unfinalized: Record<string, never>;
  staleness_acknowledged: {
    staleReferenceIds: string[];
    finalizeContext: 'finalize' | 'acceptUnformatted';
  };

  // E.3 Job lifecycle
  job_queued: { jobType: string; promptVersion: string };
  job_started: { jobType: string; providerId: string; modelId: string; promptVersion: string };
  job_completed: { jobType: string; tokensPrompt: number; tokensCompletion: number; durationMs: number };
  job_failed: { jobType: string; errorClass: string; errorMessage: string };
  job_timed_out: { jobType: string; timeoutMs: number; elapsedMs: number };
  job_cancelled: { jobType: string; elapsedMs: number; cancelOrigin: 'attorney' };

  // E.4 Operation-level
  generation_started: {
    jobId: string;
    operation: 'initial_draft' | 'regeneration';
    contextTokens: number;
  };
  generation_completed: { jobId: string; operation: string; newVersionNumber: number };
  generation_reset: { jobId: string; operation: string; reason: 'timeout' | 'failure' | 'cancelled' };
  review_requested: { reviewerCount: number; reviewerModels: string[] };
  extraction_started: { templateVersionId: string; includedMaterialCount: number };
  populate_from_matter_clicked: { templateVersionId: string };
  template_rendered: { templateVersionId: string; versionNumber: number };

  // E.5 Review pane
  review_session_created: { iterationNumber: number; reviewerCount: number; selectedReviewers: string[] };
  review_selection_changed: {
    adoptedCount: number;
    totalSuggestions: number;
    added: string[];
    removed: string[];
  };
  global_instructions_updated: { instructionsLength: number };
  regeneration_started: {
    sessionId: string;
    consolidationMode: 'all_reviewers' | 'single_reviewer';
    adoptedCount: number;
  };
  review_session_abandoned: Record<string, never>;
  reviewer_enablement_changed: {
    reviewer: 'claude' | 'gpt' | 'gemini' | 'grok';
    enabled: boolean;
  };

  // E.6 Materials library
  material_uploaded: {
    filename: string;
    mimeType: string;
    fileSize: number;
    extractionStatus: string;
    uploadSource: string;
  };
  material_pasted: { title?: string; tags?: string[]; textContentLength: number };
  material_metadata_updated: { fields: Record<string, { old: unknown; new: unknown }> };
  material_pinned: Record<string, never>;
  material_unpinned: Record<string, never>;
  material_deleted: { wasPinned: boolean };
  material_undeleted: Record<string, never>;
  material_hard_deleted: { filename?: string; hadProvenance: false };
  material_manually_supplemented: { originalExtractionStatus: string };
  materials_included_in_operation: {
    operation: string;
    includedMaterialIds: string[];
    pinnedCount: number;
    tokensTotal: number;
    excludedMaterialIds: string[];
    truncatedMaterialIds: string[];
  };
  tier2_truncation_acknowledged: { operation: string; truncatedSiblingIds: string[] };

  // E.7 Template
  template_uploaded: {
    templateId: string;
    versionId: string;
    documentType: string;
    validationStatus: string;
  };
  schema_updated: { versionId: string; fieldCount: number };
  schema_confirmed: {
    templateId: string;
    versionId: string;
    fieldCount: number;
    warningCount: number;
    warningsAcknowledged: boolean;
  };
  template_activated: { templateId: string; versionId: string };
  template_sandbox_render: { templateId: string; versionId: string };
  template_archived: Record<string, never>;
  template_unarchived: Record<string, never>;

  // E.8 Matrix / outline
  matrix_generation_started: { matterId: string };
  matrix_item_added: { matrixId: string; category: string };
  matrix_item_edited: { matrixId: string; itemId: string; fields: Record<string, unknown> };
  matrix_item_deleted: { matrixId: string; itemId: string };
  matrix_exported: { matrixId: string; format: 'docx' | 'text' };
  matrix_answer_attached: {
    matrixId: string;
    itemId: string;
    statusTransition?: { from: string; to: string };
  };
  matrix_marked_complete: { matrixId: string; unansweredItemCount: number };
  matrix_archived: { matrixId: string };
  outline_generation_started: { documentId: string };
  outline_regeneration_started: { outlineId: string; priorStatus: string };
  outline_edited: { outlineId: string; sectionCount: number };
  outline_approved: { outlineId: string; sectionCount: number };
  outline_reopened: { outlineId: string };
  outline_skipped: { documentId: string };

  // E.9 Conflict and error
  mutation_conflict_detected: {
    procedureName: string;
    expectedState: string;
    actualState: string;
  };
  prompt_version_changed: { role: string; oldVersion: string; newVersion: string };
  procedure_error: { procedureName: string; errorCode: string; errorMessage: string };
  zod_parse_failed: {
    schemaName: string;
    tableName?: string;
    columnName?: string;
    errorPath: string;
    errorMessage: string;
  };

  // E.10 Reference events
  reference_added: {
    sourceDocumentId: string;
    referencedDocumentId: string;
    referencedVersionId: string;
  };
  reference_removed: { referenceId: string };
}
