/**
 * MR-CAL-4B - Native feedback-card runtime (migration-free display increment)
 *
 * Reviewers already emit STRUCTURED_FEEDBACK_CARDS embedded in the legacy
 * suggestion body. This increment extracts and surfaces those native fields for
 * display, without any DB migration and without altering the legacy path.
 *
 * Covers the extractor (extractEmbeddedFeedbackCards), the lenient display
 * schema, and a source audit of the server enrichment + client rendering wiring.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { extractEmbeddedFeedbackCards } from '../llm/parsers/embeddedFeedbackCards.js';
import {
  FeedbackCardDisplaySchema,
  hasDisplayableNativeFields,
} from '../../shared/schemas/feedbackCards.js';

const memo = 'NARRATIVE_REVIEWER_MEMO: Article II has a contradiction.\n';

function bodyWith(cardsJson: string): string {
  return `${memo}STRUCTURED_FEEDBACK_CARDS: ${cardsJson}`;
}

const FULL_CARD = {
  feedback_id: 'c1',
  severity: 'SUBSTANTIVE',
  severity_subtype: 'BUSINESS',
  critique_type: 'legal_sufficiency',
  issue: 'Governing-law mismatch',
  recommendation: 'Confirm the governing jurisdiction before send.',
  requires_attorney_decision: true,
  audience_affected: ['attorney', 'counterparty'],
  suggested_revision: 'Change governing law to Virginia.',
};

describe('MR-CAL-4B extractEmbeddedFeedbackCards - accepted', () => {
  it('extracts a full embedded card with native fields', () => {
    const cards = extractEmbeddedFeedbackCards(bodyWith(JSON.stringify([FULL_CARD])));
    expect(cards).toHaveLength(1);
    expect(cards[0]!.severity).toBe('SUBSTANTIVE');
    expect(cards[0]!.severity_subtype).toBe('BUSINESS');
    expect(cards[0]!.requires_attorney_decision).toBe(true);
    expect(cards[0]!.audience_affected).toContain('counterparty');
    expect(cards[0]!.suggested_revision).toMatch(/Virginia/);
  });

  it('extracts a partial card (lenient - severity + critique_type only)', () => {
    const cards = extractEmbeddedFeedbackCards(
      bodyWith(JSON.stringify([{ severity: 'PRECISION', critique_type: 'drafting_precision' }])),
    );
    expect(cards).toHaveLength(1);
    expect(cards[0]!.severity).toBe('PRECISION');
  });

  it('extracts multiple cards', () => {
    const cards = extractEmbeddedFeedbackCards(
      bodyWith(JSON.stringify([FULL_CARD, { severity: 'POLISH', issue: 'wording' }])),
    );
    expect(cards).toHaveLength(2);
  });

  it('tolerates audience_affected emitted as a string (live regression: Gemini)', () => {
    // Production reviewers (observed: Gemini) emit audience_affected as a single
    // string rather than an array. Before the display-schema fix this failed
    // safeParse and the entire card was dropped, so no native card rendered.
    const cards = extractEmbeddedFeedbackCards(
      bodyWith(
        JSON.stringify([
          {
            severity: 'SUBSTANTIVE',
            severity_subtype: 'DRAFTING',
            issue: 'Internal contradiction re: power to change beneficiary',
            requires_attorney_decision: true,
            audience_affected: 'Agent, Third Parties (Financial Institutions)',
          },
        ]),
      ),
    );
    expect(cards).toHaveLength(1);
    expect(cards[0]!.audience_affected).toEqual(['Agent, Third Parties (Financial Institutions)']);
    expect(cards[0]!.requires_attorney_decision).toBe(true);
  });

  it('is brace-aware: brackets inside string values do not end the scan', () => {
    const cards = extractEmbeddedFeedbackCards(
      bodyWith(JSON.stringify([{ issue: 'see [Exhibit A] and [B]', severity: 'POLISH' }])),
    );
    expect(cards).toHaveLength(1);
    expect(cards[0]!.issue).toMatch(/Exhibit A/);
  });
});

describe('MR-CAL-4B extractEmbeddedFeedbackCards - rejected / empty (never throws)', () => {
  it('returns [] when no STRUCTURED_FEEDBACK_CARDS marker is present', () => {
    expect(extractEmbeddedFeedbackCards('Just a narrative with no cards.')).toEqual([]);
  });

  it('returns [] for an unterminated / malformed array (no throw)', () => {
    expect(extractEmbeddedFeedbackCards(bodyWith('[not valid json'))).toEqual([]);
  });

  it('returns [] for valid JSON that is not an array', () => {
    expect(extractEmbeddedFeedbackCards(bodyWith('{"severity":"BLOCKER"}'))).toEqual([]);
  });

  it('filters out degenerate cards with no displayable native fields', () => {
    expect(extractEmbeddedFeedbackCards(bodyWith(JSON.stringify([{ feedback_id: 'x' }])))).toEqual([]);
  });

  it('returns [] for empty or non-string body', () => {
    expect(extractEmbeddedFeedbackCards('')).toEqual([]);
    // @ts-expect-error - exercising the runtime guard for non-string input
    expect(extractEmbeddedFeedbackCards(null)).toEqual([]);
  });
});

describe('MR-CAL-4B FeedbackCardDisplaySchema + hasDisplayableNativeFields', () => {
  it('leniently parses a partial card and reports displayable fields', () => {
    const parsed = FeedbackCardDisplaySchema.parse({ severity: 'BLOCKER', extra: 'ignored-but-kept' });
    expect(parsed.severity).toBe('BLOCKER');
    expect(hasDisplayableNativeFields(parsed)).toBe(true);
  });

  it('reports a card with only an id as not displayable', () => {
    expect(hasDisplayableNativeFields(FeedbackCardDisplaySchema.parse({ feedback_id: 'x' }))).toBe(false);
  });
});

describe('MR-CAL-4B wiring - source audit', () => {
  const repoRoot = resolve(__dirname, '../../..');
  const reviewSessionSrc = readFileSync(resolve(repoRoot, 'src/server/procedures/reviewSession.ts'), 'utf8');
  const reviewPaneSrc = readFileSync(resolve(repoRoot, 'src/client/components/ReviewPane.tsx'), 'utf8');

  it('reviewSession.get enriches suggestions with extractEmbeddedFeedbackCards', () => {
    expect(reviewSessionSrc).toContain('extractEmbeddedFeedbackCards');
    expect(reviewSessionSrc).toContain('nativeCards: extractEmbeddedFeedbackCards(s.body)');
  });

  it('ReviewPane renders native card fields with legacy fallback', () => {
    expect(reviewPaneSrc).toContain('suggestion.nativeCards');
    expect(reviewPaneSrc).toContain('Attorney decision required');
  });
});
