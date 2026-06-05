/**
 * Content hash for export-safety override binding — FOLD-SEND-1 (Increment 3). PURE.
 *
 * An attorney override is bound to the exact documentId + versionId + content-hash at override time
 * (triad disposition, decision 3). If the content changes, the hash changes, so the override no
 * longer matches and the block re-applies — "supersedes on version change." Deterministic; SHA-256
 * hex of the normalized-newline content.
 */

import { createHash } from 'node:crypto';

export function computeContentHash(content: string): string {
  return createHash('sha256').update(content.replace(/\r\n/g, '\n'), 'utf8').digest('hex');
}
