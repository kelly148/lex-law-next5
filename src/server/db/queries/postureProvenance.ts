/**
 * posture_provenance query wrapper — CHAT-UI-1 W2 (PROVENANCE-LEDGER-1).
 *
 * Ch 35.1 Zod Wall: the ONLY code path that reads posture_provenance; every row parses through
 * PostureProvenanceRowSchema before returning.
 *
 * APPEND-ONLY: this module exposes insert + read only. There is no update or delete — the ledger is
 * immutable once written (legal audit record; permanent retention). Each insert extends the per-matter
 * tamper-evident hash chain (prevHash -> entryHash) and is performed inside a transaction so the
 * read-last-then-append is atomic.
 *
 * Owner scoping uses ownerScope() (FOLD-AUTH-1 chokepoint), never an inline owner-equality filter.
 * Entirely behind CHAT_UI_1_ENABLED; the best-effort recorder no-ops if the table is not yet migrated.
 */
import { v4 as uuidv4 } from 'uuid';
import { and, eq, asc, desc } from 'drizzle-orm';
import { ZodError } from 'zod';
import { db } from '../connection.js';
import { postureProvenance, type NewPostureProvenance } from '../schema.js';
import { ownerScope } from '../ownerScope.js';
import {
  PostureProvenanceRowSchema,
  type PostureProvenanceRow,
} from '../../../shared/schemas/postureProvenance.js';
import { entryToContent, type PostureProvenanceContent } from '../../../shared/posture/provenanceRow.js';
import type { Posture } from '../../../shared/posture/postureCoherence.js';
import type { ProvenanceEntry } from '../../../shared/posture/provenance.js';
import {
  computeEntryHash,
  verifyChain,
  GENESIS_PREV_HASH,
  type ChainVerification,
} from '../provenanceHash.js';
import { emitTelemetry } from '../../telemetry/emitTelemetry.js';

export interface ProvenanceContext {
  userId: string;
  matterId: string;
  documentId?: string | null;
  /** Optional explicit row id (else a uuid is generated). */
  id?: string;
}

/**
 * PURE: build the durable insert row for `entry`, extending the chain from `prev` (the matter's last
 * row, or null for the genesis row). Computes seq, prevHash, and the signed entryHash. Testable
 * without a database.
 */
export function buildProvenanceRow(
  entry: ProvenanceEntry,
  ctx: ProvenanceContext,
  prev: { seq: number; entryHash: string } | null,
): NewPostureProvenance {
  const seq = prev ? prev.seq + 1 : 0;
  const prevHash = prev ? prev.entryHash : GENESIS_PREV_HASH;
  const content = entryToContent(entry, { matterId: ctx.matterId, documentId: ctx.documentId ?? null, seq });
  return {
    id: ctx.id ?? uuidv4(),
    userId: ctx.userId,
    matterId: ctx.matterId,
    documentId: ctx.documentId ?? null,
    seq,
    eventClass: content.eventClass,
    act: content.act,
    actor: content.actor,
    sliderPosition: content.sliderPosition,
    triggerSource: content.triggerSource,
    confirmedAt: content.confirmedAt,
    issuerEntity: content.issuerEntity,
    issuerCapacity: content.issuerCapacity,
    issuerDisplay: content.issuerDisplay,
    privilege: content.privilege,
    recipient: content.recipient,
    priorTriple: content.priorTriple,
    verdictSeverity: content.verdictSeverity,
    findings: content.findings,
    prevHash,
    entryHash: computeEntryHash(prevHash, content),
  };
}

/**
 * Normalize the stored (Zod-parsed) triple to the W1 Posture shape. The only divergence is the
 * optional `display` (zod infers `string | undefined`; Posture's `display?: string` excludes
 * undefined under exactOptionalPropertyTypes), so rebuild it with a conditional spread.
 */
function normalizeTriple(t: PostureProvenanceRow['priorTriple']): Posture | null {
  if (t === null) return null;
  return {
    issuer: {
      entity: t.issuer.entity,
      capacity: t.issuer.capacity,
      ...(t.issuer.display !== undefined ? { display: t.issuer.display } : {}),
    },
    privilege: t.privilege,
    recipient: t.recipient,
  };
}

/** PURE: project a stored row back to its hashable content (for chain verification). */
export function rowToContent(row: PostureProvenanceRow): PostureProvenanceContent {
  return {
    matterId: row.matterId,
    documentId: row.documentId,
    seq: row.seq,
    eventClass: row.eventClass,
    act: row.act,
    actor: row.actor,
    sliderPosition: row.sliderPosition,
    triggerSource: row.triggerSource,
    confirmedAt: row.confirmedAt,
    issuerEntity: row.issuerEntity,
    issuerCapacity: row.issuerCapacity,
    issuerDisplay: row.issuerDisplay,
    privilege: row.privilege,
    recipient: row.recipient,
    priorTriple: normalizeTriple(row.priorTriple),
    verdictSeverity: row.verdictSeverity,
    findings: row.findings,
  };
}

/**
 * The append seam: read the matter's last row, then insert the chained row. Injectable so the append
 * logic is unit-testable with an in-memory writer (no database). Production uses a transaction.
 */
export interface ProvenanceWriter {
  readLast(matterId: string, userId: string): Promise<{ seq: number; entryHash: string } | null>;
  insert(row: NewPostureProvenance): Promise<void>;
}

type Executor = Pick<typeof db, 'select' | 'insert'>;

function drizzleWriter(executor: Executor): ProvenanceWriter {
  return {
    readLast: async (matterId, userId) => {
      const rows = await executor
        .select({ seq: postureProvenance.seq, entryHash: postureProvenance.entryHash })
        .from(postureProvenance)
        .where(and(ownerScope(postureProvenance.userId, userId), eq(postureProvenance.matterId, matterId)))
        .orderBy(desc(postureProvenance.seq))
        .limit(1);
      const r = rows[0];
      return r ? { seq: r.seq, entryHash: r.entryHash } : null;
    },
    insert: async (row) => {
      await executor.insert(postureProvenance).values(row);
    },
  };
}

async function appendWith(writer: ProvenanceWriter, entry: ProvenanceEntry, ctx: ProvenanceContext): Promise<string> {
  const last = await writer.readLast(ctx.matterId, ctx.userId);
  const row = buildProvenanceRow(entry, ctx, last);
  await writer.insert(row);
  return row.id;
}

/**
 * Append a provenance entry to the matter's chain (FAIL-VISIBLY: throws on failure). Pass a `writer`
 * to inject an in-memory seam in tests; production reads-last-then-appends inside a transaction so the
 * sequence + chain are consistent under concurrency.
 */
export async function insertPostureProvenanceEntry(
  entry: ProvenanceEntry,
  ctx: ProvenanceContext,
  writer?: ProvenanceWriter,
): Promise<string> {
  if (writer) return appendWith(writer, entry, ctx);
  return db.transaction(async (tx) => appendWith(drizzleWriter(tx), entry, ctx));
}

function parseRow(raw: unknown, context: { userId: string }): PostureProvenanceRow {
  try {
    return PostureProvenanceRowSchema.parse(raw);
  } catch (err) {
    if (err instanceof ZodError) {
      emitTelemetry(
        'zod_parse_failed',
        {
          schemaName: 'PostureProvenanceRowSchema',
          tableName: 'posture_provenance',
          errorPath: err.errors.map((e) => e.path.join('.')).join(', '),
          errorMessage: err.message,
        },
        { userId: context.userId },
      );
    }
    throw err;
  }
}

/** The per-matter ledger, oldest-first (chain order). Owner-scoped via ownerScope(); Zod-walled. */
export async function listPostureProvenanceForMatter(
  matterId: string,
  userId: string,
): Promise<PostureProvenanceRow[]> {
  const rows = await db
    .select()
    .from(postureProvenance)
    .where(and(ownerScope(postureProvenance.userId, userId), eq(postureProvenance.matterId, matterId)))
    .orderBy(asc(postureProvenance.seq));
  return rows.map((r) => parseRow(r, { userId }));
}

/** Recompute + verify the matter's tamper-evident chain (detects any altered/inserted/reordered row). */
export async function verifyPostureProvenanceChainForMatter(
  matterId: string,
  userId: string,
): Promise<ChainVerification> {
  const rows = await listPostureProvenanceForMatter(matterId, userId);
  return verifyChain(rows.map((row) => ({ content: rowToContent(row), prevHash: row.prevHash, entryHash: row.entryHash })));
}

/**
 * BEST-EFFORT append — never throws. Use from governing flows so the audit write can NEVER break the
 * operation it records (e.g. when posture_provenance is not yet migrated on this environment, the
 * write no-ops with a telemetry breadcrumb). For the path that must observe failure, call
 * insertPostureProvenanceEntry directly.
 */
export async function recordPostureProvenance(entry: ProvenanceEntry, ctx: ProvenanceContext): Promise<void> {
  try {
    await insertPostureProvenanceEntry(entry, ctx);
  } catch (err) {
    void emitTelemetry(
      'procedure_error',
      {
        procedureName: 'recordPostureProvenance',
        errorCode: 'PROVENANCE_WRITE_FAILED',
        errorMessage: err instanceof Error ? err.message : String(err),
      },
      { userId: ctx.userId },
    );
  }
}
