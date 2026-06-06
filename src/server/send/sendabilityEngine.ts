/**
 * Export-safety deterministic engine — FOLD-SEND-1 (Increment 2). PURE (no LLM, no I/O).
 *
 * Maps a fully-assembled, deterministic context onto a block/warn/pass verdict, applying the
 * firm-default rule levels. Built to the triad disposition (docs/reviews/FOLD-SEND-1_disposition.md):
 *  - v1 BLOCK-capable: wrong_matter_id only. stale_baseline + missing_required_signer +
 *    open_execution_item are WARN in v1 (the firm-default rule levels enforce this; the engine
 *    honors whatever level the rule assigns, defaulting to 'warn').
 *  - DETERMINISTIC + LLM-FREE: every signal here is a boolean/count computed from structured data
 *    (matter resolution, adopt_ledger baseline, open execution items, jurisdiction rules, package
 *    completeness). The advisory LLM classifier is a SEPARATE warn layer, never an input here.
 *  - stale_baseline is pinned to the adopt_ledger baseline + version drift (NOT open_items severity,
 *    which is LLM-derived) — verified at disposition time.
 *  - FAIL-TO-WARN: any check the context-assembler could not run is surfaced as a 'degraded' WARNING
 *    here (never a block). The caller marks those categories in ctx.degraded.
 */

import type { SendabilityCheckCategory, SendabilityRuleLevel, SendabilityVerdict } from '../../shared/schemas/sendability.js';

export interface JurisdictionRequirementCheck {
  requirement: string;
  sourceTag: string;
  satisfied: boolean;
}

export interface SendabilityContext {
  documentId: string;
  versionId: string;
  matterId: string;
  documentType: string;
  inScope: boolean;
  // wrong_matter_id inputs
  matterResolved: boolean;
  matterArchived: boolean;
  documentMatterLinkOk: boolean;
  // stale_baseline inputs (baseline = last attorney-adopted version, from adopt_ledger)
  hasAdoptions: boolean;
  currentIsLastAdopted: boolean;
  // unverified_kb input — the durable KB-1 flag: this draft drew on an unverified KB memo
  drewOnUnverifiedKb: boolean;
  // execution inputs
  jurisdictionRequirements: JurisdictionRequirementCheck[];
  openExecutionItemCount: number;
  // warning inputs
  packageComplete: boolean | null; // null = no package recorded
  // checks that could not run (fail-to-warn)
  degraded: SendabilityCheckCategory[];
}

export interface SendabilityFinding {
  category: SendabilityCheckCategory;
  summary: string;
  sourceTag?: string;
}

export interface SendabilityEvaluation {
  verdict: SendabilityVerdict;
  blocks: SendabilityFinding[];
  warnings: SendabilityFinding[];
  degraded: 'none' | 'partial' | 'error';
}

export interface RuleLevelLookup {
  category: SendabilityCheckCategory;
  documentType: string | null;
  level: SendabilityRuleLevel;
}

/** Resolve a category's level: prefer a document-type-specific rule, else the all-types rule, else 'warn'. */
export function levelForCategory(
  category: SendabilityCheckCategory,
  documentType: string,
  rules: readonly RuleLevelLookup[],
): SendabilityRuleLevel {
  const typed = rules.find((r) => r.category === category && r.documentType === documentType);
  if (typed) return typed.level;
  const all = rules.find((r) => r.category === category && r.documentType === null);
  return all ? all.level : 'warn';
}

/**
 * Heuristic, content-based satisfaction check for a jurisdiction execution formality (warn-only).
 * Conservative substring/marker matching — never a block input in v1. PURE.
 */
export function requirementSatisfiedInContent(requirement: string, content: string): boolean {
  const c = content.toLowerCase();
  switch (requirement) {
    case 'notary':
      return /notary|notarial|acknowledg/i.test(c);
    case 'two_witnesses':
      return (c.match(/witness/g) ?? []).length >= 2;
    case 'self_proving_affidavit':
      return /self-proving|self proving|affidavit/i.test(c);
    case 'signer_capacity_recital':
      return /capacity/i.test(c);
    default:
      return false;
  }
}

/**
 * Conservative jurisdiction detection from the draft's governing-law language (warn-only feeder for
 * missing_required_signer). Returns a 2-letter code or null when ambiguous/unknown. PURE. There is
 * no structured jurisdiction field on the matter in v1, so this content heuristic is the only source;
 * because missing_required_signer is warn-only and runs in shadow first, a miss is safe.
 */
export function detectJurisdiction(content: string): string | null {
  const va = /commonwealth of virginia|\bvirginia\b|va\.\s*code/i.test(content);
  const md = /\bmaryland\b|md\.\s*code/i.test(content);
  if (va && !md) return 'VA';
  if (md && !va) return 'MD';
  return null; // ambiguous or unknown -> do not assert a jurisdiction
}

/** Deterministically evaluate the export-safety verdict from an assembled context + rule levels. PURE. */
export function evaluateSendability(ctx: SendabilityContext, rules: readonly RuleLevelLookup[]): SendabilityEvaluation {
  const blocks: SendabilityFinding[] = [];
  const warnings: SendabilityFinding[] = [];

  const place = (finding: SendabilityFinding): void => {
    const level = levelForCategory(finding.category, ctx.documentType, rules);
    if (level === 'off') return;
    if (level === 'block') blocks.push(finding);
    else warnings.push(finding);
  };

  // wrong_matter_id — data-integrity: the document must resolve to an owned, non-archived matter and
  // its matter linkage must be consistent. v1-conservative + false-positive-safe; validate on shadow
  // data before the enforce flip. (The only v1 block-level category.)
  if (!ctx.matterResolved || ctx.matterArchived || !ctx.documentMatterLinkOk) {
    place({
      category: 'wrong_matter_id',
      summary: !ctx.matterResolved
        ? 'This document does not resolve to an owned matter.'
        : ctx.matterArchived
          ? 'The matter for this document is archived.'
          : 'The document/matter linkage is inconsistent.',
    });
  }

  // stale_baseline — version drift since the last attorney-adopted version (adopt_ledger baseline).
  // No open_items-severity dependency (that is LLM-derived). Warn.
  if (ctx.hasAdoptions && !ctx.currentIsLastAdopted) {
    place({
      category: 'stale_baseline',
      summary: 'The current version differs from the last attorney-adopted version (regenerated/changed since the last adoption).',
    });
  }

  // missing_required_signer — a seeded jurisdiction formality whose marker is absent from the draft.
  for (const req of ctx.jurisdictionRequirements) {
    if (!req.satisfied) {
      place({
        category: 'missing_required_signer',
        summary: `Required execution formality not detected in the draft: ${req.requirement}.`,
        sourceTag: req.sourceTag,
      });
    }
  }

  // open_execution_item — an open execution-class item is still outstanding. Warn.
  if (ctx.openExecutionItemCount > 0) {
    place({
      category: 'open_execution_item',
      summary: `${ctx.openExecutionItemCount} open execution item(s) still outstanding for this matter.`,
    });
  }

  // package_completeness — advisory warning if a recorded closing package is incomplete.
  if (ctx.packageComplete === false) {
    place({ category: 'package_completeness', summary: 'The closing package has required items still missing.' });
  }

  // unverified_kb (R2 #4) — the draft drew on an UNVERIFIED KB memo (documents.drewOnUnverifiedKb,
  // KB-1; durable, survives versioning). A diligence signal, attorney-final: WARN, never a hard block
  // (fail-to-warn — distinct from the conflicts gate's fail-closed). Surfacing it here lands it in the
  // findings list in front of the attorney at the override moment. Engine-only category (no DB rule/
  // override row) — see the r2_4 no-migration guard test. (`place` defaults an unruled category to warn.)
  if (ctx.drewOnUnverifiedKb) {
    place({ category: 'unverified_kb', summary: 'This draft drew on an unverified knowledge-base memo — re-verify it against current law before sending.' });
  }

  // FAIL-TO-WARN: any check that could not run is a loud warning, never a block.
  for (const category of ctx.degraded) {
    warnings.push({ category, summary: `This check could not run and was not evaluated (treated as a warning, not a block).` });
  }

  const degraded: SendabilityEvaluation['degraded'] = ctx.degraded.length === 0 ? 'none' : 'partial';
  const verdict: SendabilityVerdict = blocks.length > 0 ? 'block' : warnings.length > 0 ? 'warn' : 'pass';
  return { verdict, blocks, warnings, degraded };
}
