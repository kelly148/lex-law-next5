/**
 * DEED-INTAKE-POLISH-1 — source-audits for YELLOW-5 (deterministic describe-box parse) and YELLOW-4 (banner).
 * (YELLOW-6, the assembler dedup, is covered behaviorally in deed_gift_assembler.test.ts.)
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf-8');

describe('DEED-INTAKE-POLISH-1 (YELLOW-5) — deterministic describe-box parse', () => {
  const src = read('src/server/procedures/deedDraftAgent.ts');
  it('both intake propose dispatches use temperature 0 (removes the clarify-gate run-to-run variance)', () => {
    // The clarify/parse LOGIC is unchanged since ff395f4 (git-verified) — the flake was model variance; 0 fixes it.
    expect(src).not.toContain('temperature: 0.1');
    expect((src.match(/temperature: 0,/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});

describe('DEED-INTAKE-POLISH-1 (YELLOW-4) — describe-box banner notes grantors still need entry', () => {
  it('the proposed banner tells the user grantor names are not proposed and must be added', () => {
    const src = read('src/client/pages/CategoryDescribeBox.tsx');
    expect(src).toContain('Grantor (current-owner) names are not proposed');
  });
});
