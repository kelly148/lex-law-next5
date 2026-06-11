/**
 * CHAT-UI-1 W1 — posture model + coherence table (the load-bearing safety logic).
 *
 * A deliverable carries a posture triple {issuer, privilege, recipient} (brief §2). These three
 * properties are POSTURE-DETERMINATIVE: the same words are "privileged advice from counsel to our
 * client" or "a non-privileged directive from the company to an adverse party" depending only on
 * this triple — opposite legal exposure. So posture properties are PROPOSE-ONLY and confirmed; they
 * are never silently applied (brief §1/§3). This module is the single source of truth for:
 *
 *   1. the posture types,
 *   2. the per-property confirm TRIGGERS (brief §2.1 — no significance classifier; structural only),
 *   3. the enumerated ~8-row HARD/SOFT INCOHERENCE TABLE (brief §2.6 D2 — auditable data, not a
 *      classifier), run at every confirm and at the send/lock egress backstop (brief §2.2/§2.3).
 *
 * SHARED (src/shared) so the client consequence-tier confirm component (W1) and the server-side
 * send/lock egress check (W1) evaluate the SAME contract.
 *
 * Governing record: docs/CHAT-UI-1/BUILD_BRIEF.md §2 + the ratified dispositions in
 * docs/CHAT-UI-1/GATE0_STATUS.md (D1 carve-out ratified; D2 table ships; the 8 rows below were
 * operator-ratified 2026-06-11). The legal classification of each combination — which mix is HARD
 * (block) vs SOFT (warn) — is an ATTORNEY call recorded here as data; engineering does not decide it.
 */

// ── Posture types ────────────────────────────────────────────────────────────────────────────────

/** Signing capacity: 'counsel' = from the firm as attorney; 'principal' = from the client/company as a party. */
export type IssuerCapacity = 'counsel' | 'principal';

export interface Issuer {
  /** The structured legal entity the document issues from (identity, not display prose). */
  entity: string;
  /** Signing capacity (drives coherence). */
  capacity: IssuerCapacity;
  /** Optional free-text display ("Acme LLC, by its Manager"). Cosmetic — never triggers a confirm on its own. */
  display?: string;
}

/** Privilege determination. `null` = NOT YET affirmatively determined (the dangerous default at egress). */
export type Privilege = boolean | null;

/** Outward-exposure ladder (brief §2.4), least → most exposed. */
export type RecipientClass =
  | 'internal_client'
  | 'co_counsel_agent'
  | 'neutral_third_party'
  | 'regulator_court'
  | 'adverse'
  | 'public';

export interface Posture {
  issuer: Issuer;
  privilege: Privilege;
  recipient: RecipientClass;
}

export const RECIPIENT_LADDER: readonly RecipientClass[] = [
  'internal_client',
  'co_counsel_agent',
  'neutral_third_party',
  'regulator_court',
  'adverse',
  'public',
];

/** Position on the outward-exposure ladder (0 = least exposed). */
export function recipientExposureRank(r: RecipientClass): number {
  return RECIPIENT_LADDER.indexOf(r);
}

/** An outward move = strictly higher exposure (brief §2.4: any outward move re-confirms). */
export function isOutwardMove(prev: RecipientClass, next: RecipientClass): boolean {
  return recipientExposureRank(next) > recipientExposureRank(prev);
}

// ── Per-property confirm triggers (brief §2.1 — structural, no classifier) ─────────────────────────

/**
 * Issuer confirms on change EXCEPT a provably cosmetic change, defined STRUCTURALLY as the same legal
 * entity AND the same signing capacity (brief §2.1). Display prose is free and never triggers on its
 * own. No classifier — pure structural equality on {entity, capacity}.
 */
export function issuerRequiresConfirm(prev: Issuer, next: Issuer): boolean {
  return !(prev.entity === next.entity && prev.capacity === next.capacity);
}

/** Privilege (boolean) confirms on ANY value change — including to/from the undetermined (null) state. */
export function privilegeRequiresConfirm(prev: Privilege, next: Privilege): boolean {
  return prev !== next;
}

/** Recipient (closed enum) confirms on ANY value change. */
export function recipientRequiresConfirm(prev: RecipientClass, next: RecipientClass): boolean {
  return prev !== next;
}

export interface PostureTriggers {
  issuer: boolean;
  privilege: boolean;
  recipient: boolean;
  /** true if ANY posture property changed and therefore a confirm is required. */
  any: boolean;
}

/** Which posture properties changed from `prev` to `next` and therefore require a confirm. */
export function posturePropertyTriggers(prev: Posture, next: Posture): PostureTriggers {
  const issuer = issuerRequiresConfirm(prev.issuer, next.issuer);
  const privilege = privilegeRequiresConfirm(prev.privilege, next.privilege);
  const recipient = recipientRequiresConfirm(prev.recipient, next.recipient);
  return { issuer, privilege, recipient, any: issuer || privilege || recipient };
}

// ── Incoherence table (brief §2.6 D2 — enumerated HARD/SOFT data, operator-ratified) ───────────────

export type CoherenceSeverity = 'HARD' | 'SOFT';

export interface CoherenceFinding {
  id: string;
  severity: CoherenceSeverity;
  summary: string;
  rationale: string;
}

export interface CoherenceContext {
  /** true when evaluating at the send/lock egress backstop (brief §2.3); enables egress-only rows. */
  atEgress: boolean;
}

interface CoherenceRow extends CoherenceFinding {
  applies: (p: Posture, ctx: CoherenceContext) => boolean;
}

/**
 * The ratified incoherence rows. HARD = block the act until resolved; SOFT = warn, allow with a
 * confirm. Each row is independent, auditable data — amending a verdict is a one-line edit + a test
 * row, never a model change. Order is presentation order, not precedence (all matching rows surface).
 */
export const INCOHERENCE_TABLE: readonly CoherenceRow[] = [
  {
    id: 'priv-to-adverse',
    severity: 'HARD',
    summary: 'Privileged material addressed to an adverse party',
    rationale:
      'Sending privileged material to an opponent destroys privilege and discloses protected material to an adversary.',
    applies: (p) => p.privilege === true && p.recipient === 'adverse',
  },
  {
    id: 'priv-to-public',
    severity: 'HARD',
    summary: 'Privileged material released publicly',
    rationale: 'Publishing privileged material irrevocably waives privilege.',
    applies: (p) => p.privilege === true && p.recipient === 'public',
  },
  {
    id: 'priv-to-tribunal',
    severity: 'HARD',
    summary: 'Privileged material disclosed to a regulator or court',
    rationale:
      'Disclosure to a tribunal or regulator waives privilege; it must be a deliberate attorney waiver, never a default.',
    applies: (p) => p.privilege === true && p.recipient === 'regulator_court',
  },
  {
    id: 'priv-to-third-party',
    severity: 'SOFT',
    summary: 'Privileged material shared with a neutral third party',
    rationale:
      'Sharing privileged material with a third party may waive privilege; a common-interest or agency exception can apply — attorney judgment required.',
    applies: (p) => p.privilege === true && p.recipient === 'neutral_third_party',
  },
  {
    id: 'principal-privileged-outward',
    severity: 'HARD',
    summary: 'Party-issued document marked privileged and going outward',
    rationale:
      'A document issued by the client/company as a party is not privileged counsel advice; sending it marked privileged misrepresents its posture (the v1 defect).',
    applies: (p) => p.issuer.capacity === 'principal' && p.privilege === true && p.recipient !== 'internal_client',
  },
  {
    id: 'principal-privileged-internal',
    severity: 'SOFT',
    summary: 'Party-issued document marked privileged (internal/client only)',
    rationale:
      'Internal-party privilege can exist, but a party-capacity document marked privileged is unusual — verify the issuer/privilege fit.',
    applies: (p) => p.issuer.capacity === 'principal' && p.privilege === true && p.recipient === 'internal_client',
  },
  {
    id: 'counsel-unprivileged-internal',
    severity: 'SOFT',
    summary: 'Counsel-to-client communication marked not privileged',
    rationale:
      'Counsel-to-client advice is normally privileged; an unprivileged posture here is unusual — confirm it is intended.',
    applies: (p) => p.issuer.capacity === 'counsel' && p.privilege === false && p.recipient === 'internal_client',
  },
  {
    id: 'adverse-privilege-unset',
    severity: 'HARD',
    summary: 'Sending to an adverse party with privilege undetermined',
    rationale: 'A document cannot go to an adverse party without an explicit privilege determination on the record.',
    applies: (p, ctx) => ctx.atEgress && p.recipient === 'adverse' && p.privilege === null,
  },
];

/**
 * Run the incoherence table over a posture triple (brief §2.2 — the WHOLE triple, not just the
 * changed field). Returns every matching finding. Pass { atEgress: true } at the send/lock backstop
 * (brief §2.3) to include the egress-only rows.
 */
export function evaluateCoherence(p: Posture, ctx: CoherenceContext = { atEgress: false }): CoherenceFinding[] {
  return INCOHERENCE_TABLE.filter((row) => row.applies(p, ctx)).map((row) => ({
    id: row.id,
    severity: row.severity,
    summary: row.summary,
    rationale: row.rationale,
  }));
}

/** True if any finding is HARD (the act must be blocked until resolved). */
export function hasHardBlock(findings: readonly CoherenceFinding[]): boolean {
  return findings.some((f) => f.severity === 'HARD');
}
