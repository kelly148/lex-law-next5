/**
 * CHAT-UI-1 W2 — the posture-provenance tamper-evident hash chain (server-only; node:crypto).
 *
 * Per-matter append-only chain: entryHash = sha256(canonicalContent(content, prevHash)). The genesis
 * row uses GENESIS_PREV_HASH. verifyChain recomputes the chain over an ordered (by seq) run of rows
 * and reports the first break — any altered, inserted, deleted, or reordered row changes a hash, so
 * tampering is detectable (tamper-EVIDENT, not tamper-proof). Kept OUT of the shared bundle because
 * it imports node:crypto; the deterministic content string it signs comes from the shared
 * provenanceRow.canonicalContent so client and server agree on what is hashed.
 */
import { createHash } from 'node:crypto';
import { canonicalContent, type PostureProvenanceContent } from '../../shared/posture/provenanceRow.js';

/** Genesis predecessor for the first row of a matter's chain. */
export const GENESIS_PREV_HASH = '';

export function sha256Hex(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

export function computeEntryHash(prevHash: string, content: PostureProvenanceContent): string {
  return sha256Hex(canonicalContent(content, prevHash));
}

export interface ChainLink {
  content: PostureProvenanceContent;
  prevHash: string;
  entryHash: string;
}

export interface ChainVerification {
  valid: boolean;
  /** The seq of the first row that fails verification, or null when the chain is intact. */
  brokenAtSeq: number | null;
  reason: string | null;
}

/** Recompute the chain over links ORDERED by seq; detect the first integrity break. */
export function verifyChain(links: readonly ChainLink[]): ChainVerification {
  let expectedPrev = GENESIS_PREV_HASH;
  for (const link of links) {
    if (link.prevHash !== expectedPrev) {
      return {
        valid: false,
        brokenAtSeq: link.content.seq,
        reason: 'prevHash mismatch (a row was inserted, deleted, or reordered)',
      };
    }
    if (computeEntryHash(link.prevHash, link.content) !== link.entryHash) {
      return {
        valid: false,
        brokenAtSeq: link.content.seq,
        reason: 'entryHash mismatch (row content was altered)',
      };
    }
    expectedPrev = link.entryHash;
  }
  return { valid: true, brokenAtSeq: null, reason: null };
}
