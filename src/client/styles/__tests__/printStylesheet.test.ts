/**
 * R2 #9 (R3 polish) — print stylesheet regression test.
 *
 * The print layer is pure CSS (@media print), so it has no JS render path and jsdom cannot exercise
 * print media. This test instead pins the INTENT (not exact spelling) by reading globals.css: a print
 * block exists and it drops app chrome + interactive controls. LF-safe (reads the file, no \n literals).
 * File read mirrors the proven mr_cal_5c source-scan pattern (resolve from the vitest CWD = repo root).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const css = readFileSync(resolve('src/client/styles/globals.css'), 'utf8');

describe('print stylesheet (R2 #9)', () => {
  it('defines an @media print block', () => {
    expect(/@media\s+print/.test(css)).toBe(true);
  });

  it('hides app chrome and interactive controls in print', () => {
    const printBlock = css.slice(css.search(/@media\s+print/));
    expect(printBlock).toMatch(/\baside\b/);
    expect(printBlock).toMatch(/\bnav\b/);
    expect(printBlock).toMatch(/\bbutton\b/);
    expect(printBlock).toMatch(/display:\s*none/);
  });
});
