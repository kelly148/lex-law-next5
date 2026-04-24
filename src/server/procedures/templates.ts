/**
 * Template tRPC procedures — Ch 21.5 (Phase 4a)
 *
 * Procedures:
 *   template.upload         — upload a .docx, extract Handlebars source, run phase-1 validation
 *   template.list           — list templates, optionally filtered by documentType or archived status
 *   template.get            — fetch a single template with versions and active-version pointer
 *   template.updateSchema   — save schema edits (partial update)
 *   template.confirmSchema  — run phase-2 validation and confirm schema
 *   template.activate       — set templates.activeVersionId to the specified version
 *   template.sandbox        — render a template version with mock data (Decision #40 watermark)
 *   template.archive        — set templates.archivedAt
 *   template.unarchive      — clear templates.archivedAt
 *
 * Phase 4a scope only. No .docx export pipeline (Phase 6).
 * userId is always drawn from ctx.userId (Ch 35.2) — never from input.
 */
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { v4 as uuidv4 } from 'uuid';
import mammoth from 'mammoth';
import { router, protectedProcedure } from '../trpc.js';
import {
  getTemplateById,
  listTemplates,
  insertTemplate,
  updateTemplateActiveVersion,
  archiveTemplate,
  unarchiveTemplate,
  getTemplateVersionById,
  listTemplateVersions,
  getNextVersionNumber,
  insertTemplateVersion,
  updateTemplateVersionValidation,
  setTemplateVersionActivated,
  getVariableSchemaForVersion,
  upsertVariableSchema,
  type ParsedValidationErrors,
} from '../db/queries/templates.js';
import {
  validateHandlebarsSource,
  renderTemplateSandbox,
} from '../llm/handlebars/engine.js';
import { emitTelemetry } from '../telemetry/emitTelemetry.js';

// ============================================================
// Input schemas
// ============================================================

const VariableFieldInputSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['string', 'number', 'date', 'currency', 'boolean', 'array']),
  label: z.string().optional(),
  required: z.boolean().default(false),
  description: z.string().optional(),
  itemType: z.enum(['string', 'number', 'date', 'currency']).optional(),
});

const VariableSchemaInputSchema = z.object({
  fields: z.array(VariableFieldInputSchema),
  schemaVersion: z.number().default(1),
});

// ============================================================
// Helpers
// ============================================================

/**
 * Extract Handlebars source from a base64-encoded .docx buffer.
 * Uses mammoth to extract raw text, then returns it as the Handlebars source.
 * Throws INVALID_DOCX if the buffer is not a valid .docx.
 * Throws PARSE_FAILED if mammoth extraction fails.
 */
async function extractHandlebarsSource(fileBase64: string): Promise<string> {
  let buffer: Buffer;
  try {
    buffer = Buffer.from(fileBase64, 'base64');
  } catch {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'INVALID_DOCX: could not decode base64' });
  }

  let result: { value: string; messages: Array<{ type: string; message: string }> };
  try {
    result = await mammoth.extractRawText({ buffer });
  } catch (err) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `PARSE_FAILED: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  if (!result.value || result.value.trim().length === 0) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'INVALID_DOCX: extracted text is empty',
    });
  }

  return result.value;
}

/**
 * Phase-2 validation: check that all {{placeholders}} in the Handlebars source
 * have corresponding field definitions in the schema.
 * Returns warnings (not hard errors) for unmatched placeholders.
 */
function runPhase2Validation(
  handlebarsSource: string,
  schemaFields: Array<{ name: string }>,
): { warnings: Array<{ type: string; message: string; fieldName?: string }> } {
  const warnings: Array<{ type: string; message: string; fieldName?: string }> = [];

  // Extract all {{variable}} references (simple mustaches, not block helpers)
  const placeholderRegex = /\{\{([^#/^!>][^}]*?)\}\}/g;
  const foundPlaceholders = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = placeholderRegex.exec(handlebarsSource)) !== null) {
    const expr = match[1]?.trim() ?? '';
    // Skip helper calls (contain spaces or are known helpers)
    if (!expr.includes(' ') && !expr.includes('.')) {
      foundPlaceholders.add(expr);
    }
  }

  const schemaFieldNames = new Set(schemaFields.map((f) => f.name));

  // Warn for placeholders not in schema
  for (const placeholder of foundPlaceholders) {
    if (!schemaFieldNames.has(placeholder)) {
      warnings.push({
        type: 'placeholder_not_in_schema',
        message: `Template placeholder "{{${placeholder}}}" has no corresponding schema field`,
        fieldName: placeholder,
      });
    }
  }

  // Warn for schema fields not referenced in template
  for (const fieldName of schemaFieldNames) {
    if (!foundPlaceholders.has(fieldName)) {
      warnings.push({
        type: 'schema_field_not_in_template',
        message: `Schema field "${fieldName}" is not referenced in the template`,
        fieldName,
      });
    }
  }

  return { warnings };
}

// ============================================================
// Router
// ============================================================

export const templateRouter = router({
  /**
   * template.upload — Ch 21.5
   * Upload a .docx, extract Handlebars source, run phase-1 validation.
   * If templateId is provided, creates a new version of that template.
   * Otherwise creates a new template.
   */
  upload: protectedProcedure
    .input(
      z.object({
        templateId: z.string().uuid().optional(),
        name: z.string().min(1).max(256),
        documentType: z.string().min(1).max(64),
        fileBase64: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.userId;

      // If templateId provided, verify it exists and belongs to user
      if (input.templateId) {
        const existing = await getTemplateById(input.templateId, userId);
        if (!existing) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Template not found' });
        }
      }

      // Extract Handlebars source from .docx
      const handlebarsSource = await extractHandlebarsSource(input.fileBase64);

      // Phase-1 validation (Ch 12.4)
      const validationResult = validateHandlebarsSource(handlebarsSource);
      const validationStatus = validationResult.valid ? 'valid' : 'invalid';
      const validationErrors: ParsedValidationErrors = validationResult.valid
        ? null
        : validationResult.errors;

      // Create template if new
      let templateId = input.templateId;
      if (!templateId) {
        templateId = uuidv4();
        await insertTemplate({
          id: templateId,
          userId,
          name: input.name,
          documentType: input.documentType,
          activeVersionId: null,
          archivedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }

      // Create template version
      const versionNumber = await getNextVersionNumber(templateId);
      const versionId = uuidv4();
      // In v1, fileStorageKey is a placeholder path (no blob storage in Phase 4a)
      const fileStorageKey = `templates/${templateId}/v${versionNumber}.docx`;

      const version = await insertTemplateVersion(
        {
          id: versionId,
          templateId,
          versionNumber,
          fileStorageKey,
          handlebarsSource,
          validationStatus,
          validationErrors,
          activated: false,
          createdAt: new Date(),
        },
        userId,
      );

      const template = await getTemplateById(templateId, userId);
      if (!template) throw new TRPCError({ code: 'NOT_FOUND', message: 'Template not found after insert' });

      void emitTelemetry(
        'template_uploaded',
        { templateId, versionId, documentType: input.documentType, validationStatus },
        { userId, matterId: null, documentId: null, jobId: null },
      );

      return { template, version, validationResult };
    }),

  /**
   * template.list — Ch 21.5
   */
  list: protectedProcedure
    .input(
      z.object({
        documentType: z.string().optional(),
        includeArchived: z.boolean().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const listOpts: { documentType?: string; includeArchived?: boolean } = {};
      if (input.documentType !== undefined) listOpts.documentType = input.documentType;
      if (input.includeArchived !== undefined) listOpts.includeArchived = input.includeArchived;
      const templates = await listTemplates(ctx.userId, listOpts);
      return { templates };
    }),

  /**
   * template.get — Ch 21.5
   */
  get: protectedProcedure
    .input(z.object({ templateId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const template = await getTemplateById(input.templateId, ctx.userId);
      if (!template) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Template not found' });
      }
      const versions = await listTemplateVersions(input.templateId, ctx.userId);
      return {
        template,
        versions,
        activeVersionId: template.activeVersionId ?? null,
      };
    }),

  /**
   * template.updateSchema — Ch 21.5
   * Save schema edits (partial update). Does not run phase-2 validation.
   * Precondition: version exists; validationStatus='valid'.
   */
  updateSchema: protectedProcedure
    .input(
      z.object({
        versionId: z.string().uuid(),
        schema: VariableSchemaInputSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const version = await getTemplateVersionById(input.versionId, ctx.userId);
      if (!version) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Template version not found' });
      }
      if (version.validationStatus !== 'valid') {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'PHASE_1_VALIDATION_FAILED: template version has not passed phase-1 validation',
        });
      }

      const schemaId = uuidv4();
      const schemaRow = await upsertVariableSchema(
        {
          id: schemaId,
          templateVersionId: input.versionId,
          schema: input.schema,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        ctx.userId,
      );

      void emitTelemetry(
        'schema_updated',
        { versionId: input.versionId, fieldCount: input.schema.fields.length },
        { userId: ctx.userId, matterId: null, documentId: null, jobId: null },
      );

      return { version, schemaRow };
    }),

  /**
   * template.confirmSchema — Ch 21.5
   * Run phase-2 validation and confirm schema.
   * Precondition: version exists; validationStatus='valid'; schema row exists.
   */
  confirmSchema: protectedProcedure
    .input(
      z.object({
        versionId: z.string().uuid(),
        acknowledgeWarnings: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const version = await getTemplateVersionById(input.versionId, ctx.userId);
      if (!version) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Template version not found' });
      }
      if (version.validationStatus !== 'valid') {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'PHASE_1_VALIDATION_FAILED: template version has not passed phase-1 validation',
        });
      }

      const schemaRow = await getVariableSchemaForVersion(input.versionId, ctx.userId);
      if (!schemaRow) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'SCHEMA_NOT_CONFIRMED: no schema row exists for this version — call updateSchema first',
        });
      }

      // Phase-2 validation
      const { warnings } = runPhase2Validation(
        version.handlebarsSource,
        schemaRow.schema.fields,
      );

      if (warnings.length > 0 && !input.acknowledgeWarnings) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'SCHEMA_WARNINGS_UNACKNOWLEDGED: schema has warnings that must be acknowledged',
        });
      }

      void emitTelemetry(
        'schema_confirmed',
        {
          templateId: version.templateId,
          versionId: input.versionId,
          fieldCount: schemaRow.schema.fields.length,
          warningCount: warnings.length,
          warningsAcknowledged: input.acknowledgeWarnings ?? false,
        },
        { userId: ctx.userId, matterId: null, documentId: null, jobId: null },
      );

      return { version, schemaRow, warnings };
    }),

  /**
   * template.activate — Ch 21.5
   * Set templates.activeVersionId to the specified version.
   * Preconditions: version exists; belongs to template; validationStatus='valid';
   *                template_variable_schemas row exists for the version.
   */
  activate: protectedProcedure
    .input(
      z.object({
        templateId: z.string().uuid(),
        versionId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const template = await getTemplateById(input.templateId, ctx.userId);
      if (!template) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Template not found' });
      }

      const version = await getTemplateVersionById(input.versionId, ctx.userId);
      if (!version) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Template version not found' });
      }
      if (version.templateId !== input.templateId) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'TEMPLATE_NOT_ACTIVATED: version does not belong to this template',
        });
      }
      if (version.validationStatus !== 'valid') {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'TEMPLATE_NOT_ACTIVATED: version has not passed phase-1 validation',
        });
      }

      const schemaRow = await getVariableSchemaForVersion(input.versionId, ctx.userId);
      if (!schemaRow) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'TEMPLATE_NOT_ACTIVATED: no confirmed schema exists for this version',
        });
      }

      // Deactivate previously-active version (if any)
      if (template.activeVersionId && template.activeVersionId !== input.versionId) {
        await setTemplateVersionActivated(template.activeVersionId, false);
      }

      // Activate new version
      await setTemplateVersionActivated(input.versionId, true);
      const updatedTemplate = await updateTemplateActiveVersion(
        input.templateId,
        ctx.userId,
        input.versionId,
      );

      if (!updatedTemplate) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Template not found after activation' });
      }

      void emitTelemetry(
        'template_activated',
        { templateId: input.templateId, versionId: input.versionId },
        { userId: ctx.userId, matterId: null, documentId: null, jobId: null },
      );

      return { template: updatedTemplate };
    }),

  /**
   * template.sandbox — Ch 21.5, Decision #40
   * Render a template version with mock data for attorney preview.
   * Mandatory watermark: "SANDBOX PREVIEW — NOT FOR CLIENT USE"
   * No version row created, no document created.
   * Preconditions: version exists; validationStatus='valid'; schema confirmed;
   *                mockData validates against the version's schema.
   */
  sandbox: protectedProcedure
    .input(
      z.object({
        versionId: z.string().uuid(),
        mockData: z.record(z.unknown()),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const version = await getTemplateVersionById(input.versionId, ctx.userId);
      if (!version) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Template version not found' });
      }
      if (version.validationStatus !== 'valid') {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'PHASE_1_VALIDATION_FAILED: template version has not passed phase-1 validation',
        });
      }

      const schemaRow = await getVariableSchemaForVersion(input.versionId, ctx.userId);
      if (!schemaRow) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'SCHEMA_NOT_CONFIRMED: no confirmed schema exists for this version',
        });
      }

      // Validate mockData against schema (type check for required fields)
      const mockDataErrors: string[] = [];
      for (const field of schemaRow.schema.fields) {
        const value = input.mockData[field.name];
        if (field.required && (value === undefined || value === null || value === '')) {
          mockDataErrors.push(`Required field "${field.name}" is missing from mock data`);
        }
      }
      if (mockDataErrors.length > 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `MOCK_DATA_INVALID: ${mockDataErrors.join('; ')}`,
        });
      }

      // Render with mandatory watermark (Decision #40)
      let renderedContent: string;
      try {
        const result = renderTemplateSandbox(version.handlebarsSource, input.mockData);
        renderedContent = result.content;
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'TEMPLATE_CORRUPT') {
          // Mark version as invalid
          await updateTemplateVersionValidation(input.versionId, ctx.userId, 'invalid', [
            { type: 'parse_error', message: err instanceof Error ? err.message : String(err) },
          ]);
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'TEMPLATE_CORRUPT: template source failed to parse at render time',
          });
        }
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `RENDER_FAILED: ${err instanceof Error ? err.message : String(err)}`,
        });
      }

      void emitTelemetry(
        'template_sandbox_render',
        { templateId: version.templateId, versionId: input.versionId },
        { userId: ctx.userId, matterId: null, documentId: null, jobId: null },
      );

      // Return rendered content (no downloadUrl in Phase 4a — no blob storage)
      return { renderedContent };
    }),

  /**
   * template.archive — Ch 21.5
   */
  archive: protectedProcedure
    .input(z.object({ templateId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const template = await getTemplateById(input.templateId, ctx.userId);
      if (!template) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Template not found' });
      }
      if (template.archivedAt !== null) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'ALREADY_ARCHIVED: template is already archived',
        });
      }

      const updated = await archiveTemplate(input.templateId, ctx.userId);
      if (!updated) throw new TRPCError({ code: 'NOT_FOUND', message: 'Template not found after archive' });

      void emitTelemetry(
        'template_archived',
        {},
        { userId: ctx.userId, matterId: null, documentId: null, jobId: null },
      );

      return { template: updated };
    }),

  /**
   * template.unarchive — Ch 21.5
   */
  unarchive: protectedProcedure
    .input(z.object({ templateId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const template = await getTemplateById(input.templateId, ctx.userId);
      if (!template) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Template not found' });
      }
      if (template.archivedAt === null) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'NOT_ARCHIVED: template is not archived',
        });
      }

      const updated = await unarchiveTemplate(input.templateId, ctx.userId);
      if (!updated) throw new TRPCError({ code: 'NOT_FOUND', message: 'Template not found after unarchive' });

      void emitTelemetry(
        'template_unarchived',
        {},
        { userId: ctx.userId, matterId: null, documentId: null, jobId: null },
      );

      return { template: updated };
    }),
});
