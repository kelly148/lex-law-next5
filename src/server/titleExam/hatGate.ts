/**
 * hatGate.ts — TITLE-EXAM-1 (T7), the dual-hat entity gate + knowledge scoping (NC-5, PB-1).
 *
 * Dual-hat is SUBSTANTIVE, not cosmetic (NC-5): the entity attribute (the shipped engagement-capacity
 * election, matters.engagementCapacity) gates FATIC knowledge availability, knowledge-lane access, the
 * client-email template family, and the disclaimer set. This module is the deterministic gate. It BUILDS the
 * gate — it loads NO FATIC content (PB-1 interim: FATIC is Universal-Title-hat only until the written
 * agency/underwriter basis exists; the law-firm hat requires that paper first).
 *
 * PURE. Flag-dark by construction; no model literal. Nothing crosses hats without an affirmative promotion.
 */

/** The two hats. Universal Title = the title-company/settlement-agent seat; Satterwhite Law Firm = the
 *  representational law-firm seat. Mapped from matters.engagementCapacity (title_settlement_agent | law_firm). */
export type EntityHat = 'universal_title' | 'satterwhite_law_firm';

/** Resolve the hat from the matter's engagement-capacity election. Only the affirmative
 *  'title_settlement_agent' election is the Universal Title hat; anything else (law_firm, unelected, unknown)
 *  is the law-firm hat — the conservative default (it does NOT get the FATIC/underwriter privileges). */
export function resolveHat(engagementCapacity: string | null | undefined): EntityHat {
  return engagementCapacity === 'title_settlement_agent' ? 'universal_title' : 'satterwhite_law_firm';
}

export interface FaticAvailability {
  available: boolean;
  reason: string;
}

/**
 * FATIC knowledge availability (PB-1). Gated to the Universal Title hat only until the written agency/
 * underwriter basis (`pb1PaperInHand`) exists — then the law-firm hat may use it too. This gate returns a
 * verdict; it never itself loads FATIC content (the loader consults this first and stays empty when false).
 */
export function resolveFaticAvailability(hat: EntityHat, pb1PaperInHand = false): FaticAvailability {
  if (hat === 'universal_title') {
    return { available: true, reason: 'PB-1 interim: FATIC knowledge is available to the Universal Title hat.' };
  }
  if (pb1PaperInHand) {
    return { available: true, reason: 'PB-1 paper in hand: FATIC authorized for the law-firm hat.' };
  }
  return {
    available: false,
    reason: 'PB-1 interim gate: FATIC is Universal-Title-hat only until the written agency/underwriter basis exists.',
  };
}

/** The hat-scoped knowledge lanes (NC-5). Query-time filtering; nothing crosses hats without promotion. */
export const KNOWLEDGE_LANES = [
  'ut_matter', // Universal Title matter knowledge
  'firm_matter', // law-firm matter knowledge
  'public_authority', // public / primary legal authority (hat-agnostic)
  'underwriter_derived', // underwriter-derived positions (title seat)
  'cross_hat_approved', // knowledge the operator affirmatively promoted to a cross-hat tier
] as const;
export type KnowledgeLane = (typeof KNOWLEDGE_LANES)[number];

/**
 * The knowledge lanes a hat may read. Each hat sees its own matter knowledge + public authority +
 * cross-hat-approved; underwriter-derived positions are the Universal Title (title) seat only. Cross-hat
 * matter seeding defaults to NO in both directions — the other hat's matter lane is never included.
 */
export function accessibleKnowledgeLanes(hat: EntityHat): KnowledgeLane[] {
  if (hat === 'universal_title') {
    return ['ut_matter', 'public_authority', 'underwriter_derived', 'cross_hat_approved'];
  }
  return ['firm_matter', 'public_authority', 'cross_hat_approved'];
}

export function isKnowledgeLaneAccessible(hat: EntityHat, lane: KnowledgeLane): boolean {
  return accessibleKnowledgeLanes(hat).includes(lane);
}

/**
 * Cross-hat matter seeding defaults to NO in both directions (NC-5): knowledge created under one hat is
 * unavailable to the other unless the operator affirmatively promoted it to the cross-hat tier.
 */
export function canSeedAcrossHats(sourceHat: EntityHat, targetHat: EntityHat, promotedCrossHat = false): boolean {
  if (sourceHat === targetHat) return true; // same hat, not a cross-hat seed
  return promotedCrossHat;
}

/** Client-email template family (NC-5). Title-hat communications frame findings as underwriting/settlement
 *  requirements; recommendation language is law-firm-hat only. */
export type TemplateFamily = 'title_underwriting' | 'law_firm';
export function resolveTemplateFamily(hat: EntityHat): TemplateFamily {
  return hat === 'universal_title' ? 'title_underwriting' : 'law_firm';
}

/** The disclaimer set the hat requires (NC-5). Title-hat carries the not-your-attorney disclaimer; the
 *  law-firm hat carries the engagement disclaimer. Non-editable in the client version (NC-3f). */
export function resolveDisclaimerSet(hat: EntityHat): string[] {
  if (hat === 'universal_title') {
    return [
      'This is a title/settlement requirement communication, not legal advice to any party.',
      'Universal Title is not your attorney; consult independent counsel for legal advice.',
    ];
  }
  return ['This communication is provided under our engagement for this matter.'];
}

/** Whether the hat may state party-specific recommendation/advice language. Law-firm hat only. */
export function isAdvicePermitted(hat: EntityHat): boolean {
  return hat === 'satterwhite_law_firm';
}

export interface HatProfile {
  hat: EntityHat;
  fatic: FaticAvailability;
  knowledgeLanes: KnowledgeLane[];
  templateFamily: TemplateFamily;
  disclaimers: string[];
  advicePermitted: boolean;
}

/** Resolve the full hat profile from the matter's engagement-capacity election. */
export function resolveHatProfile(
  engagementCapacity: string | null | undefined,
  pb1PaperInHand = false,
): HatProfile {
  const hat = resolveHat(engagementCapacity);
  return {
    hat,
    fatic: resolveFaticAvailability(hat, pb1PaperInHand),
    knowledgeLanes: accessibleKnowledgeLanes(hat),
    templateFamily: resolveTemplateFamily(hat),
    disclaimers: resolveDisclaimerSet(hat),
    advicePermitted: isAdvicePermitted(hat),
  };
}
