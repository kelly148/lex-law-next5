/**
 * CHAT-UI-1 W2 — the durable posture-provenance ROW: the pure mapping between the W1 ProvenanceEntry
 * contract and the persisted ledger row, plus the deterministic canonical serialization the
 * tamper-evident hash chain signs.
 *
 * SHARED + crypto-free: the sha256 hashing lives server-side (src/server/db/provenanceHash.ts); this
 * module only produces the deterministic content string that gets hashed, so it is safe in the client
 * bundle. Honors the W1 ProvenanceEntry (commit 9cf7dac) — it MAPS the contract, never redefines it.
 */
import { type Posture, type CoherenceFinding, hasHardBlock } from './postureCoherence.js';
import type { HardStopAct, ProvenanceEventClass, ProvenanceEntry, ProvenanceSubject } from './provenance.js';

export type PrivilegeColumn = 'privileged' | 'not_privileged' | 'undetermined';
export type VerdictSeverity = 'hard' | 'soft' | 'none';

export function privilegeToColumn(p: Posture['privilege']): PrivilegeColumn {
  if (p === true) return 'privileged';
  if (p === false) return 'not_privileged';
  return 'undetermined';
}

export function columnToPrivilege(c: PrivilegeColumn): Posture['privilege'] {
  if (c === 'privileged') return true;
  if (c === 'not_privileged') return false;
  return null;
}

/** The highest severity among the acknowledged findings ('none' when there were none). */
export function verdictSeverityOf(findings: readonly CoherenceFinding[]): VerdictSeverity {
  if (hasHardBlock(findings)) return 'hard';
  if (findings.some((f) => f.severity === 'SOFT')) return 'soft';
  return 'none';
}

/**
 * The hashable content of a ledger entry — everything the per-matter chain integrity-protects.
 * Excludes the row id and the hashes themselves (those wrap the content).
 */
export interface PostureProvenanceContent {
  matterId: string;
  documentId: string | null;
  seq: number;
  eventClass: ProvenanceEventClass;
  act: HardStopAct;
  actor: string;
  sliderPosition: string;
  triggerSource: string;
  /** The W1 entry `at` — the attorney's confirm timestamp (distinct from the DB write time). */
  confirmedAt: string;
  // Resolved triple — typed, first-class for query/export. null for a non-posture act (no triple).
  issuerEntity: string | null;
  issuerCapacity: 'counsel' | 'principal' | null;
  issuerDisplay: string | null;
  privilege: PrivilegeColumn | null;
  recipient: Posture['recipient'] | null;
  // Supplementary + the incoherence-table verdict.
  priorTriple: Posture | null;
  verdictSeverity: VerdictSeverity;
  findings: CoherenceFinding[];
  // The non-posture act's target (W3); null for posture acts.
  subject: ProvenanceSubject | null;
}

/** Map a W1 ProvenanceEntry to durable content, given its matter context + per-matter sequence. */
export function entryToContent(
  entry: ProvenanceEntry,
  ctx: { matterId: string; documentId?: string | null; seq: number },
): PostureProvenanceContent {
  const next = entry.nextTriple;
  return {
    matterId: ctx.matterId,
    documentId: ctx.documentId ?? null,
    seq: ctx.seq,
    eventClass: entry.eventClass,
    act: entry.act,
    actor: entry.actor,
    sliderPosition: entry.sliderPosition,
    triggerSource: entry.triggerSource,
    confirmedAt: entry.at,
    issuerEntity: next ? next.issuer.entity : null,
    issuerCapacity: next ? next.issuer.capacity : null,
    issuerDisplay: next ? next.issuer.display ?? null : null,
    privilege: next ? privilegeToColumn(next.privilege) : null,
    recipient: next ? next.recipient : null,
    priorTriple: entry.priorTriple,
    verdictSeverity: verdictSeverityOf(entry.acknowledged),
    findings: entry.acknowledged,
    subject: entry.subject,
  };
}

/**
 * Reconstruct the resolved triple from content (lossless round-trip for the typed columns). Returns
 * null when the act carried no triple (a non-posture act).
 */
export function contentToResolvedTriple(content: PostureProvenanceContent): Posture | null {
  if (
    content.recipient === null ||
    content.issuerEntity === null ||
    content.issuerCapacity === null ||
    content.privilege === null
  ) {
    return null;
  }
  return {
    issuer: {
      entity: content.issuerEntity,
      capacity: content.issuerCapacity,
      ...(content.issuerDisplay !== null ? { display: content.issuerDisplay } : {}),
    },
    privilege: columnToPrivilege(content.privilege),
    recipient: content.recipient,
  };
}

/**
 * Deterministic, key-order-independent JSON serialization (recursively sorts object keys, skips
 * undefined). Two equal values always produce the same string — so a row hashed at write time and
 * re-hashed from a parsed DB read produce identical strings regardless of property order.
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

/** The exact string the hash chain signs: the content plus the previous entry's hash. */
export function canonicalContent(content: PostureProvenanceContent, prevHash: string): string {
  return stableStringify({ prevHash, ...content });
}
