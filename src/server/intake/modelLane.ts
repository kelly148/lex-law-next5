/**
 * Analysis model-lane suggestion — FOLD-L0-1 (Fork E).
 *
 * PURE + suggest-only. Single-lane (Claude) is the DEFAULT. This NEVER dispatches multi-
 * lane and NEVER auto-runs at intake — it only returns a conservative, EXPLAINABLE
 * suggestion the attorney may act on. High-signal flags: cross-jurisdictional / high-stakes
 * / novel.
 */

export interface IntakeSignals {
  // `| undefined` so the zod-inferred input (optionals carry undefined) is assignable
  // under exactOptionalPropertyTypes.
  highStakes?: boolean | undefined;
  novel?: boolean | undefined;
  crossJurisdictional?: boolean | undefined;
  jurisdictions?: string[] | undefined;
}

export interface LaneSuggestion {
  defaultLane: 'single';
  suggestMulti: boolean;
  reason: string;
}

export function suggestAnalysisLane(signals: IntakeSignals): LaneSuggestion {
  const reasons: string[] = [];
  const jurisdictions = signals.jurisdictions ?? [];
  if (signals.crossJurisdictional || jurisdictions.length > 1) {
    reasons.push(`cross-jurisdictional (${jurisdictions.length > 1 ? jurisdictions.join('+') : 'multiple jurisdictions'})`);
  }
  if (signals.highStakes) reasons.push('high-stakes');
  if (signals.novel) reasons.push('novel matter');

  if (reasons.length === 0) {
    return { defaultLane: 'single', suggestMulti: false, reason: 'single-lane default (no high-signal flags)' };
  }
  return { defaultLane: 'single', suggestMulti: true, reason: `suggested because ${reasons.join(', ')}` };
}
