/**
 * Reusable-artifact tRPC procedures — FOLD-L1-4 (MM-8a registry + MM-8b cross-matter gate).
 *
 *   reusableArtifact.create   — register a reusable artifact (scope defaults matter_only)
 *   reusableArtifact.list     — list the attorney's reusable artifacts (optional kind)
 *   reusableArtifact.setScope — explicit attorney act: widen/narrow cross-matter scope
 *   reusableArtifact.invoke   — invoke into a target matter THROUGH the contamination gate
 *
 * All owner-scoped (userId from ctx.userId, never input). The cross-matter gate
 * (matter-only default; explicit per-use opt-in; fail-visibly audited) lives in
 * src/server/reusableArtifacts/index.ts.
 */

import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../trpc.js';
import {
  insertReusableArtifact,
  listReusableArtifactsForUser,
  setReusableArtifactScope,
  getReusableArtifactById,
} from '../db/queries/reusableArtifacts.js';
import { invokeReusableArtifact } from '../reusableArtifacts/index.js';

const KIND = z.enum(['template', 'clause', 'memo', 'snippet']);
const SCOPE = z.enum(['matter_only', 'cross_matter']);

export const reusableArtifactRouter = router({
  create: protectedProcedure
    .input(
      z.object({
        kind: KIND,
        title: z.string().min(1).max(256),
        body: z.string().min(1),
        originMatterId: z.string().uuid().nullable().optional(),
        sourceDocumentId: z.string().uuid().nullable().optional(),
        // Anti-contamination: cross_matter is an explicit choice; default matter_only.
        reusableScope: SCOPE.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return insertReusableArtifact({
        userId: ctx.userId,
        kind: input.kind,
        title: input.title,
        body: input.body,
        originMatterId: input.originMatterId ?? null,
        sourceDocumentId: input.sourceDocumentId ?? null,
        ...(input.reusableScope !== undefined ? { reusableScope: input.reusableScope } : {}),
      });
    }),

  list: protectedProcedure
    .input(z.object({ kind: KIND.optional() }).optional())
    .query(async ({ ctx, input }) => {
      return listReusableArtifactsForUser(
        ctx.userId,
        input?.kind !== undefined ? { kind: input.kind } : {},
      );
    }),

  setScope: protectedProcedure
    .input(z.object({ artifactId: z.string().uuid(), reusableScope: SCOPE }))
    .mutation(async ({ ctx, input }) => {
      const existing = await getReusableArtifactById(input.artifactId, ctx.userId);
      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Reusable artifact not found' });
      }
      const updated = await setReusableArtifactScope(input.artifactId, ctx.userId, input.reusableScope);
      if (!updated) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Reusable artifact not found' });
      }
      return updated;
    }),

  invoke: protectedProcedure
    .input(
      z.object({
        artifactId: z.string().uuid(),
        targetMatterId: z.string().uuid(),
        // Explicit per-use opt-in is required to cross matters (gate enforces it).
        explicitOptIn: z.boolean().default(false),
        rationale: z.string().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return invokeReusableArtifact({
        artifactId: input.artifactId,
        targetMatterId: input.targetMatterId,
        userId: ctx.userId,
        explicitOptIn: input.explicitOptIn,
        ...(input.rationale !== undefined ? { rationale: input.rationale } : {}),
      });
    }),
});
