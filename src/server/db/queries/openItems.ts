/**
 * open_items query wrapper — FOLD-L1-1 (Fork B + Fork D).
 *
 * Ch 35.1 Zod Wall: the ONLY read path for open_items; every row parses through
 * OpenItemRowSchema before returning.
 *
 * Owner scoping uses ownerScope() (FOLD-AUTH-1 Inc 2 chokepoint), never an inline
 * eq(<table>.userId, ...) filter.
 *
 * DEFAULT-SAFE (disposition item 6): auto-detection MAY create (autoRegisterOpenItem)
 * or refresh (refreshOpenItemLastSeen) an item, but there is NO auto-close path — only
 * the attorney flows (resolveOpenItem / withdrawOpenItem) change an item out of 'open',
 * and they tag statusSource='attorney' and write a transactional audit-disposition row.
 */

import { v4 as uuidv4 } from 'uuid';
import { and, eq, desc, sql } from 'drizzle-orm';
import { db } from '../connection.js';
import { openItems } from '../schema.js';
import { ownerScope } from '../ownerScope.js';
import { insertAuditEvent } from './auditEvents.js';
import {
  OpenItemRowSchema,
  type OpenItemRow,
  type OpenItemSeverity,
  type OpenItemConfidence,
} from '../../../shared/schemas/openItems.js';
import { emitTelemetry } from '../../telemetry/emitTelemetry.js';
import { ZodError } from 'zod';

function parseOpenItemRow(raw: unknown, ctx: { userId: string }): OpenItemRow {
  try {
    return OpenItemRowSchema.parse(raw);
  } catch (err) {
    if (err instanceof ZodError) {
      void emitTelemetry(
        'zod_parse_failed',
        {
          schemaName: 'OpenItemRowSchema',
          tableName: 'open_items',
          errorPath: err.errors[0]?.path.join('.') ?? '',
          errorMessage: err.errors[0]?.message ?? 'ZodError',
        },
        { userId: ctx.userId, matterId: null, documentId: null, jobId: null },
      );
    }
    throw err;
  }
}

// ============================================================
// Reads (owner-scoped)
// ============================================================

export async function getOpenItemById(
  id: string,
  userId: string,
): Promise<OpenItemRow | null> {
  const rows = await db
    .select()
    .from(openItems)
    .where(and(eq(openItems.id, id), ownerScope(openItems.userId, userId)))
    .limit(1);
  if (rows.length === 0) return null;
  return parseOpenItemRow(rows[0]!, { userId });
}

/** All open_items rows for a matter (any status), newest first. */
export async function listOpenItemsForMatter(
  matterId: string,
  userId: string,
): Promise<OpenItemRow[]> {
  const rows = await db
    .select()
    .from(openItems)
    .where(and(ownerScope(openItems.userId, userId), eq(openItems.matterId, matterId)))
    .orderBy(desc(openItems.createdAt));
  return rows.map((r) => parseOpenItemRow(r, { userId }));
}

/** Open (status='open') items for a matter, newest first. */
export async function listOpenOpenItemsForMatter(
  matterId: string,
  userId: string,
): Promise<OpenItemRow[]> {
  const rows = await db
    .select()
    .from(openItems)
    .where(
      and(
        ownerScope(openItems.userId, userId),
        eq(openItems.matterId, matterId),
        eq(openItems.status, 'open'),
      ),
    )
    .orderBy(desc(openItems.createdAt));
  return rows.map((r) => parseOpenItemRow(r, { userId }));
}

/**
 * Count of OPEN, BLOCKER-severity items for a matter — the safe-to-send signal
 * (>0 => 'blocked'). Owner-scoped.
 */
export async function countOpenBlockers(
  matterId: string,
  userId: string,
): Promise<number> {
  const rows = await db
    .select({ n: sql<number>`count(*)` })
    .from(openItems)
    .where(
      and(
        ownerScope(openItems.userId, userId),
        eq(openItems.matterId, matterId),
        eq(openItems.status, 'open'),
        eq(openItems.severity, 'blocker'),
      ),
    );
  return Number(rows[0]?.n ?? 0);
}

// ============================================================
// Writes
// ============================================================

/**
 * Auto-register an open item from detection (statusSource='auto'). The caller is
 * responsible for severity gating (disposition item 6: BLOCKER and material
 * SUBSTANTIVE auto-register; POLISH does not). Never closes anything.
 */
export async function autoRegisterOpenItem(data: {
  id?: string;
  userId: string;
  matterId: string;
  documentId?: string | null;
  category: string;
  severity: OpenItemSeverity;
  summary: string;
  origin: string;
  confidence?: OpenItemConfidence | null;
  requiresAttorneyConfirmation?: boolean;
  sourceSuggestionId?: string | null;
  reviewSessionId?: string | null;
  versionId?: string | null;
}): Promise<OpenItemRow> {
  const id = data.id ?? uuidv4();
  await db.insert(openItems).values({
    id,
    userId: data.userId,
    matterId: data.matterId,
    documentId: data.documentId ?? null,
    category: data.category,
    severity: data.severity,
    summary: data.summary,
    status: 'open',
    statusSource: 'auto',
    origin: data.origin,
    confidence: data.confidence ?? null,
    requiresAttorneyConfirmation: data.requiresAttorneyConfirmation ?? false,
    sourceSuggestionId: data.sourceSuggestionId ?? null,
    reviewSessionId: data.reviewSessionId ?? null,
    versionId: data.versionId ?? null,
    lastSeenAt: new Date(),
  });
  const row = await getOpenItemById(id, data.userId);
  if (!row) throw new Error(`autoRegisterOpenItem: row not found after insert (id=${id})`);
  return row;
}

/**
 * FOLD-ORCH-1 Inc3 (Fork E): register a DIVERGENT reviewer open item from an orchestration run.
 * statusSource='auto' + requiresAttorneyConfirmation=true; the content-preserving payload (per-
 * reviewer positions + synthesis + source session) goes in `detail`. Inherits the registry's
 * never-auto-close guarantee — only an explicit attorney resolve/withdraw changes its status, so
 * a later orchestration pass that omits this divergence does NOT close it.
 */
export async function registerDivergentOpenItem(params: {
  id?: string;
  userId: string;
  matterId: string;
  documentId?: string | null;
  severity: OpenItemSeverity;
  summary: string;
  detail: unknown;
  reviewSessionId?: string | null;
  versionId?: string | null;
}): Promise<OpenItemRow> {
  const id = params.id ?? uuidv4();
  await db.insert(openItems).values({
    id,
    userId: params.userId,
    matterId: params.matterId,
    documentId: params.documentId ?? null,
    category: 'divergent_reviewer_feedback',
    severity: params.severity,
    summary: params.summary,
    status: 'open',
    statusSource: 'auto',
    origin: 'orchestration',
    confidence: null,
    requiresAttorneyConfirmation: true,
    sourceSuggestionId: null,
    reviewSessionId: params.reviewSessionId ?? null,
    versionId: params.versionId ?? null,
    lastSeenAt: new Date(),
    detail: params.detail,
  });
  const row = await getOpenItemById(id, params.userId);
  if (!row) throw new Error(`registerDivergentOpenItem: row not found after insert (id=${id})`);
  return row;
}

/**
 * Auto-detection refresh: bump lastSeenAt only. NEVER changes status — so it can never
 * close an attorney-opened/confirmed item (disposition item 6).
 */
export async function refreshOpenItemLastSeen(id: string, userId: string): Promise<void> {
  await db
    .update(openItems)
    .set({ lastSeenAt: new Date() })
    .where(and(eq(openItems.id, id), ownerScope(openItems.userId, userId)));
}

/**
 * Attorney resolves an open item — a "new flow" writing the status change and its
 * immutable audit-disposition row in ONE transaction (disposition item 5). The item is
 * linked to that audit row (resolvedByEventId) and tagged statusSource='attorney'.
 * `action` is 'resolve' (status='resolved') or 'withdraw' (status='withdrawn').
 */
async function closeOpenItemByAttorney(
  params: {
    id: string;
    userId: string;
    matterId: string;
    documentId?: string | null;
    rationale?: string | null;
  },
  action: 'resolve' | 'withdraw',
): Promise<OpenItemRow> {
  const status = action === 'resolve' ? 'resolved' : 'withdrawn';
  const eventId = uuidv4();
  await db.transaction(async (tx) => {
    await insertAuditEvent(
      {
        id: eventId,
        userId: params.userId,
        matterId: params.matterId,
        documentId: params.documentId ?? null,
        eventType: 'disposition',
        actor: 'attorney',
        summary: `Open item ${action}d`,
        targetType: 'open_item',
        targetId: params.id,
        action,
        rationale: params.rationale ?? null,
        scope: params.documentId ? 'document' : 'matter',
      },
      tx,
    );
    await tx
      .update(openItems)
      .set({
        status,
        statusSource: 'attorney',
        resolvedByEventId: eventId,
        resolutionRationale: params.rationale ?? null,
      })
      .where(and(eq(openItems.id, params.id), ownerScope(openItems.userId, params.userId)));
  });
  const row = await getOpenItemById(params.id, params.userId);
  if (!row) throw new Error(`closeOpenItemByAttorney: row not found after update (id=${params.id})`);
  return row;
}

export function resolveOpenItem(params: {
  id: string;
  userId: string;
  matterId: string;
  documentId?: string | null;
  rationale?: string | null;
}): Promise<OpenItemRow> {
  return closeOpenItemByAttorney(params, 'resolve');
}

export function withdrawOpenItem(params: {
  id: string;
  userId: string;
  matterId: string;
  documentId?: string | null;
  rationale?: string | null;
}): Promise<OpenItemRow> {
  return closeOpenItemByAttorney(params, 'withdraw');
}
