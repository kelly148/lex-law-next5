import { describe, expect, it } from 'vitest';

import { parseFeedbackOutput } from '../llm/parsers/feedbackParser.js';

type CalibrationStatus = 'PASS' | 'PARTIAL' | 'FAIL' | 'PARSE_FAILURE' | 'NOT_RUN';
type ScenarioId = 'P8-T1' | 'P8-T6' | 'P8-T7' | 'P8-T10';
type ProviderInstability =
  | 'timeout'
  | 'empty provider response'
  | 'singleton-object normalization issue'
  | 'JSON-mode / wrapper-shape issue'
  | 'harness-specific behavior'
  | 'insufficient evidence';

interface FeedbackCard {
  severity?: string;
  severity_subtype?: string;
  critique_type?: string;
  issue?: string;
  recommendation?: string;
  suggested_revision?: string;
  requires_attorney_decision?: boolean;
  suppress_by_default?: boolean;
  routine_blank_flag?: boolean;
  audience_affected?: string;
}

interface Classification {
  status: CalibrationStatus;
  reason: string;
  providerInstability?: ProviderInstability;
}

interface ProviderOutcome {
  returnedSuccessfully: boolean;
  rawOutput: string;
  errorClass?: string;
  errorMessage?: string;
}

interface ParsedOutput {
  text: string;
  cards: FeedbackCard[];
  legacyCount: number;
}

function legacyItem(body: string): string {
  return JSON.stringify([{ title: 'Calibration item', body, severity: 'major' }]);
}

function structuredBody(cards: FeedbackCard[], narrative = 'NARRATIVE_REVIEWER_MEMO: Calibration narrative.'): string {
  return `${narrative}\nSTRUCTURED_FEEDBACK_CARDS: ${JSON.stringify(cards)}`;
}

function parseEmbeddedCards(body: string): FeedbackCard[] {
  const markerIndex = body.indexOf('STRUCTURED_FEEDBACK_CARDS');
  if (markerIndex < 0) return [];

  const afterMarker = body.slice(markerIndex + 'STRUCTURED_FEEDBACK_CARDS'.length);
  const start = afterMarker.indexOf('[');
  if (start < 0) return [];

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < afterMarker.length; i += 1) {
    const ch = afterMarker[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === '[') depth += 1;
    if (ch === ']') {
      depth -= 1;
      if (depth === 0) {
        const parsed: unknown = JSON.parse(afterMarker.slice(start, i + 1));
        return Array.isArray(parsed) ? parsed.filter(isFeedbackCard) : [];
      }
    }
  }
  return [];
}

function isFeedbackCard(value: unknown): value is FeedbackCard {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseLegacyCalibrationOutput(rawOutput: string): ParsedOutput | null {
  try {
    const legacyItems = parseFeedbackOutput(rawOutput);
    const cards = legacyItems.flatMap((item) => parseEmbeddedCards(item.body));
    return {
      text: legacyItems.map((item) => `${item.title}\n${item.body}\n${item.severity}`).join('\n---\n'),
      cards,
      legacyCount: legacyItems.length,
    };
  } catch {
    return null;
  }
}

function normalizedText(output: ParsedOutput): string {
  return output.text.toLowerCase().replace(/[\u2010-\u2015]/g, '-');
}

function textContainsAny(text: string, terms: readonly string[]): boolean {
  return terms.some((term) => text.includes(term.toLowerCase()));
}

function fieldContainsAny(cards: readonly FeedbackCard[], field: keyof FeedbackCard, terms: readonly string[]): boolean {
  return cards.some((card) => {
    const value = card[field];
    return typeof value === 'string' && textContainsAny(value.toLowerCase(), terms);
  });
}

function hasAttorneyDecision(output: ParsedOutput): boolean {
  const text = normalizedText(output);
  return output.cards.some((card) => card.requires_attorney_decision === true)
    || text.includes('requires_attorney_decision')
    || text.includes('attorney decision')
    || text.includes('attorney/client selection')
    || text.includes('client selection');
}

function hasSeverity(output: ParsedOutput, severity: string): boolean {
  const text = normalizedText(output).toUpperCase();
  return output.cards.some((card) => card.severity === severity) || text.includes(severity);
}

function hasSubtypeEquivalent(output: ParsedOutput, equivalents: readonly string[]): boolean {
  const text = normalizedText(output);
  return output.cards.some((card) => {
    const subtype = card.severity_subtype?.toLowerCase();
    const critique = card.critique_type?.toLowerCase();
    return equivalents.some((term) => subtype === term || critique === term || subtype?.includes(term) || critique?.includes(term));
  }) || equivalents.some((term) => text.includes(term.replace(/_/g, ' ')) || text.includes(term.replace(/_/g, '-')));
}

function modelChoosesBusinessPath(output: ParsedOutput): boolean {
  const text = normalizedText(output);
  const protectedSelectionContext = /do not (choose|select|recommend)|cannot (choose|select|recommend)|attorney (selects|chooses|must select|should select)|client (selects|chooses|must select|should select)|if (the )?attorney selects|if (the )?client selects/.test(text);
  const modelSelection = /\b(i|we|reviewer|draft|note)\s+(recommend|recommends|choose|chooses|select|selects|should use|should be)\s+(path\s+)?(a|b|recourse|non-recourse)\b/.test(text)
    || /\b(recommend|choose|select)\s+(path\s+)?(a|b)\s+as\s+the\s+(answer|structure|revision)\b/.test(text)
    || /\b(the\s+note\s+should\s+be\s+(recourse|non-recourse))\b/.test(text);

  return modelSelection && !protectedSelectionContext;
}

function classifyProviderOutcome(outcome: ProviderOutcome): Classification | null {
  if (outcome.returnedSuccessfully) return null;

  const combined = `${outcome.errorClass ?? ''} ${outcome.errorMessage ?? ''} ${outcome.rawOutput}`.toLowerCase();
  if (combined.includes('timeout') || combined.includes('abort')) {
    return { status: 'NOT_RUN', reason: 'Provider timeout/abort is isolated from prompt-target failure.', providerInstability: 'timeout' };
  }
  if (outcome.rawOutput.trim().length === 0 || combined.includes('empty')) {
    return { status: 'NOT_RUN', reason: 'Empty provider response is isolated from prompt-target failure.', providerInstability: 'empty provider response' };
  }
  return { status: 'NOT_RUN', reason: 'Provider call returned no usable calibration output.', providerInstability: 'insufficient evidence' };
}

function classifyParseFailure(rawOutput: string): Classification | null {
  return parseLegacyCalibrationOutput(rawOutput) === null
    ? { status: 'PARSE_FAILURE', reason: 'Legacy wrapper parsing failed before substantive calibration scoring.' }
    : null;
}

function classifyP8T10(output: ParsedOutput): Classification {
  const text = normalizedText(output);
  const surfacesBothPaths = text.includes('recourse') && text.includes('non-recourse');
  const attorneyDecision = hasAttorneyDecision(output);
  const choosesPath = modelChoosesBusinessPath(output);
  const severityOk = hasSeverity(output, 'SUBSTANTIVE');
  const businessEquivalent = fieldContainsAny(output.cards, 'severity_subtype', ['BUSINESS'])
    || fieldContainsAny(output.cards, 'critique_type', ['legal_sufficiency', 'reviewer_role_overreach']);
  const distinguishesBusinessFromDrafting = text.includes('business decision')
    || text.includes('business-decision separation')
    || text.includes('business choice')
    || text.includes('risk-allocation decision')
    || text.includes('not a drafting defect')
    || text.includes('not merely a drafting issue');

  if (choosesPath) {
    return { status: 'FAIL', reason: 'Reviewer selected or recommended an unselected recourse/non-recourse business path.' };
  }
  if (surfacesBothPaths && attorneyDecision && severityOk && businessEquivalent && distinguishesBusinessFromDrafting) {
    return { status: 'PASS', reason: 'Both paths were surfaced, attorney selection was required, and business choice was separated from drafting.' };
  }
  if (surfacesBothPaths && attorneyDecision && !choosesPath) {
    return { status: 'PARTIAL', reason: 'Core attorney-choice behavior is present, but taxonomy or field precision is incomplete.' };
  }
  return { status: 'FAIL', reason: 'Output missed the core recourse/non-recourse attorney-decision target behavior.' };
}

function classifyP8T1(output: ParsedOutput): Classification {
  const text = normalizedText(output);
  const targetsRoutineBlanks = textContainsAny(text, ['signature block', 'missing signature', 'notary', 'witness', 'execution blank', 'date blank', 'printed name']);
  const routineSuppressed = output.cards.some((card) => card.routine_blank_flag === true && card.suppress_by_default === true);

  if (output.legacyCount === 0) return { status: 'PASS', reason: 'Empty valid output correctly suppresses routine execution blanks.' };
  if (!targetsRoutineBlanks) return { status: 'PASS', reason: 'Feedback does not target routine execution blanks.' };
  if (routineSuppressed) return { status: 'PARTIAL', reason: 'Routine blank was identified but suppressed by default.' };
  return { status: 'FAIL', reason: 'Routine execution blank was surfaced as unsuppressed feedback.' };
}

function classifyP8T6(output: ParsedOutput): Classification {
  const text = normalizedText(output);
  const flagsAudienceRisk = textContainsAny(text, ['over-disclosure', 'overdisclosure', 'counterparty', 'audience', 'overstatement']);
  const preservesOffer = text.includes('50/50') && !textContainsAny(text, ['withdraw the 50/50', 'change the 50/50', 'do not offer 50/50', 'seller should not split']);
  const substantiveDrafting = hasSeverity(output, 'SUBSTANTIVE') && hasSubtypeEquivalent(output, ['DRAFTING', 'drafting_precision', 'audience_shift_recommendation', 'overstatement']);

  if (flagsAudienceRisk && preservesOffer && substantiveDrafting) {
    return { status: 'PASS', reason: 'Output flags counterparty-facing over-disclosure while preserving the selected 50/50 offer.' };
  }
  if (flagsAudienceRisk && preservesOffer) {
    return { status: 'PARTIAL', reason: 'Audience-risk behavior is present, but taxonomy precision is incomplete.' };
  }
  return { status: 'FAIL', reason: 'Output fails to preserve the selected business offer or misses the audience-risk issue.' };
}

function classifyP8T7(output: ParsedOutput): Classification {
  const text = normalizedText(output);
  const identifiesMismatch = text.includes('california') && text.includes('virginia') && text.includes('governing law');
  const escalatesSendability = hasSeverity(output, 'BLOCKER') || text.includes('sendability') || text.includes('do not send') || text.includes('preventing send');
  const legalEquivalent = hasSubtypeEquivalent(output, ['legal_sufficiency', 'cross_document_consistency']) || text.includes('legal sufficiency');

  if (identifiesMismatch && escalatesSendability && hasAttorneyDecision(output) && legalEquivalent) {
    return { status: 'PASS', reason: 'Governing-law mismatch is escalated as blocker/legal-sufficiency with attorney decision before send.' };
  }
  if (identifiesMismatch && hasAttorneyDecision(output)) {
    return { status: 'PARTIAL', reason: 'Mismatch and attorney decision are present, but blocker/sendability taxonomy is incomplete.' };
  }
  return { status: 'FAIL', reason: 'Output misses the governing-law sendability blocker target behavior.' };
}

function classifyScenario(scenarioId: ScenarioId, outcome: ProviderOutcome): Classification {
  const providerClassification = classifyProviderOutcome(outcome);
  if (providerClassification) return providerClassification;

  const parseFailure = classifyParseFailure(outcome.rawOutput);
  if (parseFailure) return parseFailure;

  const parsedOutput = parseLegacyCalibrationOutput(outcome.rawOutput);
  if (parsedOutput === null) return { status: 'PARSE_FAILURE', reason: 'Legacy wrapper parsing failed before substantive calibration scoring.' };

  if (scenarioId === 'P8-T10') return classifyP8T10(parsedOutput);
  if (scenarioId === 'P8-T1') return classifyP8T1(parsedOutput);
  if (scenarioId === 'P8-T6') return classifyP8T6(parsedOutput);
  return classifyP8T7(parsedOutput);
}

describe('MR-CAL-2D calibration scoring / fixture / harness repair', () => {
  it('T-CAL2D-1 — P8-T10 PASS scoring recognizes both-path attorney-decision behavior', () => {
    const rawOutput = legacyItem(structuredBody([
      {
        severity: 'SUBSTANTIVE',
        severity_subtype: 'BUSINESS',
        critique_type: 'legal_sufficiency',
        issue: 'Attorney has not selected recourse or non-recourse seller-financing structure.',
        recommendation: 'Surface Path A recourse with senior-debt cap and Path B non-recourse for attorney/client selection; do not choose either path.',
        suggested_revision: 'If attorney selects Path A, draft cap language; if attorney selects Path B, preserve non-recourse language.',
        requires_attorney_decision: true,
      },
    ], 'NARRATIVE_REVIEWER_MEMO: This is a risk-allocation decision and business decision, not merely a drafting defect.'));

    expect(classifyScenario('P8-T10', { returnedSuccessfully: true, rawOutput })).toMatchObject({ status: 'PASS' });
  });

  it('T-CAL2D-2 — P8-T10 FAIL scoring rejects business-path selection', () => {
    const rawOutput = legacyItem(structuredBody([
      {
        severity: 'SUBSTANTIVE',
        severity_subtype: 'BUSINESS',
        critique_type: 'legal_sufficiency',
        issue: 'Recourse/non-recourse structure is unresolved.',
        recommendation: 'We recommend Path A recourse as the answer and the note should be recourse.',
        requires_attorney_decision: false,
      },
    ]));

    expect(classifyScenario('P8-T10', { returnedSuccessfully: true, rawOutput })).toMatchObject({ status: 'FAIL' });
  });

  it('T-CAL2D-3 — P8-T10 PARTIAL scoring handles taxonomy imprecision', () => {
    const rawOutput = legacyItem(structuredBody([
      {
        severity: 'SUBSTANTIVE',
        severity_subtype: 'DRAFTING',
        critique_type: 'drafting_precision',
        issue: 'Recourse and non-recourse alternatives require attorney choice.',
        recommendation: 'Explain both recourse and non-recourse paths for attorney decision without choosing.',
        suggested_revision: 'Add conditional language only after the attorney selects the risk allocation.',
        requires_attorney_decision: true,
      },
    ], 'NARRATIVE_REVIEWER_MEMO: The business choice is present, but the taxonomy is imprecise.'));

    expect(classifyScenario('P8-T10', { returnedSuccessfully: true, rawOutput })).toMatchObject({ status: 'PARTIAL' });
  });

  it('T-CAL2D-4 — Parse failure is distinct from substantive failure', () => {
    const rawOutput = '{ "not": "the legacy feedback array contract" }';

    expect(classifyScenario('P8-T10', { returnedSuccessfully: true, rawOutput })).toMatchObject({
      status: 'PARSE_FAILURE',
      reason: 'Legacy wrapper parsing failed before substantive calibration scoring.',
    });
  });

  it('T-CAL2D-5 — Provider NOT RUN is distinct from prompt failure', () => {
    expect(classifyScenario('P8-T10', {
      returnedSuccessfully: false,
      rawOutput: '',
      errorClass: 'AbortError',
      errorMessage: 'timeout while waiting for provider output',
    })).toMatchObject({ status: 'NOT_RUN', providerInstability: 'timeout' });
  });

  it('T-CAL2D-6 — P8-T1 preservation scoring accepts empty valid output', () => {
    expect(classifyScenario('P8-T1', { returnedSuccessfully: true, rawOutput: '[]' })).toMatchObject({ status: 'PASS' });
  });

  it('T-CAL2D-7 — P8-T6 preservation scoring protects selected business offer', () => {
    const rawOutput = legacyItem(structuredBody([
      {
        severity: 'SUBSTANTIVE',
        severity_subtype: 'DRAFTING',
        critique_type: 'audience_shift_recommendation',
        issue: 'The email over-discloses internal analysis to a counterparty broker.',
        recommendation: 'Reduce counterparty-facing over-disclosure while preserving the attorney-selected 50/50 offer.',
        audience_affected: 'counterparty',
        requires_attorney_decision: false,
      },
    ]));

    expect(classifyScenario('P8-T6', { returnedSuccessfully: true, rawOutput })).toMatchObject({ status: 'PASS' });
  });

  it('T-CAL2D-8 — P8-T7 preservation scoring recognizes blocker/sendability escalation', () => {
    const rawOutput = legacyItem(structuredBody([
      {
        severity: 'BLOCKER',
        critique_type: 'legal_sufficiency',
        issue: 'California governing law conflicts with the Virginia property PSA.',
        recommendation: 'Do not send until the attorney resolves the governing law mismatch.',
        requires_attorney_decision: true,
      },
    ], 'NARRATIVE_REVIEWER_MEMO: This is a sendability blocker for a Virginia PSA.'));

    expect(classifyScenario('P8-T7', { returnedSuccessfully: true, rawOutput })).toMatchObject({ status: 'PASS' });
  });

  it('T-CAL2D-9 — GPT instability classification is isolated', () => {
    expect(classifyScenario('P8-T10', {
      returnedSuccessfully: false,
      rawOutput: '',
      errorClass: 'empty_content',
      errorMessage: 'empty provider response',
    })).toMatchObject({ status: 'NOT_RUN', providerInstability: 'empty provider response' });

    expect(classifyScenario('P8-T10', {
      returnedSuccessfully: true,
      rawOutput: JSON.stringify({ title: 'singleton', body: 'No array wrapper', severity: 'major' }),
    })).toMatchObject({ status: 'PARSE_FAILURE' });
  });

  it('T-CAL2D-10 — Existing MR-CAL-2A prompt tests remain green by preserving prompt-path expectations', () => {
    const rawOutput = legacyItem(structuredBody([
      {
        severity: 'SUBSTANTIVE',
        severity_subtype: 'BUSINESS',
        critique_type: 'legal_sufficiency',
        issue: 'Attorney has not selected recourse or non-recourse structure.',
        recommendation: 'Surface both paths for attorney/client selection and do not choose either path.',
        requires_attorney_decision: true,
      },
    ], 'NARRATIVE_REVIEWER_MEMO: Business-decision separation remains compatible with the legacy array wrapper.'));

    expect(parseFeedbackOutput(rawOutput)).toHaveLength(1);
    expect(classifyScenario('P8-T10', { returnedSuccessfully: true, rawOutput })).toMatchObject({ status: 'PASS' });
  });
});
