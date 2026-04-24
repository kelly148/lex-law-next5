/**
 * Zod Wall Query Wrappers — templates, template_versions, template_variable_schemas
 * Ch 35.1, R6, Phase 4a
 *
 * ALL reads of JSON columns (validationErrors, schema) go through these wrappers.
 * No procedure or handler may query these tables directly.
 *
 * Zod Wall pattern (same as users.ts canonical reference):
 *   - Parse JSON columns on every read.
 *   - On parse failure: emit zod_parse_failed telemetry and throw TRPCError NOT_FOUND.
 *   - Never return raw unvalidated JSON to callers.
 */
import { eq, and, isNull, desc } from 'drizzle-orm';
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { db } from '../connection.js';
import {
  templates,
  templateVersions,
  templateVariableSchemas,
  type Template,
  type TemplateVersion,
  type TemplateVariableSchema,
  type NewTemplate,
  type NewTemplateVersion,
  type NewTemplateVariableSchema,
} from '../schema.js';
import { emitTelemetry } from '../../telemetry/emitTelemetry.js';

// ============================================================
// Zod schemas for JSON columns
// ============================================================

/**
 * ValidationError shape stored in template_versions.validationErrors
 */
const ValidationErrorItemSchema = z.object({
  type: z.enum(['unknown_helper', 'partial_disallowed', 'parse_error']),
  message: z.string(),
  helperName: z.string().optional(),
});

export const ValidationErrorsSchema = z.array(ValidationErrorItemSchema).nullable();
export type ParsedValidationErrors = z.infer<typeof ValidationErrorsSchema>;

/**
 * Variable schema field definition stored in template_variable_schemas.schema
 * Ch 13.4 — supported field types
 */
const VariableFieldSchema = z.object({
  name: z.string(),
  type: z.enum(['string', 'number', 'date', 'currency', 'boolean', 'array']),
  label: z.string().optional(),
  required: z.boolean().default(false),
  description: z.string().optional(),
  // For array type: the item type
  itemType: z.enum(['string', 'number', 'date', 'currency']).optional(),
});

export const VariableSchemaSchema = z.object({
  fields: z.array(VariableFieldSchema),
  // schemaVersion: for future migrations
  schemaVersion: z.number().default(1),
});
export type ParsedVariableSchema = z.infer<typeof VariableSchemaSchema>;

// ============================================================
// Parsed row types (JSON columns replaced with parsed versions)
// ============================================================

export type ParsedTemplateVersion = Omit<TemplateVersion, 'validationErrors'> & {
  validationErrors: ParsedValidationErrors;
};

export type ParsedTemplateVariableSchema = Omit<TemplateVariableSchema, 'schema'> & {
  schema: ParsedVariableSchema;
};

// ============================================================
// Zod Wall parse helpers
// ============================================================

function parseTemplateVersion(
  row: TemplateVersion,
  context: { userId: string },
): ParsedTemplateVersion {
  const result = ValidationErrorsSchema.safeParse(row.validationErrors);
  if (!result.success) {
    void emitTelemetry(
      'zod_parse_failed',
      {
        schemaName: 'ValidationErrorsSchema',
        tableName: 'template_versions',
        errorPath: result.error.errors[0]?.path.join('.') ?? '',
        errorMessage: result.error.errors[0]?.message ?? 'unknown',
      },
      { userId: context.userId, matterId: null, documentId: null, jobId: null },
    );
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Template version data is corrupt' });
  }
  return { ...row, validationErrors: result.data };
}

function parseTemplateVariableSchema(
  row: TemplateVariableSchema,
  context: { userId: string },
): ParsedTemplateVariableSchema {
  const result = VariableSchemaSchema.safeParse(row.schema);
  if (!result.success) {
    void emitTelemetry(
      'zod_parse_failed',
      {
        schemaName: 'VariableSchemaSchema',
        tableName: 'template_variable_schemas',
        errorPath: result.error.errors[0]?.path.join('.') ?? '',
        errorMessage: result.error.errors[0]?.message ?? 'unknown',
      },
      { userId: context.userId, matterId: null, documentId: null, jobId: null },
    );
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Template variable schema data is corrupt' });
  }
  return { ...row, schema: result.data };
}

// ============================================================
// Template queries
// ============================================================

export async function getTemplateById(
  templateId: string,
  userId: string,
): Promise<Template | null> {
  const rows = await db
    .select()
    .from(templates)
    .where(and(eq(templates.id, templateId), eq(templates.userId, userId)));
  return rows[0] ?? null;
}

export async function listTemplates(
  userId: string,
  opts: { documentType?: string; includeArchived?: boolean } = {},
): Promise<Template[]> {
  const conditions = [eq(templates.userId, userId)];
  if (!opts.includeArchived) {
    conditions.push(isNull(templates.archivedAt));
  }
  // Note: documentType filter applied in JS to avoid conditional drizzle complexity
  const rows = await db
    .select()
    .from(templates)
    .where(and(...conditions));
  if (opts.documentType) {
    return rows.filter((r) => r.documentType === opts.documentType);
  }
  return rows;
}

export async function insertTemplate(data: NewTemplate): Promise<Template> {
  await db.insert(templates).values(data);
  const row = await getTemplateById(data.id, data.userId);
  if (!row) throw new Error('Template insert failed');
  return row;
}

export async function updateTemplateActiveVersion(
  templateId: string,
  userId: string,
  activeVersionId: string | null,
): Promise<Template | null> {
  await db
    .update(templates)
    .set({ activeVersionId, updatedAt: new Date() })
    .where(and(eq(templates.id, templateId), eq(templates.userId, userId)));
  return getTemplateById(templateId, userId);
}

export async function archiveTemplate(
  templateId: string,
  userId: string,
): Promise<Template | null> {
  await db
    .update(templates)
    .set({ archivedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(templates.id, templateId), eq(templates.userId, userId)));
  return getTemplateById(templateId, userId);
}

export async function unarchiveTemplate(
  templateId: string,
  userId: string,
): Promise<Template | null> {
  await db
    .update(templates)
    .set({ archivedAt: null, updatedAt: new Date() })
    .where(and(eq(templates.id, templateId), eq(templates.userId, userId)));
  return getTemplateById(templateId, userId);
}

// ============================================================
// Template version queries (Zod Wall on validationErrors)
// ============================================================

export async function getTemplateVersionById(
  versionId: string,
  userId: string,
): Promise<ParsedTemplateVersion | null> {
  // Join with templates to enforce userId ownership
  const rows = await db
    .select({ tv: templateVersions })
    .from(templateVersions)
    .innerJoin(templates, eq(templateVersions.templateId, templates.id))
    .where(and(eq(templateVersions.id, versionId), eq(templates.userId, userId)));
  const row = rows[0]?.tv;
  if (!row) return null;
  return parseTemplateVersion(row, { userId });
}

export async function listTemplateVersions(
  templateId: string,
  userId: string,
): Promise<ParsedTemplateVersion[]> {
  // Verify ownership
  const template = await getTemplateById(templateId, userId);
  if (!template) return [];

  const rows = await db
    .select()
    .from(templateVersions)
    .where(eq(templateVersions.templateId, templateId))
    .orderBy(desc(templateVersions.versionNumber));

  return rows.map((r) => parseTemplateVersion(r, { userId }));
}

export async function getNextVersionNumber(templateId: string): Promise<number> {
  const rows = await db
    .select({ versionNumber: templateVersions.versionNumber })
    .from(templateVersions)
    .where(eq(templateVersions.templateId, templateId))
    .orderBy(desc(templateVersions.versionNumber))
    .limit(1);
  return (rows[0]?.versionNumber ?? 0) + 1;
}

export async function insertTemplateVersion(
  data: NewTemplateVersion,
  userId: string,
): Promise<ParsedTemplateVersion> {
  await db.insert(templateVersions).values(data);
  const row = await getTemplateVersionById(data.id, userId);
  if (!row) throw new Error('Template version insert failed');
  return row;
}

export async function updateTemplateVersionValidation(
  versionId: string,
  userId: string,
  validationStatus: 'valid' | 'invalid',
  validationErrors: ParsedValidationErrors,
): Promise<ParsedTemplateVersion | null> {
  await db
    .update(templateVersions)
    .set({ validationStatus, validationErrors })
    .where(eq(templateVersions.id, versionId));
  return getTemplateVersionById(versionId, userId);
}

export async function setTemplateVersionActivated(
  versionId: string,
  activated: boolean,
): Promise<void> {
  await db
    .update(templateVersions)
    .set({ activated })
    .where(eq(templateVersions.id, versionId));
}

// ============================================================
// Template variable schema queries (Zod Wall on schema)
// ============================================================

export async function getVariableSchemaForVersion(
  templateVersionId: string,
  userId: string,
): Promise<ParsedTemplateVariableSchema | null> {
  const rows = await db
    .select({ tvs: templateVariableSchemas })
    .from(templateVariableSchemas)
    .innerJoin(templateVersions, eq(templateVariableSchemas.templateVersionId, templateVersions.id))
    .innerJoin(templates, eq(templateVersions.templateId, templates.id))
    .where(
      and(
        eq(templateVariableSchemas.templateVersionId, templateVersionId),
        eq(templates.userId, userId),
      ),
    );
  const row = rows[0]?.tvs;
  if (!row) return null;
  return parseTemplateVariableSchema(row, { userId });
}

export async function upsertVariableSchema(
  data: NewTemplateVariableSchema,
  userId: string,
): Promise<ParsedTemplateVariableSchema> {
  // Check if a row already exists for this version
  const existing = await getVariableSchemaForVersion(data.templateVersionId, userId);
  if (existing) {
    // Update existing
    await db
      .update(templateVariableSchemas)
      .set({ schema: data.schema, updatedAt: new Date() })
      .where(eq(templateVariableSchemas.templateVersionId, data.templateVersionId));
  } else {
    // Insert new
    await db.insert(templateVariableSchemas).values(data);
  }
  const row = await getVariableSchemaForVersion(data.templateVersionId, userId);
  if (!row) throw new Error('Variable schema upsert failed');
  return row;
}
