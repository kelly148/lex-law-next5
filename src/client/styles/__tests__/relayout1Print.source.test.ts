/**
 * RELAYOUT-1 — re-verify the print stylesheet against the new page-first DocumentDetail.
 *
 * The print layer is pure CSS (@media print); jsdom cannot exercise print media, so this pins
 * the INTENT by source scan (mirrors printStylesheet.test.ts / mr_cal_5c). The page-first relayout
 * changes WHAT is on the page, so the invariant to protect is: app furniture is marked
 * [data-no-print] (hidden on paper) while the document sheet itself is NOT — so a printed page is
 * just the document, and the body no longer sits behind a print-hidden expand button (the latent
 * print-blank on main).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const css = readFileSync(resolve('src/client/styles/globals.css'), 'utf8');
const detail = readFileSync(resolve('src/client/pages/DocumentDetail.tsx'), 'utf8');
const canvas = readFileSync(resolve('src/client/components/DocumentCanvas.tsx'), 'utf8');

describe('print stylesheet still drops chrome and honors the [data-no-print] hook', () => {
  it('keeps an @media print block hiding chrome/controls and the [data-no-print] escape hatch', () => {
    expect(/@media\s+print/.test(css)).toBe(true);
    const printBlock = css.slice(css.search(/@media\s+print/));
    expect(printBlock).toMatch(/\bbutton\b/);
    expect(printBlock).toContain('[data-no-print]');
    expect(printBlock).toMatch(/display:\s*none/);
  });
});

describe('RELAYOUT-1: only the document sheet prints', () => {
  it('renders the page-first DocumentCanvas in DocumentDetail', () => {
    expect(detail).toContain('<DocumentCanvas');
    expect(detail).toContain("from '../components/DocumentCanvas.js'");
  });

  it('marks the app furniture [data-no-print] (header, action row, tabs, regenerate, sendability, notes, version history)', () => {
    // Several distinct furniture wrappers must carry the hook; require a healthy count so a
    // future edit that drops them is caught.
    const count = (detail.match(/data-no-print/g) ?? []).length;
    expect(count).toBeGreaterThanOrEqual(8);
  });

  it('does NOT mark the document sheet [data-no-print] — the sheet must print', () => {
    // The sheet container carries data-testid="document-canvas" and no data-no-print.
    expect(canvas).toContain('data-testid="document-canvas"');
    const sheetLine = canvas
      .split('\n')
      .find((l) => l.includes('data-testid="document-canvas"'));
    expect(sheetLine).toBeTruthy();
    expect(sheetLine).not.toContain('data-no-print');
  });
});
