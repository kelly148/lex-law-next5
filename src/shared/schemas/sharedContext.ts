/**
 * Shared-context conversation substrate — FOLD-L1-3 (Appendix C.6).
 *
 * The "everyone up to speed" package a toggled-on reviewer lane receives when it joins a
 * matter: thread + materials + matter-state, assembled into ONE coherent, bounded, lane-
 * aware structure — NOT a raw dump. This module defines the shape only; assembly +
 * owner-scoping live in the server sharedContext service.
 *
 * "Not a raw dump": materials are carried as prioritized METADATA (id/filename/tokens/
 * priority), not concatenated blobs — the actual material text continues to flow through
 * the existing context pipeline / L1-2 injection at dispatch time. The matter-state arrives
 * as the curated L1-2 block, and the thread as a bounded recent-iteration summary.
 *
 * Reuses the L1-1 read-contract building blocks (MatterIdentity, OperativeDocument).
 */

import { z } from 'zod';
import { MatterIdentitySchema, OperativeDocumentSchema } from './matterState.js';

export const ThreadIterationSchema = z.object({
  iterationNumber: z.number().int().nonnegative(),
  versionNumber: z.number().int().nonnegative(),
  createdAt: z.date(),
});
export type ThreadIteration = z.infer<typeof ThreadIterationSchema>;

export const ThreadSummarySchema = z.object({
  iterationCount: z.number().int().nonnegative(),
  versionCount: z.number().int().nonnegative(),
  latestVersionNumber: z.number().int().nonnegative().nullable(),
  recentIterations: z.array(ThreadIterationSchema),
});
export type ThreadSummary = z.infer<typeof ThreadSummarySchema>;

export const SharedMaterialSchema = z.object({
  materialId: z.string().uuid(),
  filename: z.string().nullable(),
  tokenEstimate: z.number().int().nonnegative(),
  contextPriority: z.enum(['pinned', 'recency']),
  pinned: z.boolean(),
});
export type SharedMaterial = z.infer<typeof SharedMaterialSchema>;

export const SharedMaterialsSchema = z.object({
  includedMaterials: z.array(SharedMaterialSchema),
  includedSiblingCount: z.number().int().nonnegative(),
  excludedCount: z.number().int().nonnegative(),
  truncatedCount: z.number().int().nonnegative(),
  assembledTokens: z.number().int().nonnegative(),
  budgetTokens: z.number().int().nonnegative(),
});
export type SharedMaterials = z.infer<typeof SharedMaterialsSchema>;

export const SharedContextPackageSchema = z.object({
  matter: MatterIdentitySchema,
  operativeDocument: OperativeDocumentSchema.nullable(),
  /** The reviewer lanes toggled on / joining (e.g. ['gpt','claude']). */
  lanes: z.array(z.string()),
  /** The curated L1-2 matter-state preamble (string). */
  matterStateBlock: z.string(),
  materials: SharedMaterialsSchema,
  thread: ThreadSummarySchema,
  /** Estimated total token footprint of the assembled package. */
  assembledTokens: z.number().int().nonnegative(),
});
export type SharedContextPackage = z.infer<typeof SharedContextPackageSchema>;
