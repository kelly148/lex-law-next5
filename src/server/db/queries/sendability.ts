/**
 * Export-safety / outbound-readiness query wrappers — FOLD-SEND-1 (Increment 1: data core).
 *
 * Ch 35.1 Zod Wall: the ONLY read path for these tables; every row parses through its schema.
 *
 * Scoping:
 *  - sendability_rule / jurisdiction_rule are FIRM-LEVEL config (owner-null firm defaults, no UI in
 *    v1). Reads return the firm defaults via isNull(userId) — not client-owned data, so they do not
 *    go through ownerScope().
 *  - sendability_override / sendability_evaluation are owner-owned client data and are scoped via
 *    ownerScope() (FOLD-AUTH-1 chokepoint), never an inline owner filter.
 *
 * Inc 1 is data core only: these wrappers exist but are not yet wired into any production path
 * (shadow-mode logging + the override mutation arrive in Inc 2/3). No behavior change.
 */

import { v4 as uuidv4 } from 'uuid';
import { and, eq, asc, desc, isNull } from 'drizzle-orm';
import { db } from '../connection.js';
import { sendabilityRule, jurisdictionRule, sendabilityOverride, sendabilityEvaluation } from '../schema.js';
import { ownerScope } from '../ownerScope.js';
import {
  SendabilityRuleRowSchema,
  JurisdictionRuleRowSchema,
  SendabilityOverrideRowSchema,
  SendabilityEvaluationRowSchema,
  type SendabilityRuleRow,
  type JurisdictionRuleRow,
  type SendabilityOverrideRow,
  type SendabilityEvaluationRow,
  type SendabilityCheckCategory,
  type SendabilityVerdict,
  type SendabilityOverrideReason,
} from '../../../shared/schemas/sendability.js';
import { emitTelemetry } from '../../telemetry/emitTelemetry.js';
import { ZodError } from 'zod';

function parseRow<T>(schema: { parse: (raw: unknown) => T }, raw: unknown, schemaName: string, tableName: string, userId: string): T {
  try {
    return schema.parse(raw);
  } catch (err) {
    if (err instanceof ZodError) {
      void emitTelemetry(
        'zod_parse_failed',
        { schemaName, tableName, errorPath: err.errors[0]?.path.join('.') ?? '', errorMessage: err.errors[0]?.message ?? 'ZodError' },
        { userId, matterId: null, documentId: null, jobId: null },
      );
    }
    throw err;
  }
}

// ============================================================
// Firm-level config reads (firm defaults: userId IS NULL)
// ============================================================

/** All firm-default sendability rules (which checks are enabled + at what level). */
export async function listFirmSendabilityRules(userId: string): Promise<SendabilityRuleRow[]> {
  const rows = await db.select().from(sendabilityRule).where(isNull(sendabilityRule.userId)).orderBy(asc(sendabilityRule.category));
  return rows.map((r) => parseRow(SendabilityRuleRowSchema, r, 'SendabilityRuleRowSchema', 'sendability_rule', userId));
}

/** Firm-default jurisdiction rules, optionally filtered to one document type. */
export async function listFirmJurisdictionRules(userId: string, documentType?: string): Promise<JurisdictionRuleRow[]> {
  const where = documentType !== undefined
    ? and(isNull(jurisdictionRule.userId), eq(jurisdictionRule.documentType, documentType))
    : isNull(jurisdictionRule.userId);
  const rows = await db.select().from(jurisdictionRule).where(where).orderBy(asc(jurisdictionRule.jurisdiction), asc(jurisdictionRule.requirement));
  return rows.map((r) => parseRow(JurisdictionRuleRowSchema, r, 'JurisdictionRuleRowSchema', 'jurisdiction_rule', userId));
}

// ============================================================
// sendability_override (owner-scoped; APPEND-ONLY)
// ============================================================

export async function getSendabilityOverrideById(id: string, userId: string): Promise<SendabilityOverrideRow | null> {
  const rows = await db.select().from(sendabilityOverride).where(and(eq(sendabilityOverride.id, id), ownerScope(sendabilityOverride.userId, userId))).limit(1);
  if (rows.length === 0) return null;
  return parseRow(SendabilityOverrideRowSchema, rows[0]!, 'SendabilityOverrideRowSchema', 'sendability_override', userId);
}

/** Overrides recorded for a specific version (newest first). The export check matches on
 *  versionId + contentHash, so an override never carries across a content/version change. */
export async function listSendabilityOverridesForVersion(versionId: string, userId: string): Promise<SendabilityOverrideRow[]> {
  const rows = await db.select().from(sendabilityOverride).where(and(ownerScope(sendabilityOverride.userId, userId), eq(sendabilityOverride.versionId, versionId))).orderBy(desc(sendabilityOverride.createdAt));
  return rows.map((r) => parseRow(SendabilityOverrideRowSchema, r, 'SendabilityOverrideRowSchema', 'sendability_override', userId));
}

export async function insertSendabilityOverride(data: {
  id?: string;
  userId: string;
  matterId: string;
  documentId: string;
  versionId: string;
  contentHash: string;
  category: SendabilityCheckCategory;
  blockPayload?: unknown;
  reasonCode: SendabilityOverrideReason;
  reasonText?: string | null;
}): Promise<SendabilityOverrideRow> {
  // R2 #4 no-migration invariant (runtime hardening, complements the guard test): 'unverified_kb' is
  // an ENGINE-ONLY warn category, never persisted to the sendability_override.category mysqlEnum
  // (overrides are block-only; a warn is never overridden). Reject it here so it can never reach the
  // DB enum without a conscious migration. The throw also narrows data.category to the column's type.
  if (data.category === 'unverified_kb') {
    throw new Error('unverified_kb is a warn-only diligence signal and cannot be overridden (it never blocks export).');
  }
  const id = data.id ?? uuidv4();
  await db.insert(sendabilityOverride).values({
    id,
    userId: data.userId,
    matterId: data.matterId,
    documentId: data.documentId,
    versionId: data.versionId,
    contentHash: data.contentHash,
    category: data.category,
    blockPayload: data.blockPayload ?? null,
    reasonCode: data.reasonCode,
    reasonText: data.reasonText ?? null,
  });
  const row = await getSendabilityOverrideById(id, data.userId);
  if (!row) throw new Error(`insertSendabilityOverride: row not found after insert (id=${id})`);
  return row;
}

// ============================================================
// sendability_evaluation (owner-scoped; APPEND-ONLY log; incl. shadow mode)
// ============================================================

export async function getSendabilityEvaluationById(id: string, userId: string): Promise<SendabilityEvaluationRow | null> {
  const rows = await db.select().from(sendabilityEvaluation).where(and(eq(sendabilityEvaluation.id, id), ownerScope(sendabilityEvaluation.userId, userId))).limit(1);
  if (rows.length === 0) return null;
  return parseRow(SendabilityEvaluationRowSchema, rows[0]!, 'SendabilityEvaluationRowSchema', 'sendability_evaluation', userId);
}

export async function listSendabilityEvaluationsForVersion(versionId: string, userId: string): Promise<SendabilityEvaluationRow[]> {
  const rows = await db.select().from(sendabilityEvaluation).where(and(ownerScope(sendabilityEvaluation.userId, userId), eq(sendabilityEvaluation.versionId, versionId))).orderBy(desc(sendabilityEvaluation.createdAt));
  return rows.map((r) => parseRow(SendabilityEvaluationRowSchema, r, 'SendabilityEvaluationRowSchema', 'sendability_evaluation', userId));
}

export async function insertSendabilityEvaluation(data: {
  id?: string;
  userId: string;
  matterId: string;
  documentId: string;
  versionId: string;
  verdict: SendabilityVerdict;
  blocks: unknown[];
  warnings: unknown[];
  llmComponentUsed: boolean;
  degraded: 'none' | 'partial' | 'error';
  durationMs: number;
  enforced: boolean;
}): Promise<SendabilityEvaluationRow> {
  const id = data.id ?? uuidv4();
  await db.insert(sendabilityEvaluation).values({
    id,
    userId: data.userId,
    matterId: data.matterId,
    documentId: data.documentId,
    versionId: data.versionId,
    verdict: data.verdict,
    blocks: data.blocks,
    warnings: data.warnings,
    llmComponentUsed: data.llmComponentUsed,
    degraded: data.degraded,
    durationMs: data.durationMs,
    enforced: data.enforced,
  });
  const row = await getSendabilityEvaluationById(id, data.userId);
  if (!row) throw new Error(`insertSendabilityEvaluation: row not found after insert (id=${id})`);
  return row;
}
