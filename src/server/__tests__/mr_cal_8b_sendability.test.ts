/**
 * MR-CAL-8B — Sendability gate (advisory LLM classifier)
 *
 * Covers: the SendabilityVerdict Zod contract, the tolerant parser, the advisory
 * prompt, and source-audits of the wiring (read-only checkSendability query;
 * degrade-to-unavailable; finalize procedures UNCHANGED + NOT gated; UI surfaces
 * in ReviewPane + DocumentDetail; advisory-only, no override table/migration).
 *
 * Pure-unit + source-audit (no DB / no live LLM), matching the MR-CAL-5C/6B/7B
 * style, so they run deterministically in CI.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { SendabilityVerdictSchema } from '../../shared/schemas/phase4b.js';
import { parseSendabilityOutput } from '../llm/parsers/sendabilityOutputParse.js';
import {
  buildSendabilitySystemPrompt,
  buildSendabilityUserPrompt,
} from '../llm/prompts/sendabilityPrompt.js';

const VALID = {
  sendable: false,
  blockers: [
    { category: 'jurisdiction_mismatch', severity: 'BLOCKER', summary: 'Governing law left blank.' },
    { category: 'unresolved_blanks', severity: 'SUBSTANTIVE', summary: 'Legal description missing.' },
  ],
  notes: 'Resolve the governing-law clause before sending.',
};

describe('MR-CAL-8B SendabilityVerdictSchema', () => {
  it('accepts the canonical verdict shape', () => {
    expect(SendabilityVerdictSchema.safeParse(VALID).success).toBe(true);
  });

  it('accepts a sendable verdict with no blockers and no notes', () => {
    expect(SendabilityVerdictSchema.safeParse({ sendable: true, blockers: [] }).success).toBe(true);
  });

  it('rejects an unknown blocker category', () => {
    expect(
      SendabilityVerdictSchema.safeParse({ sendable: false, blockers: [{ category: 'typo', severity: 'BLOCKER', summary: 'x' }] }).success,
    ).toBe(false);
  });

  it('rejects an unknown severity', () => {
    expect(
      SendabilityVerdictSchema.safeParse({ sendable: false, blockers: [{ category: 'other', severity: 'CRITICAL', summary: 'x' }] }).success,
    ).toBe(false);
  });

  it('requires the sendable boolean', () => {
    expect(SendabilityVerdictSchema.safeParse({ blockers: [] }).success).toBe(false);
  });
});

describe('MR-CAL-8B parseSendabilityOutput', () => {
  it('parses a JSON string', () => {
    const v = parseSendabilityOutput(JSON.stringify(VALID));
    expect(v.sendable).toBe(false);
    expect(v.blockers).toHaveLength(2);
  });

  it('parses an already-parsed object', () => {
    expect(parseSendabilityOutput(VALID).blockers).toHaveLength(2);
  });

  it('throws on malformed JSON (caller degrades to unavailable)', () => {
    expect(() => parseSendabilityOutput('{not json')).toThrow();
  });

  it('throws on a non-conforming verdict', () => {
    expect(() => parseSendabilityOutput(JSON.stringify({ sendable: 'maybe', blockers: [] }))).toThrow();
  });
});

describe('MR-CAL-8B sendability prompts', () => {
  it('system prompt is advisory, non-blocking, and enumerates the gate categories', () => {
    const sys = buildSendabilitySystemPrompt();
    expect(sys).toMatch(/ADVISORY/);
    expect(sys).toMatch(/never block/i);
    expect(sys).toContain('jurisdiction_mismatch');
    expect(sys).toContain('counterparty_over_disclosure');
    expect(sys).toMatch(/do NOT flag routine pre-execution signature/i);
  });

  it('user prompt includes the draft content and feedback signal', () => {
    const user = buildSendabilityUserPrompt({
      documentTitle: 'POA',
      documentType: 'Durable_poa',
      iterationNumber: 2,
      content: 'THE DOCUMENT BODY',
      feedbackRows: [
        { reviewerRole: 'gpt_lite', reviewerTitle: 'GPT Lite', suggestions: [{ suggestionId: 'a', title: 'Gov law', body: 'missing', severity: 'critical' }] },
      ],
    });
    expect(user).toContain('## Current Draft');
    expect(user).toContain('THE DOCUMENT BODY');
    expect(user).toContain('GPT Lite');
  });
});

describe('MR-CAL-8B query wiring (source audit)', () => {
  const src = readFileSync(resolve('src/server/procedures/reviewSession.ts'), 'utf8');

  it('exposes a read-only checkSendability QUERY (not a mutation)', () => {
    const idx = src.indexOf('checkSendability: protectedProcedure');
    expect(idx).toBeGreaterThan(-1);
    const block = src.slice(idx, idx + 400);
    expect(block).toContain('.query(');
    expect(block).not.toContain('.mutation(');
  });

  it('runs the classifier via the adapter with an explicit 300s timeout (no job/persistence)', () => {
    const idx = src.indexOf('checkSendability: protectedProcedure');
    const block = src.slice(idx, idx + 2600);
    expect(block).toContain('resolveAdapter(EVALUATOR_MODEL)');
    expect(block).toContain('AbortSignal.timeout(300_000)');
    expect(block).toContain('structuredOutputSchema: SendabilityVerdictSchema');
    expect(block).not.toContain('executeCanonicalMutation');
    expect(block).not.toContain('insert'); // no persistence
  });

  it('degrades to { available: false } on classifier/parse failure (never throws to client)', () => {
    const idx = src.indexOf('checkSendability: protectedProcedure');
    const block = src.slice(idx, idx + 3600);
    expect(block).toContain('try {');
    expect(block).toContain('available: false');
    // sendability_check_failed is unique to this query's catch path.
    expect(src).toContain("'sendability_check_failed'");
  });

  it('emits sendability_checked telemetry on success', () => {
    expect(src).toContain("'sendability_checked'");
  });
});

describe('MR-CAL-8B advisory-only: finalize is NOT gated (source audit)', () => {
  it('the finalize/accept procedures do not reference sendability (gate cannot block send)', () => {
    const docs4a = readFileSync(resolve('src/server/procedures/documents4a.ts'), 'utf8');
    expect(docs4a.toLowerCase()).not.toContain('sendab');
  });

  it('no sendability override table/migration was added (advisory-only, decision #3)', () => {
    const schema = readFileSync(resolve('src/server/db/schema.ts'), 'utf8');
    expect(schema.toLowerCase()).not.toContain('sendability_overrides');
    expect(schema.toLowerCase()).not.toContain('sendabilityoverrides');
  });
});

describe('MR-CAL-8B UI wiring (source audit)', () => {
  const reviewPane = readFileSync(resolve('src/client/components/ReviewPane.tsx'), 'utf8');
  const docDetail = readFileSync(resolve('src/client/pages/DocumentDetail.tsx'), 'utf8');

  it('SendabilitySection exists in ReviewPane and is on-demand (enabled:false)', () => {
    expect(reviewPane).toContain('export function SendabilitySection');
    expect(reviewPane).toContain('trpc.reviewSession.checkSendability.useQuery');
    expect(reviewPane).toContain('{ enabled: false }');
  });

  it('SendabilitySection renders in the active session view', () => {
    expect(reviewPane).toContain('<SendabilitySection documentId={documentId} />');
  });

  it('DocumentDetail surfaces SendabilitySection at the finalize boundary', () => {
    expect(docDetail).toContain('SendabilitySection');
    expect(docDetail).toContain("import ReviewPane, { SendabilitySection }");
  });

  it('the advisory note (does not block finalize) is present', () => {
    expect(reviewPane).toContain('does not block finalize');
  });
});
