/**
 * DOC-CLIENT-TARGET-1 Inc 2 — pure pre-finalize TARGET-CONSISTENCY check (disposition §6).
 *
 * The DETERMINISTIC backstop to the soft identity-layer generation scoping (operator decision, this
 * engagement): generation drafts FOR the bound subject by name, but that is advisory to the model, so
 * finalize ALSO runs this deterministic check. For an individual_subject document with a bound subject,
 * the draft text must NAME the bound subject; a MISMATCH hard-stops finalize ("Do not finalize until
 * resolved"). This is the v1 stand-in for the structural cross-wire guard (the designation-binding
 * fast-follow makes it structural).
 *
 * Matching is name-token based (reusing the conflicts normalizer): a person name matches when its
 * FIRST and LAST significant tokens both appear (tolerates middle-name presence/absence: "Sarah
 * Brianne Brown" vs "Sarah Brown"), bounded by whitespace so "Sarah" does not match "Sarahson". A
 * single-token name matches on that token alone. The cross-wire it catches: Sarah's binding but a
 * draft that names Gregory and not Sarah -> mismatch. A joint MENTION of the other spouse (e.g. as a
 * named agent) does NOT block as long as the subject is also named — the agent cross-wire is the
 * structural fast-follow, not this check's job.
 */

import { normalizeName } from '../conflicts/engine.js';

export interface TargetConsistencyResult {
  result: 'match' | 'mismatch';
  /** Whether the bound subject's name was found in the draft. */
  subjectPresent: boolean;
  /** Other matter-client names that DO appear in the draft (for the mismatch message). */
  otherClientsNamed: string[];
  /** Human-readable reason on mismatch; null on match. */
  reason: string | null;
}

/** Significant name tokens (drop initials/length-1 tokens after normalization). */
function nameTokens(name: string): string[] {
  return normalizeName(name)
    .split(' ')
    .filter((t) => t.length >= 2);
}

/** Is `name` present in the already-normalized, space-padded haystack? First+last token (or the sole
 *  token for a single-word name), each whitespace-bounded. */
function namePresent(paddedHaystack: string, name: string): boolean {
  const toks = nameTokens(name);
  if (toks.length === 0) return false;
  const first = toks[0]!;
  const last = toks[toks.length - 1]!;
  const firstPresent = paddedHaystack.includes(` ${first} `);
  if (toks.length === 1) return firstPresent;
  return firstPresent && paddedHaystack.includes(` ${last} `);
}

export function evaluateTargetConsistency(opts: {
  draftText: string;
  subjectName: string;
  otherClientNames: readonly string[];
}): TargetConsistencyResult {
  const paddedHaystack = ` ${normalizeName(opts.draftText)} `;
  const subjectPresent = namePresent(paddedHaystack, opts.subjectName);
  const otherClientsNamed = opts.otherClientNames.filter((n) => namePresent(paddedHaystack, n));

  if (subjectPresent) {
    return { result: 'match', subjectPresent: true, otherClientsNamed, reason: null };
  }
  const reason =
    otherClientsNamed.length > 0
      ? `The draft names ${otherClientsNamed.join(', ')} but not the bound subject "${opts.subjectName}".`
      : `The bound subject "${opts.subjectName}" does not appear in the draft.`;
  return { result: 'mismatch', subjectPresent: false, otherClientsNamed, reason };
}
