/**
 * deedSignoff query layer — D3-SIGNOFF (source-anchored deed sign-off), A.1 Inc 4.
 *
 * APPEND-ONLY writes + a content-hash-bound "is there a valid sign-off?" lookup for the ENFORCE gate. Owner
 * filter goes through ownerScope() (the FOLD-AUTH chokepoint); userId is always ctx.userId, never an input. The
 * gate lookup selects ONLY the columns it needs (id + verdict) so the export path never Zod-parses a JSON blob
 * (a parse throw there would break a legitimate export) — fail-closed is "no valid sign-off found".
 */
import { and, desc, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '../connection.js';
import { deedSignoff } from '../schema.js';
import { ownerScope } from '../ownerScope.js';

export interface InsertDeedSignoffInput {
  userId: string;
  matterId: string;
  documentId: string;
  documentVersionId: string;
  gateMode: 'observe' | 'enforce';
  verdict: 'pass' | 'blocked' | 'overridden';
  comparatorPassed: boolean;
  comparatorVersion: string;
  assembledContentHash: string;
  sourceFactsHash: string;
  forkProvenance: string;
  attestations: unknown;
  comparison: unknown;
  override: unknown;
  attorneyUserId: string;
}

/** APPEND-ONLY insert of a source-extracted-facts sign-off record. Returns the new row id. */
export async function insertDeedSignoff(data: InsertDeedSignoffInput): Promise<string> {
  const id = randomUUID();
  await db.insert(deedSignoff).values({
    id,
    userId: data.userId,
    matterId: data.matterId,
    documentId: data.documentId,
    documentVersionId: data.documentVersionId,
    gateMode: data.gateMode,
    verdict: data.verdict,
    comparatorPassed: data.comparatorPassed,
    comparatorVersion: data.comparatorVersion,
    assembledContentHash: data.assembledContentHash,
    sourceFactsHash: data.sourceFactsHash,
    forkProvenance: data.forkProvenance,
    attestations: data.attestations,
    comparison: data.comparison,
    override: data.override ?? null,
    attorneyUserId: data.attorneyUserId,
  });
  return id;
}

/**
 * Is there a CURRENT valid sign-off for this version? The latest deed_signoff row whose assembledContentHash
 * matches the CURRENT assembled content (content-hash-bound — a material change supersedes it) and whose verdict
 * is a sign-off (pass|overridden, never blocked). Owner-scoped. Returns the row id + verdict, or null.
 */
export async function getValidDeedSignoffForVersion(
  userId: string,
  documentVersionId: string,
  assembledContentHash: string,
): Promise<{ id: string; verdict: string } | null> {
  const rows = await db
    .select({ id: deedSignoff.id, verdict: deedSignoff.verdict, createdAt: deedSignoff.createdAt })
    .from(deedSignoff)
    .where(
      and(
        ownerScope(deedSignoff.userId, userId),
        eq(deedSignoff.documentVersionId, documentVersionId),
        eq(deedSignoff.assembledContentHash, assembledContentHash),
      ),
    )
    .orderBy(desc(deedSignoff.createdAt));
  const valid = rows.find((r) => r.verdict === 'pass' || r.verdict === 'overridden');
  return valid ? { id: valid.id, verdict: valid.verdict } : null;
}
