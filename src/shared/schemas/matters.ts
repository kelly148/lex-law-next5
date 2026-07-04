/**
 * Shared Zod schemas for matters, documents, versions, materials,
 * document_references, and user_preferences (Phase 3 / Ch 4.3–4.15).
 *
 * These schemas are the Zod Wall (Ch 35.1) for Phase 3 tables.
 * All DB reads of these tables MUST pass through these schemas.
 */

import { z } from 'zod';

// ============================================================
// Ch 4.3 — Matter schemas
// ============================================================

export const MATTER_PHASE_VALUES = ['intake', 'drafting', 'complete'] as const;

export const MatterPhaseSchema = z.enum(MATTER_PHASE_VALUES);

// FOLD-L0-1 (Fork D): orthogonal Layer-0 analysis status. ADDITIVE — `.optional()` so
// pre-L0 fixtures/rows without the column still parse; DB rows (post-migration 0007)
// always carry it (NOT NULL default 'none'). Code treats absent as 'none'.
export const MATTER_ANALYSIS_STATUS_VALUES = ['none', 'in_analysis', 'plan_locked'] as const;
export const MatterAnalysisStatusSchema = z.enum(MATTER_ANALYSIS_STATUS_VALUES);

// INSTR-2B-title: the firm CAPACITY this matter is handled in — 'law_firm' representation
// (default-safe) vs 'title_settlement_agent' (non-representational settlement-agent / title-
// decision-maker). The Title master (master/claude/title) is selected ONLY on an affirmative
// 'title_settlement_agent' election (matter.create / matter.setEngagementCapacity); absent or
// law_firm => the INSTR-2B-core safe default (lawfirm/te). ADDITIVE — duplicated in
// src/server/db/schema.ts (kept in sync, like the other matter enums). Set only by an explicit
// attorney act; never inferred from paKey alone.
export const MATTER_ENGAGEMENT_CAPACITY_VALUES = ['law_firm', 'title_settlement_agent'] as const;
export const MatterEngagementCapacitySchema = z.enum(MATTER_ENGAGEMENT_CAPACITY_VALUES);
export type MatterEngagementCapacity = (typeof MATTER_ENGAGEMENT_CAPACITY_VALUES)[number];

// FOLD-ORCH-1 Inc2b (Fork C): per-matter reviewer-lane override. Same reviewer keys as the
// global ReviewerEnablement (claude/gpt/gemini/grok). Stored as a nullable JSON column on
// matters; a NULL row = NO per-matter override => the matter falls back to the global default.
// Explicit booleans (no silent per-key default on the override) — set only by an explicit
// attorney act (matter.setOrchestrationLanes); never silently inferred. The N-of-M orchestration
// convergence denominator is computed over the matter's toggled-on set (see resolveReviewerLanes).
export const MatterOrchestrationLanesSchema = z.object({
  claude: z.boolean(),
  gpt: z.boolean(),
  gemini: z.boolean(),
  grok: z.boolean(),
});
export type MatterOrchestrationLanes = z.infer<typeof MatterOrchestrationLanesSchema>;

export const MatterRowSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  title: z.string().min(1).max(256),
  clientName: z.string().max(256).nullable(),
  practiceArea: z.string().max(128).nullable(),
  // R2-PRE-JURIS-1: governing jurisdiction ('VA' | 'MD'). ADDITIVE: .nullable().optional() so
  // pre-migration reads / legacy fixtures parse; a post-migration row carries null|string.
  jurisdiction: z.string().max(16).nullable().optional(),
  // FOLD-KB-1 (Fork E) attorney-confirmed PA key. ADDITIVE: .nullable().optional() so
  // pre-migration reads / legacy fixtures parse and a post-migration row carries null|string.
  paKey: z.string().max(64).nullable().optional(),
  // FOLD-ORCH-1 Inc2b (Fork C) per-matter reviewer-lane override. ADDITIVE: .nullable().optional()
  // so pre-migration reads / legacy fixtures parse; NULL = no override (use the global default).
  orchestrationLanes: MatterOrchestrationLanesSchema.nullable().optional(),
  phase: MatterPhaseSchema,
  analysisStatus: MatterAnalysisStatusSchema.optional(),
  // INSTR-2B-title engagement capacity. ADDITIVE: .optional() so pre-migration reads / legacy
  // fixtures parse; a post-migration row (NOT NULL default 'law_firm') always carries it.
  engagementCapacity: MatterEngagementCapacitySchema.optional(),
  // CAPACITY-ELECTION-UX (R1) affirmative-election marker. ADDITIVE: .nullable().optional() so a
  // pre-migration read / legacy fixture (column absent) parses; a post-migration row carries a Date
  // (an election happened) or null (unelected). NULL = never affirmatively elected (the safe state).
  engagementCapacityElectedAt: z.date().nullable().optional(),
  archivedAt: z.date().nullable(),
  completedAt: z.date().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type MatterRow = z.infer<typeof MatterRowSchema>;

export const PublicMatterSchema = MatterRowSchema;
export type PublicMatter = MatterRow;

// ============================================================
// Ch 4.4 — Document schemas
// ============================================================

export const DOCUMENT_WORKFLOW_STATE_VALUES = [
  'drafting',
  'substantively_accepted',
  'finalizing',
  'complete',
  'archived',
] as const;

export const DOCUMENT_DRAFTING_MODE_VALUES = ['template', 'iterative'] as const;

export const TEMPLATE_BINDING_STATUS_VALUES = ['bound', 'detached'] as const;

export const DocumentWorkflowStateSchema = z.enum(
  DOCUMENT_WORKFLOW_STATE_VALUES,
);
export const DocumentDraftingModeSchema = z.enum(DOCUMENT_DRAFTING_MODE_VALUES);
export const TemplateBindingStatusSchema = z.enum(
  TEMPLATE_BINDING_STATUS_VALUES,
);

// templateSnapshot: variable values at detach time (Ch 6.4)
export const TemplateSnapshotSchema = z
  .record(z.string(), z.unknown())
  .nullable();

// variableMap: current attorney edits for template-mode docs
export const VariableMapSchema = z.record(z.string(), z.unknown()).nullable();

export const DocumentRowSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  matterId: z.string().uuid(),
  title: z.string().min(1).max(256),
  documentType: z.string().min(1).max(64),
  customTypeLabel: z.string().max(256).nullable(),
  draftingMode: DocumentDraftingModeSchema,
  templateBindingStatus: TemplateBindingStatusSchema,
  templateVersionId: z.string().uuid().nullable(),
  templateSnapshot: TemplateSnapshotSchema,
  variableMap: VariableMapSchema,
  workflowState: DocumentWorkflowStateSchema,
  currentVersionId: z.string().uuid().nullable(),
  officialSubstantiveVersionNumber: z.number().int().positive().nullable(),
  officialFinalVersionNumber: z.number().int().positive().nullable(),
  completedAt: z.date().nullable(),
  archivedAt: z.date().nullable(),
  notes: z.string().nullable(),
  // FOLD-KB-1 (Fork A) durable KB provenance flag. ADDITIVE + back-compatible: .optional()
  // so a pre-migration read / legacy fixture (key absent) still parses; a post-migration row
  // carries a boolean. FOLD-SEND-1 reads this artifact-level flag.
  drewOnUnverifiedKb: z.boolean().optional(),
  // W3c deed provenance (agent_assembled | llm_authored). ADDITIVE + back-compat: .nullable().optional()
  // so a pre-migration read / legacy fixture (key absent) parses and a NULL column value parses.
  provenance: z.enum(['agent_assembled', 'llm_authored']).nullable().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type DocumentRow = z.infer<typeof DocumentRowSchema>;
export type PublicDocument = DocumentRow;

// ============================================================
// Ch 4.5 — Version schemas
// ============================================================

export const VersionRowSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  documentId: z.string().uuid(),
  versionNumber: z.number().int().positive(),
  content: z.string(),
  generatedByJobId: z.string().uuid().nullable(),
  iterationNumber: z.number().int().positive(),
  createdAt: z.date(),
});

export type VersionRow = z.infer<typeof VersionRowSchema>;
export type PublicVersion = VersionRow;

// ============================================================
// Ch 4.9 — MatterMaterial schemas
// ============================================================

export const EXTRACTION_STATUS_VALUES = [
  'extracted',
  'partial',
  'failed',
  'not_supported',
  // MATERIALS-DROPZONE-1 Inc B — async OCR states (kept in lockstep with the server enum
  // in src/server/db/schema.ts and migration 0024). 'processing' = OCR in flight;
  // 'low_confidence' = OCR below the floor (shown to the user, excluded from the assessment).
  'processing',
  'low_confidence',
] as const;

export const UPLOAD_SOURCE_VALUES = ['upload', 'paste'] as const;

export const ExtractionStatusSchema = z.enum(EXTRACTION_STATUS_VALUES);
export const UploadSourceSchema = z.enum(UPLOAD_SOURCE_VALUES);

// tags: JSON array of strings (Ch 4.9)
export const MaterialTagsSchema = z.array(z.string());

export const MatterMaterialRowSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  matterId: z.string().uuid(),
  filename: z.string().max(512).nullable(),
  mimeType: z.string().max(128).nullable(),
  fileSize: z.number().int().nonnegative().nullable(),
  storageKey: z.string().max(512).nullable(),
  textContent: z.string().nullable(),
  extractionStatus: ExtractionStatusSchema,
  extractionError: z.string().nullable(),
  tags: MaterialTagsSchema,
  description: z.string().nullable(),
  pinned: z.boolean(),
  uploadSource: UploadSourceSchema,
  deletedAt: z.date().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type MatterMaterialRow = z.infer<typeof MatterMaterialRowSchema>;
export type PublicMatterMaterial = MatterMaterialRow;

// ============================================================
// Ch 4.13 — DocumentReference schemas
// ============================================================

export const DocumentReferenceRowSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  sourceDocumentId: z.string().uuid(),
  referencedDocumentId: z.string().uuid(),
  referencedVersionId: z.string().uuid(),
  stalenessAcknowledgedAt: z.date().nullable(),
  createdAt: z.date(),
});

export type DocumentReferenceRow = z.infer<typeof DocumentReferenceRowSchema>;
export type PublicDocumentReference = DocumentReferenceRow;

// ============================================================
// Ch 4.15 — UserPreferences schemas
// ============================================================

// Reviewer enablement (decision #43): claude/gpt/gemini default true, grok default false
export const ReviewerEnablementSchema = z.object({
  claude: z.boolean().default(true),
  gpt: z.boolean().default(true),
  gemini: z.boolean().default(true),
  grok: z.boolean().default(false),
});

export type ReviewerEnablement = z.infer<typeof ReviewerEnablementSchema>;

export const VoiceInputPreferencesSchema = z.object({
  forceShowAll: z.boolean().default(false),
  forceHideAll: z.boolean().default(false),
  dictationLanguage: z.string().default('en-US'),
});

// NOTIFY-SUITE-1 N3 — notification preferences (default-safe: in-app + the digest + failures + deadlines ON;
// tab-title + OS OFF; nothing muted). NOTIFY-SOUND-1: `sound` defaults ON so the gavel cue works the moment
// NOTIFY_SOUND_ENABLED is flipped on (the toggle is the user's off-switch); it is INERT until that flag is
// on, so the default flip is invisible on prod. Forward-looking: tabTitle/os are channels not yet built;
// the per-event toggles map to the producer surfaces (only N2 'deadline' is live today). Every field has a
// default so an existing prefs blob (pre-N3) parses with the safe defaults (additive — no migration).
export const NotificationEventPrefsSchema = z.object({
  reviewComplete: z.boolean().default(true),
  reviewFailed: z.boolean().default(true),
  regeneration: z.boolean().default(true),
  extraction: z.boolean().default(true),
  sendability: z.boolean().default(true),
  deadline: z.boolean().default(true),
});
export type NotificationEventPrefs = z.infer<typeof NotificationEventPrefsSchema>;

export const NotificationPreferencesSchema = z.object({
  inApp: z.boolean().default(true), // the built channel (bell)
  tabTitle: z.boolean().default(false), // forward-looking channel
  os: z.boolean().default(false), // forward-looking channel (off by default — privacy)
  sound: z.boolean().default(true), // NOTIFY-SOUND-1 gavel cue — default ON; gated by NOTIFY_SOUND_ENABLED (default OFF), so inert until the flag flips
  digest: z.boolean().default(true), // the N1 "while you were away" digest
  events: NotificationEventPrefsSchema.default({}),
  // per-matter mute — bounded for hygiene (a runaway list is data-rot; 500 muted matters far exceeds any
  // real attorney's load). The producer only ever matches these against the owner's OWN deadlines, so a
  // stale/foreign id is inert; the bound just caps unbounded growth.
  mutedMatterIds: z.array(z.string().uuid()).max(500).default([]),
});
export type NotificationPreferences = z.infer<typeof NotificationPreferencesSchema>;

// The full preferences JSON blob (Ch 4.15)
export const UserPreferencesDataSchema = z.object({
  voiceInput: VoiceInputPreferencesSchema.default({}),
  reviewerEnablement: ReviewerEnablementSchema.default({}),
  notificationPreferences: NotificationPreferencesSchema.default({}),
});

export type UserPreferencesData = z.infer<typeof UserPreferencesDataSchema>;

export const UserPreferencesRowSchema = z.object({
  userId: z.string().uuid(),
  preferences: UserPreferencesDataSchema,
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type UserPreferencesRow = z.infer<typeof UserPreferencesRowSchema>;

// Default preferences for new users (Ch 4.15)
export const DEFAULT_USER_PREFERENCES: UserPreferencesData = {
  voiceInput: {
    forceShowAll: false,
    forceHideAll: false,
    dictationLanguage: 'en-US',
  },
  reviewerEnablement: {
    claude: true,
    gpt: true,
    gemini: true,
    grok: false,
  },
  notificationPreferences: {
    inApp: true,
    tabTitle: false,
    os: false,
    sound: true,
    digest: true,
    events: { reviewComplete: true, reviewFailed: true, regeneration: true, extraction: true, sendability: true, deadline: true },
    mutedMatterIds: [],
  },
};

// UserSettings type exposed to procedures (Ch 21.12)
export const UserSettingsSchema = z.object({
  reviewerEnablement: ReviewerEnablementSchema,
  voiceInput: VoiceInputPreferencesSchema,
});

export type UserSettings = z.infer<typeof UserSettingsSchema>;
