/**
 * LIVE-9 — Deed-like document guard (triad-dispositioned 2026-06-26; GPT + Grok + independent Claude,
 * unanimous GO-amended). See docs/reviews/LIVE-9_packet.md.
 *
 * The generic LLM / template document path must NEVER mint a Virginia deed or deed-like recordable
 * instrument. A free LLM asked to "draft a deed" is liable to: (1) hallucinate a non-verbatim legal
 * description (a title cloud); (2) use the exemption-killing granting clause ("grant, bargain, sell, and
 * convey" + a consideration recital) that defeats the Va. Code § 58.1-811(D) gift exemption (P.D. 93-212);
 * (3) produce the wrong deed type / operative posture; (4) misidentify grantor/grantee/capacity/vesting;
 * or (5) draft a defective security instrument (deed of trust). The deterministic deed agent
 * (src/server/deed/*Assembler.ts, reached only via the deedDraftAgent / quickDeed routers) prevents all of
 * these. This module is the single, isolated, unit-testable classifier + block helper that every generic
 * text-producing entry point consults to REFUSE deed-like work and steer it to the deterministic agent
 * (conveyance deeds) or the loan/security-instrument workflow (deeds of trust et al.).
 *
 * Posture (per the disposition):
 *  - BLOCK, not redirect (redirect into an assembler is a deferred follow-up).
 *  - Conservative toward OVER-blocking: a false-positive blocks a non-deed (a mild, recoverable annoyance);
 *    a false-negative lets a recordable defective instrument through (the harm we prevent).
 *  - The block is INDEPENDENT of DEED_DRAFT_AGENT_ENABLED — never draft a deed on the generic path even
 *    while the deterministic agent is dark; only the remediation MESSAGE adapts.
 *  - TWO distinct classes / messages / destinations: a conveyance deed and a security instrument are never
 *    collapsed, and a security instrument is NEVER routed to the gift/conveyance assembler.
 */
import { TRPCError } from '@trpc/server';
import { isDeedDraftAgentEnabled } from '../config/featureFlags.js';

export type DeedGuardClass = 'conveyance_deed' | 'security_instrument';

export const DEED_BLOCK_CODE: Record<DeedGuardClass, string> = {
  conveyance_deed: 'CONVEYANCE_DEED_BLOCKED',
  security_instrument: 'SECURITY_INSTRUMENT_BLOCKED',
};

export interface DeedGuardMatch {
  blocked: true;
  guardClass: DeedGuardClass;
  matchedOn: 'documentType' | 'customTypeLabel' | 'title';
  normalized: string;
}
export type DeedGuardResult = DeedGuardMatch | { blocked: false };

/**
 * Normalize a candidate string for matching: split camelCase, lowercase, then replace every run of
 * non-alphanumeric characters (underscore, hyphen, punctuation, whitespace) with a single space and trim.
 *   "deed_of_trust" -> "deed of trust"; "DeedOfTrust" -> "deed of trust"; "quit-claim" -> "quit claim".
 */
export function normalizeForDeedMatch(s: string): string {
  return s
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// SECURITY INSTRUMENTS (class 2) — tested BEFORE the conveyance "\bdeed\b" rule, because "deed of trust"
// et al. contain the word "deed". A security instrument must never be routed to the conveyance assembler.
const SECURITY_PHRASES: readonly string[] = [
  'deed of trust',
  'trust deed',
  'security deed',
  'deed to secure debt',
  'mortgage',
  'credit line deed of trust',
  'indemnity deed of trust',
  'construction deed of trust',
];

// CONVEYANCE DEEDS (class 1) — the broad bare-word "deed" net PLUS deed-less conveyance instruments.
const CONVEYANCE_PHRASES: readonly string[] = [
  'quitclaim',
  'quit claim',
  'bargain and sale',
  'transfer on death',
  'tod deed',
  'beneficiary deed',
];

/** Word-boundary containment on the already space-normalized string (phrase is alnum + single spaces). */
function hasPhrase(normalized: string, phrase: string): boolean {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^| )${escaped}(?: |$)`).test(normalized);
}

// The bare-word deed net (singular OR plural) — matches "deed"/"deeds" as whole words, but NOT "indeed"
// or "deeded". This is the broad catch behind every "* deed" / "deed *" instrument.
const BARE_DEED_RE = /(?:^| )deeds?(?: |$)/;

function classifyOne(raw: string | null | undefined, source: DeedGuardMatch['matchedOn']): DeedGuardResult {
  if (!raw) return { blocked: false };
  const n = normalizeForDeedMatch(raw);
  if (!n) return { blocked: false };
  for (const p of SECURITY_PHRASES) {
    if (hasPhrase(n, p)) return { blocked: true, guardClass: 'security_instrument', matchedOn: source, normalized: n };
  }
  if (BARE_DEED_RE.test(n)) {
    return { blocked: true, guardClass: 'conveyance_deed', matchedOn: source, normalized: n };
  }
  for (const p of CONVEYANCE_PHRASES) {
    if (hasPhrase(n, p)) return { blocked: true, guardClass: 'conveyance_deed', matchedOn: source, normalized: n };
  }
  return { blocked: false };
}

/**
 * Classify a document as a deed-like recordable instrument from its type / label / title.
 *
 * documentType is always considered. The free-text customTypeLabel and TITLE are considered ONLY when
 * documentType is the 'custom' escape hatch — so a first-class NON-deed type (e.g. 'memo') whose title
 * merely mentions a deed is NOT blocked, but a 'custom' document titled "Deed of Gift" IS. Security
 * instruments win over conveyance deeds (checked first) so a deed of trust never routes to the conveyance
 * assembler.
 */
export function classifyDeedLike(args: {
  documentType: string;
  customTypeLabel?: string | null;
  title?: string | null;
}): DeedGuardResult {
  const byType = classifyOne(args.documentType, 'documentType');
  if (byType.blocked) return byType;
  if (normalizeForDeedMatch(args.documentType) === 'custom') {
    const byLabel = classifyOne(args.customTypeLabel, 'customTypeLabel');
    if (byLabel.blocked) return byLabel;
    const byTitle = classifyOne(args.title, 'title');
    if (byTitle.blocked) return byTitle;
  }
  return { blocked: false };
}

function remediationMessage(guardClass: DeedGuardClass): string {
  if (guardClass === 'security_instrument') {
    return 'A deed of trust or other security instrument must be prepared through the loan / security-instrument workflow or an approved attorney template. It is never produced by the general document drafter, and it is never routed to the deed (conveyance) assembler.';
  }
  // conveyance deed — the message adapts to whether the deterministic deed agent is available; the BLOCK
  // itself does not (a deed is never drafted on the generic path even while the agent is dark).
  return isDeedDraftAgentEnabled()
    ? 'A deed must be drafted through the deterministic deed agent (the Quick-Deed workflow), which guarantees the verbatim legal description, the exemption-safe granting language, and the correct deed type — not the general document drafter.'
    : 'Deed drafting is unavailable through this workflow. A deed is never produced by the general document drafter; it must be assembled by the deterministic deed agent, which is not currently enabled.';
}

/** Build the class-appropriate PRECONDITION_FAILED error for a blocked deed-like document. */
export function deedGuardError(match: DeedGuardMatch): TRPCError {
  return new TRPCError({
    code: 'PRECONDITION_FAILED',
    message: `${DEED_BLOCK_CODE[match.guardClass]}: ${remediationMessage(match.guardClass)}`,
  });
}

/**
 * Enforce the deed guard at a generic text-producing entry point. If the document is deed-like, audit-log
 * the blocked attempt (no-schema structured line: class, normalized type, entry path, user, document,
 * timestamp) and throw the class-appropriate PRECONDITION_FAILED. No-op otherwise.
 */
export function enforceNotDeedLike(args: {
  documentType: string;
  customTypeLabel?: string | null;
  title?: string | null;
  entryPath: string;
  userId: string;
  documentId?: string | null;
  matterId?: string | null;
}): void {
  const result = classifyDeedLike(args);
  if (!result.blocked) return;
  try {
    // eslint-disable-next-line no-console
    console.warn(
      '[LIVE-9 deed-block] ' +
        JSON.stringify({
          event: 'deed_generation_blocked',
          guardClass: result.guardClass,
          code: DEED_BLOCK_CODE[result.guardClass],
          matchedOn: result.matchedOn,
          normalized: result.normalized,
          entryPath: args.entryPath,
          userId: args.userId,
          documentId: args.documentId ?? null,
          matterId: args.matterId ?? null,
          ts: new Date().toISOString(),
        }),
    );
  } catch {
    /* logging must never break the guard */
  }
  throw deedGuardError(result);
}

// ============================================================================================
// Defense-in-depth: send/export text scanner
// ============================================================================================

/**
 * Deed/recordable OPERATIVE-language patterns. Deliberately NARROWER than the type classifier — these are
 * granting/operative clauses that appear in an actual deed body, so the scanner does not trip on a memo
 * that merely discusses deeds. (No bare "deed" word match here; that lives in the type classifier.)
 */
const DEED_OPERATIVE_PATTERNS: readonly RegExp[] = [
  /\bgrant(?:s|ed|ing)?\s*,?\s*bargain\b/i, // "grant, bargain, sell and convey"
  /\bbargain(?:ed)?\s*,?\s*sell\b/i,
  /\bgrant\s+and\s+convey\b/i, // exemption-safe gift granting verb — still deed-operative
  /\bdo(?:es)?\s+hereby\s+(?:grant|convey|give)\b/i,
  /\bconvey\s+and\s+warrant\b/i,
  /\bthis\s+deed\s+of\s+(?:gift|trust)\b/i,
  /\bdeed\s+of\s+gift\b/i,
  /\bquit\s*claims?\b/i,
  /\btransfer\s+on\s+death\s+deed\b/i,
];

export interface DeedTextScan {
  isDeedText: boolean;
  matched: string[];
}

/**
 * Scan finished document TEXT for deed/recordable operative language. Used by the export route to refuse
 * exporting a document that CONTAINS a deed but is NOT a sanctioned documentType==='deed' (the deterministic
 * agent's output) — i.e. a deed pasted/imported into a generic document that never went through the agent.
 *
 * Known limitation: a legacy documentType==='deed' produced by the generic LLM BEFORE this guard shipped
 * cannot be distinguished from agent output without a durable provenance field (a schema change, out of
 * scope). The generation guard prevents NEW ones; legacy cleanup is a separate concern. See the LIVE-9 packet.
 */
export function scanForDeedOperativeLanguage(text: string | null | undefined): DeedTextScan {
  if (!text) return { isDeedText: false, matched: [] };
  const matched: string[] = [];
  for (const re of DEED_OPERATIVE_PATTERNS) {
    const m = re.exec(text);
    if (m) matched.push(m[0].replace(/\s+/g, ' ').trim().slice(0, 60));
  }
  return { isDeedText: matched.length > 0, matched };
}
