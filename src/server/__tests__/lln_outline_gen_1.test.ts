/**
 * LLN-OUTLINE-GEN-1 — Structured output + tolerant parsing for outline generation
 *
 * Proves parseGeneratedOutlineSections accepts the normal LLM output shapes
 * (raw array, already-parsed array, markdown-fenced array, single-key and known
 * object wrappers) while still failing loudly on malformed/empty output, and that
 * outline.generate / outline.regenerate now enforce a structured-output schema,
 * surface failure visibly, and clean up the txn1 outline on a failed generate.
 *
 * Mirrors mr_ir_gen_2.test.ts (the equivalent fix for information-request generation).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  parseGeneratedOutlineSections,
  OutlineSectionsSchema,
} from '../procedures/outlineParse.js';

const SECTIONS = [
  { title: 'Recitals', description: 'Background and parties.' },
  { title: 'Grant of Authority', description: 'Powers conferred on the agent.' },
];

describe('LLN-OUTLINE-GEN-1 parseGeneratedOutlineSections — accepted shapes', () => {
  it('1. raw JSON array string works', () => {
    const sections = parseGeneratedOutlineSections(JSON.stringify(SECTIONS));
    expect(sections).toHaveLength(2);
    expect(sections[0]).toEqual(SECTIONS[0]);
  });

  it('2. already-parsed array works', () => {
    expect(parseGeneratedOutlineSections(SECTIONS)).toHaveLength(2);
  });

  it('3. markdown-fenced JSON array works (```json fence)', () => {
    const fenced = '```json\n' + JSON.stringify(SECTIONS) + '\n```';
    expect(parseGeneratedOutlineSections(fenced)).toHaveLength(2);
  });

  it('3b. bare ``` fence (no json tag) works', () => {
    const fenced = '```\n' + JSON.stringify(SECTIONS) + '\n```';
    expect(parseGeneratedOutlineSections(fenced)).toHaveLength(2);
  });

  it('4. single-key { "sections": [...] } wrapper works', () => {
    expect(parseGeneratedOutlineSections(JSON.stringify({ sections: SECTIONS }))).toHaveLength(2);
  });

  it('5. { "outline": [...] } wrapper works', () => {
    expect(parseGeneratedOutlineSections(JSON.stringify({ outline: SECTIONS }))).toHaveLength(2);
  });

  it('5b. fenced object wrapper works', () => {
    const fenced = '```json\n' + JSON.stringify({ document_outline: SECTIONS }) + '\n```';
    expect(parseGeneratedOutlineSections(fenced)).toHaveLength(2);
  });

  it('6. a section with a title but no description defaults description to ""', () => {
    const sections = parseGeneratedOutlineSections(JSON.stringify([{ title: 'Signatures' }]));
    expect(sections).toHaveLength(1);
    expect(sections[0]).toEqual({ title: 'Signatures', description: '' });
  });
});

describe('LLN-OUTLINE-GEN-1 parseGeneratedOutlineSections — rejected shapes', () => {
  it('7. malformed JSON throws OUTLINE_GENERATION_MALFORMED', () => {
    expect(() => parseGeneratedOutlineSections('not json at all')).toThrow(
      /OUTLINE_GENERATION_MALFORMED/,
    );
  });

  it('8. object with no candidate array throws OUTLINE_GENERATION_MALFORMED', () => {
    expect(() => parseGeneratedOutlineSections(JSON.stringify({ foo: 'bar', count: 3 }))).toThrow(
      /OUTLINE_GENERATION_MALFORMED/,
    );
  });

  it('8b. object with multiple competing known array wrappers is ambiguous → MALFORMED', () => {
    const ambiguous = JSON.stringify({ sections: SECTIONS, outline: SECTIONS });
    expect(() => parseGeneratedOutlineSections(ambiguous)).toThrow(/OUTLINE_GENERATION_MALFORMED/);
  });

  it('9. empty array throws OUTLINE_GENERATION_EMPTY', () => {
    expect(() => parseGeneratedOutlineSections('[]')).toThrow(/OUTLINE_GENERATION_EMPTY/);
  });

  it('10. array with no usable sections (missing/empty title) throws OUTLINE_GENERATION_EMPTY', () => {
    const raw = JSON.stringify([{ description: 'no title' }, { title: '   ' }]);
    expect(() => parseGeneratedOutlineSections(raw)).toThrow(/OUTLINE_GENERATION_EMPTY/);
  });

  it('drops unusable sections but keeps usable ones', () => {
    const raw = JSON.stringify([SECTIONS[0], { description: 'orphan' }, { title: '' }]);
    expect(parseGeneratedOutlineSections(raw)).toHaveLength(1);
  });
});

describe('LLN-OUTLINE-GEN-1 OutlineSectionsSchema', () => {
  it('validates a well-formed section array and strips extra fields (e.g. orderIndex)', () => {
    const parsed = OutlineSectionsSchema.parse([
      { title: 'Recitals', description: 'Background.', orderIndex: 0 },
    ]);
    expect(parsed[0]).toEqual({ title: 'Recitals', description: 'Background.' });
  });

  it('rejects a section missing title', () => {
    expect(OutlineSectionsSchema.safeParse([{ description: 'Background.' }]).success).toBe(false);
  });
});

describe('LLN-OUTLINE-GEN-1 outline wiring — source audit', () => {
  const repoRoot = resolve(__dirname, '../../..');
  const procSource = readFileSync(resolve(repoRoot, 'src/server/procedures/outline.ts'), 'utf8');

  it('generate and regenerate pass the structured-output schema to the LLM call', () => {
    expect(procSource).toContain('OutlineSectionsSchema');
    const matches = procSource.match(/structuredOutputSchema: OutlineSectionsSchema/g) ?? [];
    expect(matches.length).toBe(2);
  });

  it('parses with the tolerant parser instead of the prior silent-empty try/catch', () => {
    expect(procSource).toContain('parseGeneratedOutlineSections(output)');
    expect(procSource).not.toContain('// Leave sections empty');
  });

  it('marks the txn1 outline skipped on a failed generate (clean retry)', () => {
    expect(procSource).toContain("await updateDocumentOutline(closureOutlineId, userId, { status: 'skipped' })");
  });

  it('surfaces generation/regeneration failure to the caller', () => {
    const matches = procSource.match(/OUTLINE_GENERATION_FAILED/g) ?? [];
    expect(matches.length).toBe(2);
  });
});
