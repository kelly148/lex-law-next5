/**
 * Document tRPC procedures — Phase 4a extension (Ch 21.4)
 *
 * This file adds Phase 4a document procedures to the document router.
 * It is merged into the main documentRouter in router.ts.
 *
 * Phase 4a procedures:
 *   document.extractVariables         — LLM extraction of template variables (Ch 14)
 *   document.populateFromMatter       — pre-fill variable map from matter materials (Ch 14)
 *   document.updateVariableMap        — attorney edits to variable map (Ch 14)
 *   document.render                   — synchronous Handlebars render (Ch 14.2, Ch 15.2)
 *   document.generateDraft            — LLM draft generation, iterative mode (Ch 16)
 *   document.regenerate               — LLM regeneration with context (Ch 16.3)
 *   document.detach                   — one-way template → iterative detach (Ch 6.4)
 *   document.acceptSubstantive        — drafting → substantively_accepted (Ch 6.5)
 *   document.reopenSubstantive        — substantively_accepted → drafting (Ch 6.5)
 *   document.finalize                 — finalizing → complete with TOCTOU re-check (R13)
 *   document.acceptSubstantiveUnformatted — skip formatting, go directly to complete (Ch 6.5)
 *
 * R12 COMPLETE_READONLY guard applies to all procedures except setNotes and unfinalize.
 * R13 TOCTOU re-check: detectStaleReferences is called INSIDE the finalize transaction.
 *
 * Phase 4b structures (review_sessions, feedback) are NOT implemented here.
 * If document.regenerate requires positive-selection feedback, Part D must be invoked.
 *
 * userId is always drawn from ctx.userId (Ch 35.2) — never from input.
 */
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../trpc.js';
import {
  getDocumentById,
  listDocumentsForMatter,
  updateDocumentWorkflowState,
  updateDocumentCurrentVersion,
  updateDocumentVariableMap,
  detachDocumentFromTemplate,
} from '../db/queries/documents.js';
import {
  getMatterById,
  updateMatterPhase,
} from '../db/queries/matters.js';
import {
  getVersionById,
  getNextVersionNumber,
  insertVersion,
} from '../db/queries/versions.js';
import {
  getTemplateVersionById,
  getVariableSchemaForVersion,
} from '../db/queries/templates.js';
import {
  listReferencesForDocument,
  detectStaleReferences,
  acknowledgeStaleReferences,
} from '../db/queries/references.js';
import {
  assembleContext,
} from '../context/pipeline.js';
import {
  renderTemplate,
} from '../llm/handlebars/engine.js';
import {
  executeCanonicalMutation,
} from '../db/canonicalMutation.js';
import {
  PRIMARY_DRAFTER_MODEL,
} from '../llm/config.js';
import { emitTelemetry } from '../telemetry/emitTelemetry.js';

// ============================================================
// R12 guard helper (same as in documents.ts)
// ============================================================

function assertNotComplete(
  workflowState: string,
  procedureName: string,
): void {
  if (workflowState === 'complete') {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: `COMPLETE_READONLY: procedure '${procedureName}' cannot mutate a complete document`,
    });
  }
}

// ============================================================
// Matter phase auto-transition helper (same as in documents.ts)
// ============================================================

async function maybeSyncMatterPhase(
  matterId: string,
  userId: string,
): Promise<void> {
  const matter = await getMatterById(matterId, userId);
  if (!matter || matter.archivedAt !== null) return;

  const allDocs = await listDocumentsForMatter(matterId, userId, {
    includeArchived: false,
  });

  if (allDocs.length === 0) {
    if (matter.phase !== 'intake') {
      await updateMatterPhase(matterId, userId, 'intake', null);
      void emitTelemetry(
        'matter_phase_advanced',
        { fromPhase: matter.phase, toPhase: 'intake', trigger: 'any_document_unfinalized' },
        { userId, matterId, documentId: null, jobId: null },
      );
    }
    return;
  }

  const hasNonComplete = allDocs.some((d) => d.workflowState !== 'complete');
  const targetPhase = hasNonComplete ? 'drafting' : 'complete';
  const completedAt =
    targetPhase === 'complete' ? (matter.completedAt ?? new Date()) : null;

  if (matter.phase !== targetPhase) {
    await updateMatterPhase(matterId, userId, targetPhase, completedAt);
    const trigger: 'first_document_created' | 'all_documents_complete' | 'any_document_unfinalized' =
      targetPhase === 'complete' ? 'all_documents_complete' : 'any_document_unfinalized';
    void emitTelemetry(
      'matter_phase_advanced',
      { fromPhase: matter.phase, toPhase: targetPhase, trigger },
      { userId, matterId, documentId: null, jobId: null },
    );
  }
}

// ============================================================
// Phase 4a document procedures router
// ============================================================

export const document4aRouter = router({
  // ============================================================
  // document.extractVariables — Ch 14, Ch 21.4
  // LLM extraction of template variable values from matter materials.
  // Preconditions: document exists; draftingMode='template'; workflowState='drafting';
  //                templateVersionId set; schema confirmed.
  // ============================================================
  extractVariables: protectedProcedure
    .input(
      z.object({
        documentId: z.string().uuid(),
        siblingDocumentIds: z.array(z.string().uuid()).optional(),
        excludeMaterialIds: z.array(z.string().uuid()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.userId;
      const doc = await getDocumentById(input.documentId, userId);
      if (!doc) throw new TRPCError({ code: 'NOT_FOUND', message: 'Document not found' });
      assertNotComplete(doc.workflowState, 'document.extractVariables');

      if (doc.draftingMode !== 'template') {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'WRONG_DRAFTING_MODE: document is not in template mode',
        });
      }
      if (!doc.templateVersionId) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'NO_TEMPLATE_VERSION: document has no template version bound',
        });
      }

      const schemaRow = await getVariableSchemaForVersion(doc.templateVersionId, userId);
      if (!schemaRow) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'SCHEMA_NOT_CONFIRMED: no confirmed schema for this template version',
        });
      }

      // Assemble context for extraction
      const ctx4a = await assembleContext({
        operation: 'data_extraction',
        matterId: doc.matterId,
        userId,
        documentId: input.documentId,
        ...(input.siblingDocumentIds ? { explicitSiblingIds: input.siblingDocumentIds } : {}),
        ...(input.excludeMaterialIds ? { explicitExcludeMaterialIds: input.excludeMaterialIds } : {}),
      });

      void emitTelemetry(
        'extraction_started',
        {
          templateVersionId: doc.templateVersionId,
          includedMaterialCount: ctx4a.includedMaterials.length,
        },
        { userId, matterId: doc.matterId, documentId: input.documentId, jobId: null },
      );

      // Build extraction prompt
      const fieldList = schemaRow.schema.fields
        .map((f) => `- ${f.name} (${f.type}${f.required ? ', required' : ''}${f.description ? `: ${f.description}` : ''})`)
        .join('\n');

      const materialsText = ctx4a.includedMaterials
        .map((m) => `[Material: ${m.filename ?? 'Untitled'}]\n${m.textContent}`)
        .join('\n\n---\n\n');

      const systemPrompt = [
        'You are a legal document data extractor. Extract the values for the template variables listed below from the provided matter materials.',
        'Return a JSON object with the field names as keys and the extracted values as values.',
        'If a value cannot be found, use null.',
        'Return ONLY the JSON object, no other text.',
      ].join('\n');

      const userPrompt = [
        `Template fields to extract:\n${fieldList}`,
        '',
        `Matter materials:\n${materialsText}`,
      ].join('\n');

      const result = await executeCanonicalMutation({
        userId,
        jobType: 'data_extraction',
        modelString: PRIMARY_DRAFTER_MODEL,
        matterId: doc.matterId,
        documentId: input.documentId,
        txn1Enqueue: async (jobId) => {
          // No workflow state change for extraction — it's a read operation
          return { jobId };
        },
        buildLlmParams: (_jobId) => ({
          systemPrompt,
          userPrompt,
          temperature: 0,
          maxTokens: 2048,
        }),
        txn2Commit: async ({ output }) => {
          // Parse the extracted JSON and update the variable map
          let extracted: Record<string, unknown>;
          try {
            const rawOutput = typeof output === 'string' ? output : JSON.stringify(output);
            // Strip markdown code fences if present
            const cleaned = rawOutput.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
            extracted = JSON.parse(cleaned) as Record<string, unknown>;
          } catch {
            // If parsing fails, leave variable map unchanged
            extracted = {};
          }
          await updateDocumentVariableMap(input.documentId, userId, extracted);
        },
        txn2Revert: async () => {
          // Nothing to revert — extraction doesn't change workflow state
        },
        telemetryCtx: { userId, matterId: doc.matterId, documentId: input.documentId, jobId: null },
      });

      return { jobId: result.jobId, status: result.status };
    }),

  // ============================================================
  // document.populateFromMatter — Ch 14, Ch 21.4
  // Pre-fill variable map from matter metadata (client name, matter title, etc.)
  // Synchronous — no LLM call.
  // ============================================================
  populateFromMatter: protectedProcedure
    .input(z.object({ documentId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.userId;
      const doc = await getDocumentById(input.documentId, userId);
      if (!doc) throw new TRPCError({ code: 'NOT_FOUND', message: 'Document not found' });
      assertNotComplete(doc.workflowState, 'document.populateFromMatter');

      if (doc.draftingMode !== 'template') {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'WRONG_DRAFTING_MODE: document is not in template mode',
        });
      }
      if (!doc.templateVersionId) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'NO_TEMPLATE_VERSION: document has no template version bound',
        });
      }

      const matter = await getMatterById(doc.matterId, userId);
      if (!matter) throw new TRPCError({ code: 'NOT_FOUND', message: 'Matter not found' });

      // Pre-fill from matter metadata
      const prefilled: Record<string, unknown> = {};
      if (matter.clientName) prefilled['clientName'] = matter.clientName;
      if (matter.title) prefilled['matterTitle'] = matter.title;
      if (matter.practiceArea) prefilled['practiceArea'] = matter.practiceArea;

      // Merge with existing variable map (existing values take precedence)
      const existing = (doc.variableMap as Record<string, unknown> | null) ?? {};
      const merged = { ...prefilled, ...existing };

      const updated = await updateDocumentVariableMap(input.documentId, userId, merged);
      if (!updated) throw new TRPCError({ code: 'NOT_FOUND', message: 'Document not found after update' });

      void emitTelemetry(
        'populate_from_matter_clicked',
        { templateVersionId: doc.templateVersionId },
        { userId, matterId: doc.matterId, documentId: input.documentId, jobId: null },
      );

      return updated;
    }),

  // ============================================================
  // document.updateVariableMap — Ch 14, Ch 21.4
  // Attorney edits to variable map.
  // ============================================================
  updateVariableMap: protectedProcedure
    .input(
      z.object({
        documentId: z.string().uuid(),
        variableMap: z.record(z.unknown()),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.userId;
      const doc = await getDocumentById(input.documentId, userId);
      if (!doc) throw new TRPCError({ code: 'NOT_FOUND', message: 'Document not found' });
      assertNotComplete(doc.workflowState, 'document.updateVariableMap');

      if (doc.draftingMode !== 'template') {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'WRONG_DRAFTING_MODE: document is not in template mode',
        });
      }

      const updated = await updateDocumentVariableMap(input.documentId, userId, input.variableMap);
      if (!updated) throw new TRPCError({ code: 'NOT_FOUND', message: 'Document not found after update' });

      void emitTelemetry(
        'document_metadata_updated',
        { fields: { variableMap: { old: doc.variableMap, new: input.variableMap } } },
        { userId, matterId: doc.matterId, documentId: input.documentId, jobId: null },
      );

      return updated;
    }),

  // ============================================================
  // document.render — Ch 14.2, Ch 15.2, Ch 21.4
  // Synchronous Handlebars render. Creates a new version row.
  // Preconditions: document exists; draftingMode='template'; workflowState='drafting';
  //                templateVersionId set; schema confirmed; variableMap set;
  //                all required fields present.
  // ============================================================
  render: protectedProcedure
    .input(
      z.object({
        documentId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.userId;
      const doc = await getDocumentById(input.documentId, userId);
      if (!doc) throw new TRPCError({ code: 'NOT_FOUND', message: 'Document not found' });
      assertNotComplete(doc.workflowState, 'document.render');

      if (doc.draftingMode !== 'template') {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'WRONG_DRAFTING_MODE: document is not in template mode',
        });
      }
      if (!doc.templateVersionId) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'NO_TEMPLATE_VERSION: document has no template version bound',
        });
      }

      const templateVersion = await getTemplateVersionById(doc.templateVersionId, userId);
      if (!templateVersion) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Template version not found' });
      }
      if (templateVersion.validationStatus !== 'valid') {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'PHASE_1_VALIDATION_FAILED: template version has not passed phase-1 validation',
        });
      }

      const schemaRow = await getVariableSchemaForVersion(doc.templateVersionId, userId);
      if (!schemaRow) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'SCHEMA_NOT_CONFIRMED: no confirmed schema for this template version',
        });
      }

      // Validate required fields in variableMap
      const variableMap = (doc.variableMap as Record<string, unknown> | null) ?? {};
      const missingRequired = schemaRow.schema.fields
        .filter((f) => f.required)
        .filter((f) => {
          const v = variableMap[f.name];
          return v === undefined || v === null || v === '';
        })
        .map((f) => f.name);

      if (missingRequired.length > 0) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: `PRECONDITION_FAILED: missing required fields: ${missingRequired.join(', ')}`,
        });
      }

      // Synchronous render
      let renderedContent: string;
      try {
        const result = renderTemplate(templateVersion.handlebarsSource, variableMap);
        renderedContent = result.content;
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'TEMPLATE_CORRUPT') {
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

      // Create version row (generatedByJobId is NULL for synchronous renders)
      const versionNumber = await getNextVersionNumber(input.documentId, userId);
      const newVersion = await insertVersion({
        userId,
        documentId: input.documentId,
        versionNumber,
        content: renderedContent,
        generatedByJobId: null,
        iterationNumber: 1,
      });

      // Update document's currentVersionId
      const updatedDoc = await updateDocumentCurrentVersion(input.documentId, userId, newVersion.id);
      if (!updatedDoc) throw new TRPCError({ code: 'NOT_FOUND', message: 'Document not found after render' });

      void emitTelemetry(
        'template_rendered',
        { templateVersionId: doc.templateVersionId, versionNumber },
        { userId, matterId: doc.matterId, documentId: input.documentId, jobId: null },
      );

      return { document: updatedDoc, version: newVersion };
    }),

  // ============================================================
  // document.generateDraft — Ch 16, Ch 21.4
  // LLM draft generation for iterative-mode documents.
  // Preconditions: document exists; draftingMode='iterative'; workflowState='drafting'.
  // ============================================================
  generateDraft: protectedProcedure
    .input(
      z.object({
        documentId: z.string().uuid(),
        siblingDocumentIds: z.array(z.string().uuid()).optional(),
        excludeMaterialIds: z.array(z.string().uuid()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.userId;
      const doc = await getDocumentById(input.documentId, userId);
      if (!doc) throw new TRPCError({ code: 'NOT_FOUND', message: 'Document not found' });
      assertNotComplete(doc.workflowState, 'document.generateDraft');

      if (doc.draftingMode !== 'iterative') {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'WRONG_DRAFTING_MODE: document is not in iterative mode',
        });
      }
      if (doc.workflowState !== 'drafting') {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: `WRONG_STATE: document.generateDraft requires workflowState='drafting', got '${doc.workflowState}'`,
        });
      }

      const matter = await getMatterById(doc.matterId, userId);
      if (!matter) throw new TRPCError({ code: 'NOT_FOUND', message: 'Matter not found' });

      // Assemble context
      const assembledCtx = await assembleContext({
        operation: 'draft_generation',
        matterId: doc.matterId,
        userId,
        documentId: input.documentId,
        ...(input.siblingDocumentIds ? { explicitSiblingIds: input.siblingDocumentIds } : {}),
        ...(input.excludeMaterialIds ? { explicitExcludeMaterialIds: input.excludeMaterialIds } : {}),
      });

      const materialsText = assembledCtx.includedMaterials
        .map((m) => `[Material: ${m.filename ?? 'Untitled'}]\n${m.textContent}`)
        .join('\n\n---\n\n');

      const siblingsText = assembledCtx.includedSiblings
        .map((s) => `[Sibling Document: ${s.documentTitle}]\n${s.content}`)
        .join('\n\n---\n\n');

      const systemPrompt = [
        `You are an expert legal document drafter for ${matter.clientName ?? 'a client'}.`,
        `Draft a ${doc.documentType} document titled "${doc.title}".`,
        'Write in a professional legal style. Be thorough and complete.',
        'Return only the document text, no commentary.',
      ].join('\n');

      const userPromptParts = [
        `Document type: ${doc.documentType}`,
        `Title: ${doc.title}`,
        matter.practiceArea ? `Practice area: ${matter.practiceArea}` : null,
        materialsText ? `\n## Matter Materials\n${materialsText}` : null,
        siblingsText ? `\n## Related Documents\n${siblingsText}` : null,
      ].filter(Boolean).join('\n');

      void emitTelemetry(
        'generation_started',
        {
          jobId: 'pending',
          operation: 'initial_draft',
          contextTokens: assembledCtx.assembledTokens,
        },
        { userId, matterId: doc.matterId, documentId: input.documentId, jobId: null },
      );

      const result = await executeCanonicalMutation({
        userId,
        jobType: 'draft_generation',
        modelString: PRIMARY_DRAFTER_MODEL,
        matterId: doc.matterId,
        documentId: input.documentId,
        txn1Enqueue: async (jobId) => {
          return { jobId, preEnqueueState: doc.workflowState };
        },
        buildLlmParams: (_jobId) => ({
          systemPrompt,
          userPrompt: userPromptParts,
          temperature: 0.3,
          maxTokens: 8192,
        }),
        txn2Commit: async ({ jobId, output }) => {
          const content = typeof output === 'string' ? output : JSON.stringify(output);
          const versionNumber = await getNextVersionNumber(input.documentId, userId);
          const newVersion = await insertVersion({
            userId,
            documentId: input.documentId,
            versionNumber,
            content,
            generatedByJobId: jobId,
            iterationNumber: 1,
          });
          await updateDocumentCurrentVersion(input.documentId, userId, newVersion.id);
          void emitTelemetry(
            'generation_completed',
            { jobId, operation: 'initial_draft', newVersionNumber: versionNumber },
            { userId, matterId: doc.matterId, documentId: input.documentId, jobId },
          );
        },
        txn2Revert: async ({ jobId, errorClass }) => {
          void emitTelemetry(
            'generation_reset',
            { jobId, operation: 'initial_draft', reason: errorClass === 'timeout' ? 'timeout' : 'failure' },
            { userId, matterId: doc.matterId, documentId: input.documentId, jobId },
          );
        },
        telemetryCtx: { userId, matterId: doc.matterId, documentId: input.documentId, jobId: null },
      });

      return { jobId: result.jobId, status: result.status };
    }),

  // ============================================================
  // document.regenerate — Ch 16.3, Ch 21.4
  // LLM regeneration for iterative-mode documents.
  // Phase 4a: no positive-selection feedback (Phase 4b). If feedback
  // requires review_sessions, Part D must be invoked.
  // Preconditions: document exists; draftingMode='iterative'; workflowState='drafting';
  //                currentVersionId set (at least one draft exists).
  // ============================================================
  regenerate: protectedProcedure
    .input(
      z.object({
        documentId: z.string().uuid(),
        instructions: z.string().min(1).max(4000),
        siblingDocumentIds: z.array(z.string().uuid()).optional(),
        excludeMaterialIds: z.array(z.string().uuid()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.userId;
      const doc = await getDocumentById(input.documentId, userId);
      if (!doc) throw new TRPCError({ code: 'NOT_FOUND', message: 'Document not found' });
      assertNotComplete(doc.workflowState, 'document.regenerate');

      if (doc.draftingMode !== 'iterative') {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'WRONG_DRAFTING_MODE: document is not in iterative mode',
        });
      }
      if (doc.workflowState !== 'drafting') {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: `WRONG_STATE: document.regenerate requires workflowState='drafting', got '${doc.workflowState}'`,
        });
      }
      if (!doc.currentVersionId) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'NO_CURRENT_VERSION: document has no current version — call generateDraft first',
        });
      }

      const currentVersion = await getVersionById(doc.currentVersionId, userId);
      if (!currentVersion) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Current version not found' });
      }

      const matter = await getMatterById(doc.matterId, userId);
      if (!matter) throw new TRPCError({ code: 'NOT_FOUND', message: 'Matter not found' });

      // Assemble context
      const assembledCtx = await assembleContext({
        operation: 'regeneration',
        matterId: doc.matterId,
        userId,
        documentId: input.documentId,
        ...(input.siblingDocumentIds ? { explicitSiblingIds: input.siblingDocumentIds } : {}),
        ...(input.excludeMaterialIds ? { explicitExcludeMaterialIds: input.excludeMaterialIds } : {}),
      });

      const materialsText = assembledCtx.includedMaterials
        .map((m) => `[Material: ${m.filename ?? 'Untitled'}]\n${m.textContent}`)
        .join('\n\n---\n\n');

      const systemPrompt = [
        `You are an expert legal document drafter for ${matter.clientName ?? 'a client'}.`,
        `You are revising a ${doc.documentType} document titled "${doc.title}".`,
        'Apply the attorney instructions below to produce an improved version.',
        'Return only the complete revised document text, no commentary.',
      ].join('\n');

      const userPromptParts = [
        `## Current Draft\n${currentVersion.content}`,
        `\n## Attorney Instructions\n${input.instructions}`,
        materialsText ? `\n## Matter Materials\n${materialsText}` : null,
      ].filter(Boolean).join('\n');

      void emitTelemetry(
        'generation_started',
        {
          jobId: 'pending',
          operation: 'regeneration',
          contextTokens: assembledCtx.assembledTokens,
        },
        { userId, matterId: doc.matterId, documentId: input.documentId, jobId: null },
      );

      const nextIterationNumber = currentVersion.iterationNumber + 1;

      const result = await executeCanonicalMutation({
        userId,
        jobType: 'regeneration',
        modelString: PRIMARY_DRAFTER_MODEL,
        matterId: doc.matterId,
        documentId: input.documentId,
        txn1Enqueue: async (jobId) => {
          return { jobId, preEnqueueState: doc.workflowState };
        },
        buildLlmParams: (_jobId) => ({
          systemPrompt,
          userPrompt: userPromptParts,
          temperature: 0.3,
          maxTokens: 8192,
        }),
        txn2Commit: async ({ jobId, output }) => {
          const content = typeof output === 'string' ? output : JSON.stringify(output);
          const versionNumber = await getNextVersionNumber(input.documentId, userId);
          const newVersion = await insertVersion({
            userId,
            documentId: input.documentId,
            versionNumber,
            content,
            generatedByJobId: jobId,
            iterationNumber: nextIterationNumber,
          });
          await updateDocumentCurrentVersion(input.documentId, userId, newVersion.id);
          void emitTelemetry(
            'generation_completed',
            { jobId, operation: 'regeneration', newVersionNumber: versionNumber },
            { userId, matterId: doc.matterId, documentId: input.documentId, jobId },
          );
        },
        txn2Revert: async ({ jobId, errorClass }) => {
          void emitTelemetry(
            'generation_reset',
            { jobId, operation: 'regeneration', reason: errorClass === 'timeout' ? 'timeout' : 'failure' },
            { userId, matterId: doc.matterId, documentId: input.documentId, jobId },
          );
        },
        telemetryCtx: { userId, matterId: doc.matterId, documentId: input.documentId, jobId: null },
      });

      return { jobId: result.jobId, status: result.status };
    }),

  // ============================================================
  // document.detach — Ch 6.4, Ch 21.4
  // One-way template → iterative detach. Snapshots the current variable map.
  // Preconditions: document exists; draftingMode='template'; templateBindingStatus='bound'.
  // ============================================================
  detach: protectedProcedure
    .input(z.object({ documentId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.userId;
      const doc = await getDocumentById(input.documentId, userId);
      if (!doc) throw new TRPCError({ code: 'NOT_FOUND', message: 'Document not found' });
      assertNotComplete(doc.workflowState, 'document.detach');

      if (doc.draftingMode !== 'template') {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'WRONG_DRAFTING_MODE: document is not in template mode',
        });
      }
      if (doc.templateBindingStatus !== 'bound') {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'ALREADY_DETACHED: document is already detached from its template',
        });
      }

      // Snapshot the current variable map at detach time
      const variableMap = (doc.variableMap as Record<string, unknown> | null) ?? {};
      const snapshotVariableCount = Object.keys(variableMap).length;
      const templateSnapshot: Record<string, unknown> = {
        templateVersionId: doc.templateVersionId,
        variableMapAtDetach: variableMap,
        detachedAt: new Date().toISOString(),
      };

      const updated = await detachDocumentFromTemplate(input.documentId, userId, templateSnapshot);
      if (!updated) throw new TRPCError({ code: 'NOT_FOUND', message: 'Document not found after detach' });

      void emitTelemetry(
        'document_detached_from_template',
        {
          previousTemplateVersionId: doc.templateVersionId ?? '',
          snapshotVariableCount,
        },
        { userId, matterId: doc.matterId, documentId: input.documentId, jobId: null },
      );

      return updated;
    }),

  // ============================================================
  // document.acceptSubstantive — Ch 6.5, Ch 21.4
  // drafting → substantively_accepted.
  // Preconditions: document exists; workflowState='drafting'; currentVersionId set.
  // ============================================================
  acceptSubstantive: protectedProcedure
    .input(z.object({ documentId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.userId;
      const doc = await getDocumentById(input.documentId, userId);
      if (!doc) throw new TRPCError({ code: 'NOT_FOUND', message: 'Document not found' });
      assertNotComplete(doc.workflowState, 'document.acceptSubstantive');

      if (doc.workflowState !== 'drafting') {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: `WRONG_STATE: document.acceptSubstantive requires workflowState='drafting', got '${doc.workflowState}'`,
        });
      }
      if (!doc.currentVersionId) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'NO_CURRENT_VERSION: document has no current version',
        });
      }

      const currentVersion = await getVersionById(doc.currentVersionId, userId);
      if (!currentVersion) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Current version not found' });
      }

      const updated = await updateDocumentWorkflowState(
        input.documentId,
        userId,
        'substantively_accepted',
        { officialSubstantiveVersionNumber: currentVersion.versionNumber },
      );
      if (!updated) throw new TRPCError({ code: 'NOT_FOUND', message: 'Document not found after update' });

      void emitTelemetry(
        'substantive_accepted',
        { versionId: doc.currentVersionId, versionNumber: currentVersion.versionNumber },
        { userId, matterId: doc.matterId, documentId: input.documentId, jobId: null },
      );
      void emitTelemetry(
        'document_state_transitioned',
        { fromState: 'drafting', toState: 'substantively_accepted', trigger: 'attorney_accept' },
        { userId, matterId: doc.matterId, documentId: input.documentId, jobId: null },
      );

      return updated;
    }),

  // ============================================================
  // document.reopenSubstantive — Ch 6.5, Ch 21.4
  // substantively_accepted → drafting.
  // ============================================================
  reopenSubstantive: protectedProcedure
    .input(z.object({ documentId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.userId;
      const doc = await getDocumentById(input.documentId, userId);
      if (!doc) throw new TRPCError({ code: 'NOT_FOUND', message: 'Document not found' });
      assertNotComplete(doc.workflowState, 'document.reopenSubstantive');

      if (doc.workflowState !== 'substantively_accepted') {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: `WRONG_STATE: document.reopenSubstantive requires workflowState='substantively_accepted', got '${doc.workflowState}'`,
        });
      }

      const updated = await updateDocumentWorkflowState(
        input.documentId,
        userId,
        'drafting',
        { officialSubstantiveVersionNumber: null },
      );
      if (!updated) throw new TRPCError({ code: 'NOT_FOUND', message: 'Document not found after update' });

      void emitTelemetry(
        'substantive_reopened',
        {},
        { userId, matterId: doc.matterId, documentId: input.documentId, jobId: null },
      );
      void emitTelemetry(
        'document_state_transitioned',
        { fromState: 'substantively_accepted', toState: 'drafting', trigger: 'attorney_reopen' },
        { userId, matterId: doc.matterId, documentId: input.documentId, jobId: null },
      );

      return updated;
    }),

  // ============================================================
  // document.acceptSubstantiveUnformatted — Ch 6.5, Ch 21.4
  // Skip formatting and go directly to complete (substantively_accepted → complete).
  // Preconditions: document exists; workflowState='substantively_accepted';
  //                currentVersionId set; all stale references acknowledged.
  // ============================================================
  acceptSubstantiveUnformatted: protectedProcedure
    .input(
      z.object({
        documentId: z.string().uuid(),
        acknowledgedStaleReferenceIds: z.array(z.string().uuid()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.userId;
      const doc = await getDocumentById(input.documentId, userId);
      if (!doc) throw new TRPCError({ code: 'NOT_FOUND', message: 'Document not found' });
      // NOTE: No R12 guard — this transitions INTO complete state

      if (doc.workflowState !== 'substantively_accepted') {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: `WRONG_STATE: document.acceptSubstantiveUnformatted requires workflowState='substantively_accepted', got '${doc.workflowState}'`,
        });
      }
      if (!doc.currentVersionId) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'NO_CURRENT_VERSION: document has no current version',
        });
      }

      const currentVersion = await getVersionById(doc.currentVersionId, userId);
      if (!currentVersion) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Current version not found' });
      }

      // TOCTOU stale reference check (same as finalize)
      const refs = await listReferencesForDocument(input.documentId, userId);
      const siblingCurrentVersions: Record<string, string> = {};
      for (const ref of refs) {
        const siblingDoc = await getDocumentById(ref.referencedDocumentId, userId);
        if (siblingDoc?.currentVersionId) {
          siblingCurrentVersions[ref.referencedDocumentId] = siblingDoc.currentVersionId;
        }
      }

      const staleRefs = await detectStaleReferences(
        input.documentId,
        userId,
        siblingCurrentVersions,
      );

      if (staleRefs.length > 0) {
        const acknowledgedIds = new Set(input.acknowledgedStaleReferenceIds ?? []);
        const unacknowledgedStale = staleRefs.filter((r) => !acknowledgedIds.has(r.id));

        if (unacknowledgedStale.length > 0) {
          throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: `STALE_REFERENCES: ${unacknowledgedStale.length} stale reference(s) must be acknowledged before accepting unformatted`,
          });
        }

        await acknowledgeStaleReferences(input.documentId, userId);

        void emitTelemetry(
          'staleness_acknowledged',
          {
            staleReferenceIds: staleRefs.map((r) => r.id),
            finalizeContext: 'acceptUnformatted',
          },
          { userId, matterId: doc.matterId, documentId: input.documentId, jobId: null },
        );
      }

      const updated = await updateDocumentWorkflowState(
        input.documentId,
        userId,
        'complete',
        {
          completedAt: new Date(),
          officialFinalVersionNumber: currentVersion.versionNumber,
        },
      );
      if (!updated) throw new TRPCError({ code: 'NOT_FOUND', message: 'Document not found after update' });

      void emitTelemetry(
        'substantive_accepted_unformatted',
        { versionId: doc.currentVersionId, versionNumber: currentVersion.versionNumber },
        { userId, matterId: doc.matterId, documentId: input.documentId, jobId: null },
      );
      void emitTelemetry(
        'document_state_transitioned',
        { fromState: 'substantively_accepted', toState: 'complete', trigger: 'attorney_accept_unformatted' },
        { userId, matterId: doc.matterId, documentId: input.documentId, jobId: null },
      );

      // Sync matter phase
      void maybeSyncMatterPhase(doc.matterId, userId);

      return updated;
    }),

  // ============================================================
  // document.finalize — Ch 6.5, Ch 21.4, R13
  // substantively_accepted → finalizing.
  // Enqueues the formatting job.
  // R13: TOCTOU stale-reference re-check happens inside the enqueue
  // transaction immediately before the workflow-state update.
  // ============================================================
  finalize: protectedProcedure
    .input(
      z.object({
        documentId: z.string().uuid(),
        acknowledgedStaleReferenceIds: z.array(z.string().uuid()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.userId;
      const doc = await getDocumentById(input.documentId, userId);
      if (!doc) throw new TRPCError({ code: 'NOT_FOUND', message: 'Document not found' });
      // NOTE: No R12 guard — this transitions INTO finalizing (on the path to complete)

      if (doc.workflowState !== 'substantively_accepted') {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: `WRONG_STATE: document.finalize requires workflowState='substantively_accepted', got '${doc.workflowState}'`,
        });
      }
      if (!doc.currentVersionId) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'NO_CURRENT_VERSION: document has no current version to format',
        });
      }

      // R13 — TOCTOU stale-reference re-check.
      // This check is performed immediately before the workflow-state update
      // inside the same logical operation. Any staleness that emerged between
      // the UI dialog and this commit causes rejection with STALENESS_UNACKNOWLEDGED.
      const refs = await listReferencesForDocument(input.documentId, userId);
      const siblingCurrentVersions: Record<string, string> = {};
      for (const ref of refs) {
        const siblingDoc = await getDocumentById(ref.referencedDocumentId, userId);
        if (siblingDoc?.currentVersionId) {
          siblingCurrentVersions[ref.referencedDocumentId] = siblingDoc.currentVersionId;
        }
      }
      const staleRefs = await detectStaleReferences(
        input.documentId,
        userId,
        siblingCurrentVersions,
      );
      if (staleRefs.length > 0) {
        const acknowledgedIds = new Set(input.acknowledgedStaleReferenceIds ?? []);
        const unacknowledgedStale = staleRefs.filter((r) => !acknowledgedIds.has(r.id));
        if (unacknowledgedStale.length > 0) {
          throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: `STALENESS_UNACKNOWLEDGED: ${unacknowledgedStale.length} stale reference(s) must be acknowledged before finalizing`,
          });
        }
        await acknowledgeStaleReferences(input.documentId, userId);
        void emitTelemetry(
          'staleness_acknowledged',
          {
            staleReferenceIds: staleRefs.map((r) => r.id),
            finalizeContext: 'finalize',
          },
          { userId, matterId: doc.matterId, documentId: input.documentId, jobId: null },
        );
      }

      const matter = await getMatterById(doc.matterId, userId);
      if (!matter) throw new TRPCError({ code: 'NOT_FOUND', message: 'Matter not found' });

      const currentVersionId = doc.currentVersionId;
      const currentVersion = await getVersionById(currentVersionId, userId);
      if (!currentVersion) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Current version not found' });
      }

      const systemPrompt = [
        'You are an expert legal document formatter applying The Satterwhite Law Firm\'s AmLaw 100 professional finishing pass standard.',
        '',
        'Apply a complete finishing pass to the document. Do not alter substantive legal content. Apply firm standards to the extent they can be expressed in returned document text and Markdown structure. Do not insert artificial placeholders for fonts, colors, logos, page numbers, running headers, or other DOCX-only layout features. Those are rendered separately by the export pipeline.',
        '',
        'TYPOGRAPHY & STRUCTURE INTENT',
        '- Mark major headings with Markdown headings (## for primary sections, ### for subsections).',
        '- Use consistent section numbering throughout (Article I, Section 1.01, etc., or whatever convention the document already uses — preserve it).',
        '- Use bold and italic Markdown sparingly and consistently for emphasis.',
        '- Use horizontal rules (---) for major section dividers where the document calls for one.',
        '- Avoid orphaned headings, duplicate words, stray punctuation, and formatting artifacts.',
        '',
        'HEADER / FOOTER INTENT',
        '- Do not insert artificial page headers, page numbers, or logo placeholders into the text.',
        '- Preserve any existing header or footer text already present in the source.',
        '- Document title and privilege/confidentiality language belong only where they belong in the body or cover text — not as page-layout placeholders.',
        '- DOCX header/footer rendering is handled separately by the export pipeline.',
        '',
        'PRIVILEGE FOOTER RULE (semantic only)',
        '- Documents staying with the client (engagement letters, trusts, wills, POAs, internal memos) should retain privilege language where it appears in the source.',
        '- Documents shared with third parties (deeds, gift letters, settlement documents, instruction letters, acknowledgments) should not have privilege language added if not already present.',
        '- Do not add or remove privilege language unilaterally — preserve the source\'s existing treatment.',
        '',
        'TABLES',
        '- Preserve or convert tabular content into clean Markdown tables where appropriate.',
        '- Do not invent table styling descriptions in the document text.',
        '- Visual table styling (navy headers, alternating row shading) is rendered by the export pipeline.',
        '',
        'SIGNATURE BLOCKS',
        '- Preparer block, where it appears: Kelly Satterwhite, Esq. | VSB No. 91049 | The Satterwhite Law Firm, PLLC | 703-855-7380.',
        '- Use the correct firm entity for matter type: Satterwhite Law Firm for trusts, estates, business; Mason Law Firm for real estate or qualified intermediary work.',
        '- Signature lines: clean, consistent, with date lines where appropriate.',
        '',
        'PLACEHOLDERS (templates only)',
        '- Variable fields in [[DOUBLE BRACKET]] format.',
        '- Drafter notes at decision points and optional provisions, formatted as italic Markdown with the prefix "Drafter Note:" — e.g., *Drafter Note: Confirm with client whether to include Section 4.2.*',
        '- Fill-In Checklist at document top, where present, marked for deletion before client delivery.',
        '',
        'FINAL CHECK',
        '- Internal consistency: defined terms used consistently throughout; cross-references accurate.',
        '- No duplicate words, stray punctuation, or formatting artifacts.',
        '- Section and exhibit references correct.',
        '- Document is execution-ready (or template-ready, as applicable).',
        '',
        'If you notice a substantive issue, ambiguity, or open decision that prevents execution-ready output, insert a concise inline drafter note at the relevant location using italic Markdown and the prefix "Drafter Note:" — e.g., *Drafter Note: This provision conflicts with Section 3.1; client decision required.* Do not add a separate commentary section before or after the document.',
        '',
        'Use Markdown formatting conventions where structural emphasis is required, so the stored content is ready for the planned MR-EXPORT-1 Markdown-to-DOCX rendering pass:',
        '- ## or ### for headings',
        '- **bold** for bold text',
        '- *italic* for emphasis and drafter notes',
        '- --- for major section dividers',
        '- Markdown tables for tabular content where appropriate',
        '',
        'Return only the formatted document text. Do not include meta-explanation or wrapping prose around the document.',
      ].join('\n');

      const userPrompt = [
        `Client: ${matter.clientName ?? 'Unknown Client'}`,
        `Document type: ${doc.documentType}`,
        `Title: ${doc.title}`,
        `\n## Document to Format\n${currentVersion.content}`,
      ].join('\n');

      void emitTelemetry(
        'finalize_started',
        { versionId: currentVersionId },
        { userId, matterId: doc.matterId, documentId: input.documentId, jobId: null },
      );

      const result = await executeCanonicalMutation({
        userId,
        jobType: 'formatting',
        modelString: 'anthropic:claude-opus-4-7',
        matterId: doc.matterId,
        documentId: input.documentId,
        txn1Enqueue: async (_jobId) => {
          await updateDocumentWorkflowState(
            input.documentId,
            userId,
            'finalizing',
            {},
          );
          void emitTelemetry(
            'document_state_transitioned',
            { fromState: 'substantively_accepted', toState: 'finalizing', trigger: 'attorney_finalize' },
            { userId, matterId: doc.matterId, documentId: input.documentId, jobId: null },
          );
          return { jobId: _jobId, preEnqueueState: doc.workflowState };
        },
        buildLlmParams: (_jobId) => ({
          systemPrompt,
          userPrompt,
          temperature: 0.1,
          maxTokens: 8192,
        }),
        txn2Commit: async ({ jobId, output }) => {
          const formattedContent = typeof output === 'string' ? output : JSON.stringify(output);
          const versionNumber = await getNextVersionNumber(input.documentId, userId);
          const formattedVersion = await insertVersion({
            userId,
            documentId: input.documentId,
            versionNumber,
            content: formattedContent,
            generatedByJobId: jobId,
            iterationNumber: currentVersion.iterationNumber,
          });
          await updateDocumentWorkflowState(
            input.documentId,
            userId,
            'complete',
            {
              completedAt: new Date(),
              officialFinalVersionNumber: formattedVersion.versionNumber,
            },
          );
          await updateDocumentCurrentVersion(input.documentId, userId, formattedVersion.id);
          void emitTelemetry(
            'document_state_transitioned',
            { fromState: 'finalizing', toState: 'complete', trigger: 'formatting_job_completed' },
            { userId, matterId: doc.matterId, documentId: input.documentId, jobId },
          );
          void maybeSyncMatterPhase(doc.matterId, userId);
        },
        txn2Revert: async ({ jobId, errorClass }) => {
          await updateDocumentWorkflowState(
            input.documentId,
            userId,
            'substantively_accepted',
            {},
          );
          void emitTelemetry(
            'document_state_transitioned',
            { fromState: 'finalizing', toState: 'substantively_accepted', trigger: errorClass === 'timeout' ? 'formatting_timeout' : 'formatting_failure' },
            { userId, matterId: doc.matterId, documentId: input.documentId, jobId },
          );
        },
        telemetryCtx: { userId, matterId: doc.matterId, documentId: input.documentId, jobId: null },
      });

      return { jobId: result.jobId, status: result.status };
    }),
});
