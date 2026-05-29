/**
 * MR-IR-GEN-2 — Structured output + tolerant parsing for IR generation
 *
 * Proves parseGeneratedMatrixItems accepts the normal LLM output shapes
 * (raw array, already-parsed array, markdown-fenced array, single-key and
 * known object wrappers) while still failing loudly on malformed/empty output,
 * and that informationRequest.generate now passes a structured-output schema.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  parseGeneratedMatrixItems,
  InformationRequestItemsSchema,
} from '../procedures/informationRequestParse.js';

const ITEMS = [
  { category: 'Parties', questionText: 'Who is the principal?' },
  { category: 'Parties', questionText: 'Who is the agent?' },
];

describe('MR-IR-GEN-2 parseGeneratedMatrixItems — accepted shapes', () => {
  it('1. raw JSON array string works', () => {
    const items = parseGeneratedMatrixItems(JSON.stringify(ITEMS));
    expect(items).toHaveLength(2);
    expect(items[0]).toEqual(ITEMS[0]);
  });

  it('2. already-parsed array works', () => {
    expect(parseGeneratedMatrixItems(ITEMS)).toHaveLength(2);
  });

  it('3. markdown-fenced JSON array works (```json fence)', () => {
    const fenced = '```json\n' + JSON.stringify(ITEMS) + '\n```';
    expect(parseGeneratedMatrixItems(fenced)).toHaveLength(2);
  });

  it('3b. bare ``` fence (no json tag) works', () => {
    const fenced = '```\n' + JSON.stringify(ITEMS) + '\n```';
    expect(parseGeneratedMatrixItems(fenced)).toHaveLength(2);
  });

  it('4. single-key { "questions": [...] } wrapper works', () => {
    expect(parseGeneratedMatrixItems(JSON.stringify({ questions: ITEMS }))).toHaveLength(2);
  });

  it('5. { "items": [...] } wrapper works', () => {
    expect(parseGeneratedMatrixItems(JSON.stringify({ items: ITEMS }))).toHaveLength(2);
  });

  it('5b. fenced object wrapper works', () => {
    const fenced = '```json\n' + JSON.stringify({ questionnaire: ITEMS }) + '\n```';
    expect(parseGeneratedMatrixItems(fenced)).toHaveLength(2);
  });
});

describe('MR-IR-GEN-2 parseGeneratedMatrixItems — rejected shapes', () => {
  it('6. malformed JSON throws IR_GENERATION_MALFORMED', () => {
    expect(() => parseGeneratedMatrixItems('not json at all')).toThrow(/IR_GENERATION_MALFORMED/);
  });

  it('7. object with no candidate array throws IR_GENERATION_MALFORMED', () => {
    expect(() => parseGeneratedMatrixItems(JSON.stringify({ foo: 'bar', count: 3 }))).toThrow(
      /IR_GENERATION_MALFORMED/,
    );
  });

  it('7b. object with multiple competing known array wrappers is ambiguous → MALFORMED', () => {
    const ambiguous = JSON.stringify({ questions: ITEMS, items: ITEMS });
    expect(() => parseGeneratedMatrixItems(ambiguous)).toThrow(/IR_GENERATION_MALFORMED/);
  });

  it('8. empty array throws IR_GENERATION_EMPTY', () => {
    expect(() => parseGeneratedMatrixItems('[]')).toThrow(/IR_GENERATION_EMPTY/);
  });

  it('9. array with no usable items throws IR_GENERATION_EMPTY', () => {
    const raw = JSON.stringify([{ foo: 'bar' }, { category: 1, questionText: 2 }]);
    expect(() => parseGeneratedMatrixItems(raw)).toThrow(/IR_GENERATION_EMPTY/);
  });

  it('drops unusable items but keeps usable ones', () => {
    const raw = JSON.stringify([ITEMS[0], { category: 'x' }, { questionText: 'y' }]);
    expect(parseGeneratedMatrixItems(raw)).toHaveLength(1);
  });
});

describe('MR-IR-GEN-2 InformationRequestItemsSchema', () => {
  it('validates a well-formed item array and strips extra fields', () => {
    const parsed = InformationRequestItemsSchema.parse([
      { category: 'Parties', questionText: 'Who?', extra: 'ignored' },
    ]);
    expect(parsed[0]).toEqual({ category: 'Parties', questionText: 'Who?' });
  });

  it('rejects an item missing questionText', () => {
    expect(InformationRequestItemsSchema.safeParse([{ category: 'Parties' }]).success).toBe(false);
  });
});

describe('MR-IR-GEN-2 generate wiring — source audit', () => {
  const repoRoot = resolve(__dirname, '../../..');
  const procSource = readFileSync(
    resolve(repoRoot, 'src/server/procedures/informationRequest.ts'),
    'utf8',
  );

  it('generate passes the structured-output schema to the LLM call', () => {
    expect(procSource).toContain('InformationRequestItemsSchema');
    expect(procSource).toContain('structuredOutputSchema: InformationRequestItemsSchema');
  });

  it('preserves MR-IR-ERR-1 failure behavior (parse-or-throw, archive, surfaced failure)', () => {
    expect(procSource).toContain('const items = parseGeneratedMatrixItems(output);');
    expect(procSource).toContain('await archiveInformationRequest(closureMatrixId, userId);');
    expect(procSource).toContain('IR_GENERATION_FAILED');
  });
});
