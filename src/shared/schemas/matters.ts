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

export const MatterRowSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  title: z.string().min(1).max(256),
  clientName: z.string().max(256).nullable(),
  practiceArea: z.string().max(128).nullable(),
  phase: MatterPhaseSchema,
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

// The full preferences JSON blob (Ch 4.15)
export const UserPreferencesDataSchema = z.object({
  voiceInput: VoiceInputPreferencesSchema.default({}),
  reviewerEnablement: ReviewerEnablementSchema.default({}),
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
};

// UserSettings type exposed to procedures (Ch 21.12)
export const UserSettingsSchema = z.object({
  reviewerEnablement: ReviewerEnablementSchema,
  voiceInput: VoiceInputPreferencesSchema,
});

export type UserSettings = z.infer<typeof UserSettingsSchema>;
