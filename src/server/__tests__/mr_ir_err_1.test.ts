/**
 * MR-IR-ERR-1 — Information Request empty/parse-failure visibility
 *
 * Proves that question-matrix generation cannot silently produce an
 * apparently-successful empty questionnaire:
 *   1. Valid output still yields items (successful behavior preserved).
 *   2. Malformed (non-JSON / non-array) output throws IR_GENERATION_MALFORMED.
 *   3. An empty / all-invalid parsed item list throws IR_GENERATION_EMPTY.
 *   4. The generate procedure wires the parse-or-throw into txn2Commit, archives
 *      the matrix on revert, and surfaces a clear failure (IR_GENERATION_FAILED).
 *   5. The client renders a visible generation-failure state.
 *
 * The parse contract is tested behaviorally against the pure helper. The
 * procedure/UI wiring is verified by source audit (the established pattern in
 * this repo for procedure-level changes; see mr_uat_materials_2.code_audit).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseGeneratedMatrixItems } from '../procedures/informationRequestParse.js';

describe('MR-IR-ERR-1 parseGeneratedMatrixItems — behavioral contract', () => {
  it('returns usable items for a valid JSON array string (successful behavior preserved)', () => {
    const raw = JSON.stringify([
      { category: 'Parties', questionText: 'Who is the principal?' },
      { category: 'Parties', questionText: 'Who is the agent?' },
    ]);
    const items = parseGeneratedMatrixItems(raw);
    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({ category: 'Parties', questionText: 'Who is the principal?' });
  });

  it('accepts an already-parsed array value (non-string output)', () => {
    const items = parseGeneratedMatrixItems([
      { category: 'Assets', questionText: 'List the real property.' },
    ]);
    expect(items).toHaveLength(1);
  });

  it('drops items missing required fields but keeps usable ones', () => {
    const raw = JSON.stringify([
      { category: 'Parties', questionText: 'Who is the principal?' },
      { category: 'Parties' }, // missing questionText — dropped
      { questionText: 'orphan' }, // missing category — dropped
    ]);
    const items = parseGeneratedMatrixItems(raw);
    expect(items).toHaveLength(1);
  });

  it('throws IR_GENERATION_MALFORMED for non-JSON output', () => {
    expect(() => parseGeneratedMatrixItems('not json at all')).toThrow(/IR_GENERATION_MALFORMED/);
  });

  it('throws IR_GENERATION_MALFORMED when output is a JSON object with no array value', () => {
    // MR-IR-GEN-2: single-key array wrappers are now tolerated, so this case uses
    // an object whose value is not an array — still rejected as malformed.
    expect(() => parseGeneratedMatrixItems('{"feedback": "not an array"}')).toThrow(/IR_GENERATION_MALFORMED/);
  });

  it('throws IR_GENERATION_EMPTY for an empty array (no silent empty success)', () => {
    expect(() => parseGeneratedMatrixItems('[]')).toThrow(/IR_GENERATION_EMPTY/);
  });

  it('throws IR_GENERATION_EMPTY when every element is unusable', () => {
    const raw = JSON.stringify([{ foo: 'bar' }, { category: 1, questionText: 2 }]);
    expect(() => parseGeneratedMatrixItems(raw)).toThrow(/IR_GENERATION_EMPTY/);
  });
});

describe('MR-IR-ERR-1 generate wiring — source audit', () => {
  const repoRoot = resolve(__dirname, '../../..');
  const procSource = readFileSync(
    resolve(repoRoot, 'src/server/procedures/informationRequest.ts'),
    'utf8',
  );
  const pageSource = readFileSync(
    resolve(repoRoot, 'src/client/pages/InformationRequestPage.tsx'),
    'utf8',
  );

  it('txn2Commit parses-or-throws via parseGeneratedMatrixItems (empty catch removed)', () => {
    expect(procSource).toContain('parseGeneratedMatrixItems');
    expect(procSource).toContain("from './informationRequestParse.js'");
    expect(procSource).toContain('const items = parseGeneratedMatrixItems(output);');
    // The old silent fallback comment must be gone.
    expect(procSource).not.toContain('leave matrix empty — attorney can add questions manually');
  });

  it('txn2Revert archives the matrix created in txn1 so failure leaves no active empty questionnaire', () => {
    expect(procSource).toContain('await archiveInformationRequest(closureMatrixId, userId);');
  });

  it('generate surfaces a clear failure when the job did not complete', () => {
    expect(procSource).toContain("result.status !== 'completed'");
    expect(procSource).toContain('IR_GENERATION_FAILED');
  });

  it('InformationRequestPage renders a visible generation-failure banner and refreshes on error', () => {
    expect(pageSource).toContain('generateMutation.error');
    expect(pageSource).toContain('Question generation failed');
    expect(pageSource).toContain('onError:');
  });
});
