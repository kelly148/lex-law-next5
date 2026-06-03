/**
 * Layer-0 Matter Intake & Analysis tRPC procedures — FOLD-L0-1.
 *
 * matterIntake.addParty / listParties        — thin party model (Fork B)
 * matterIntake.runConflictCheck              — RPC-mandatory deterministic check (Fork A/G)
 * matterIntake.getLatestConflicts            — latest check + its hits
 * matterIntake.dispositionHit                — disposition a hit (blocker => rationale required)
 * matterIntake.suggestLane                   — single-lane default; conservative multi suggestion (Fork E)
 * matterIntake.createAnalysis / getAnalysis  — internal, non-sendable assessment-and-plan (Fork C/F)
 * matterIntake.generateAnalysis              — single-lane (Claude) LLM analysis generation (Inc3, Fork E)
 * matterIntake.lockPlan                      — plan-only closure, GATED on conflicts cleared (Fork A/D)
 *
 * Owner-scoped: userId is always ctx.userId. The conflicts check is deterministic + DB-side
 * (no LLM, Fork G). Increment 1 is the server core (no UI); the false-negative disclosure at
 * the disposition surface + the analysis LLM generation are Increment 2 / follow-on.
 */

import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../trpc.js';
import { getMatterById } from '../db/queries/matters.js';
import { insertMatterParty, listPartiesForMatter } from '../db/queries/matterParties.js';
import {
  runConflictCheck,
  getLatestCheckForMatter,
  listHitsForCheck,
  dispositionConflictHit,
} from '../db/queries/conflicts.js';
import {
  insertMatterAnalysis,
  getActiveAnalysisForMatter,
  updateMatterAnalysisContent,
  supersedeAnalysis,
  lockPlan,
} from '../db/queries/matterAnalysis.js';
import { suggestAnalysisLane } from '../intake/modelLane.js';
import { executeCanonicalMutation } from '../db/canonicalMutation.js';
import { PRIMARY_DRAFTER_MODEL } from '../llm/config.js';
import { AnalysisGenerationSchema, parseGeneratedAnalysis } from '../intake/analysisGenerationParse.js';

const ROLE = z.enum(['client', 'adverse', 'related', 'other']);
const PARTY_TYPE = z.enum(['person', 'entity', 'unknown']);
const DISPOSITION = z.enum(['cleared', 'screened', 'declined']);

async function assertMatterOwned(matterId: string, userId: string) {
  const m = await getMatterById(matterId, userId);
  if (!m) throw new TRPCError({ code: 'NOT_FOUND', message: 'Matter not found' });
  return m;
}

export const matterIntakeRouter = router({
  addParty: protectedProcedure
    .input(
      z.object({
        matterId: z.string().uuid(),
        role: ROLE,
        displayName: z.string().min(1).max(256),
        partyType: PARTY_TYPE.optional(),
        source: z.string().max(64).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertMatterOwned(input.matterId, ctx.userId);
      return insertMatterParty({
        userId: ctx.userId,
        matterId: input.matterId,
        role: input.role,
        displayName: input.displayName,
        ...(input.partyType !== undefined ? { partyType: input.partyType } : {}),
        ...(input.source !== undefined ? { source: input.source } : {}),
      });
    }),

  listParties: protectedProcedure
    .input(z.object({ matterId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return listPartiesForMatter(input.matterId, ctx.userId);
    }),

  runConflictCheck: protectedProcedure
    .input(z.object({ matterId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertMatterOwned(input.matterId, ctx.userId);
      return runConflictCheck(input.matterId, ctx.userId);
    }),

  getLatestConflicts: protectedProcedure
    .input(z.object({ matterId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const check = await getLatestCheckForMatter(input.matterId, ctx.userId);
      if (!check) return { check: null, hits: [] };
      const hits = await listHitsForCheck(check.id, ctx.userId);
      return { check, hits };
    }),

  dispositionHit: protectedProcedure
    .input(
      z.object({
        hitId: z.string().uuid(),
        disposition: DISPOSITION,
        rationale: z.string().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return dispositionConflictHit({
        hitId: input.hitId,
        userId: ctx.userId,
        disposition: input.disposition,
        ...(input.rationale !== undefined ? { rationale: input.rationale } : {}),
      });
    }),

  suggestLane: protectedProcedure
    .input(
      z.object({
        highStakes: z.boolean().optional(),
        novel: z.boolean().optional(),
        crossJurisdictional: z.boolean().optional(),
        jurisdictions: z.array(z.string()).optional(),
      }),
    )
    .query(({ input }) => suggestAnalysisLane(input)),

  createAnalysis: protectedProcedure
    .input(
      z.object({
        matterId: z.string().uuid(),
        modelLane: z.enum(['single', 'multi']).optional(),
        assessment: z.unknown().optional(),
        plan: z.unknown().optional(),
        openQuestions: z.unknown().optional(),
        recommendedDocuments: z.unknown().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertMatterOwned(input.matterId, ctx.userId);
      return insertMatterAnalysis({
        userId: ctx.userId,
        matterId: input.matterId,
        ...(input.modelLane !== undefined ? { modelLane: input.modelLane } : {}),
        ...(input.assessment !== undefined ? { assessment: input.assessment } : {}),
        ...(input.plan !== undefined ? { plan: input.plan } : {}),
        ...(input.openQuestions !== undefined ? { openQuestions: input.openQuestions } : {}),
        ...(input.recommendedDocuments !== undefined ? { recommendedDocuments: input.recommendedDocuments } : {}),
      });
    }),

  /**
   * Single-lane LLM analysis generation (Fork E — Claude default, attorney-invoked, NO
   * multi-lane auto-dispatch). Runs through executeCanonicalMutation so the matter state
   * auto-injects (L1-2) and the two-transaction job lifecycle applies. The analysis is
   * internal, categorically NON-SENDABLE work-product (Fork C/F). The conflicts check is
   * deterministic + DB-side (Fork G) — this generation prompt carries only THIS matter's
   * own parties, never other matters' conflict-hit details.
   */
  generateAnalysis: protectedProcedure
    .input(z.object({ matterId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const matter = await assertMatterOwned(input.matterId, ctx.userId);
      const parties = await listPartiesForMatter(input.matterId, ctx.userId);

      let analysisId = '';
      const result = await executeCanonicalMutation({
        userId: ctx.userId,
        jobType: 'matter_analysis',
        modelString: PRIMARY_DRAFTER_MODEL, // Claude default single lane (Fork E)
        matterId: input.matterId,
        txn1Enqueue: async (jobId) => {
          const row = await insertMatterAnalysis({
            userId: ctx.userId,
            matterId: input.matterId,
            modelLane: 'single',
            generatedByJobId: jobId,
          });
          analysisId = row.id;
          return { jobId };
        },
        buildLlmParams: (_jobId) => ({
          systemPrompt: [
            'You are assisting a licensed attorney with an INTERNAL, pre-drafting matter analysis.',
            'This is attorney work-product — it is NOT a client-facing or sendable document.',
            'You do NOT make business or legal decisions. You surface, for the attorney to decide:',
            'an assessment of the matter, a recommended plan of approach, the open questions that',
            'must be resolved, and the candidate documents that may need to be drafted.',
            'Return JSON with: assessment (string), plan (string), openQuestions (array of strings),',
            'and recommendedDocuments (array of { documentType, title, rationale }).',
          ].join('\n'),
          userPrompt: [
            `Matter: ${matter.title}`,
            parties.length > 0
              ? `\nParties:\n${parties.map((p) => `- ${p.role}: ${p.displayName}`).join('\n')}`
              : '\n(No parties recorded yet.)',
          ].join('\n'),
          temperature: 0.2,
          maxTokens: 4096,
          structuredOutputSchema: AnalysisGenerationSchema,
        }),
        txn2Commit: async ({ output }) => {
          // Parse-or-throw. Malformed/empty output throws here, which the canonical
          // mutation converts into txn2Revert + job-failed (no silent empty commit).
          const parsed = parseGeneratedAnalysis(output);
          await updateMatterAnalysisContent(analysisId, ctx.userId, parsed);
        },
        txn2Revert: async () => {
          // A failed/malformed generation must not leave a usable-looking empty draft
          // behind; supersede the txn1-created row so it is not the active analysis.
          if (analysisId) {
            await supersedeAnalysis({ analysisId, userId: ctx.userId });
          }
        },
        telemetryCtx: { userId: ctx.userId, matterId: input.matterId, documentId: null, jobId: null },
      });

      if (result.status !== 'completed') {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'ANALYSIS_GENERATION_FAILED: analysis generation did not produce a usable result. Please try again.',
        });
      }
      return getActiveAnalysisForMatter(input.matterId, ctx.userId);
    }),

  getAnalysis: protectedProcedure
    .input(z.object({ matterId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return getActiveAnalysisForMatter(input.matterId, ctx.userId);
    }),

  lockPlan: protectedProcedure
    .input(z.object({ analysisId: z.string().uuid(), rationale: z.string().nullable().optional() }))
    .mutation(async ({ ctx, input }) => {
      return lockPlan({
        analysisId: input.analysisId,
        userId: ctx.userId,
        ...(input.rationale !== undefined ? { rationale: input.rationale } : {}),
      });
    }),
});
