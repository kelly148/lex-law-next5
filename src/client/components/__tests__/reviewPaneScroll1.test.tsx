/**
 * REVIEW-PANE-SCROLL-1 — single-scroll-container regression guard (source audit).
 *
 * Defect (prod): the right review pane could not scroll to the bottom once the secondary panels
 * below the feedback area were expanded — the scroll container wrapped ONLY the feedback cards, so
 * the panels (and footer) were siblings clipped by the overflow-hidden parent and unreachable.
 *
 * Fix: ONE scroll body wraps the feedback area AND every secondary panel; the footer action strip
 * sits OUTSIDE it. This pins that structure in source so a future edit cannot silently move a panel
 * back outside the scroll body (the exact regression). The live behavior (reachability at 100%/125%
 * zoom via wheel/trackpad/keyboard) is operator-verified — jsdom does no layout/scroll.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const src = readFileSync(resolve('src/client/components/ReviewPane.tsx'), 'utf8');

describe('REVIEW-PANE-SCROLL-1 — single scroll container', () => {
  it('declares one scroll body (flex-1 min-h-0 overflow-y-auto) for the review pane', () => {
    expect(src).toContain('data-testid="review-scroll-body"');
    expect(src).toContain('flex-1 min-h-0 overflow-y-auto');
  });

  it('places the secondary panels INSIDE the scroll body and the footer AFTER it (the fix)', () => {
    const scrollOpen = src.indexOf('data-testid="review-scroll-body"');
    const exportPanel = src.indexOf('<ExportSafetyPanel', scrollOpen);
    const history = src.indexOf('<HistorySection', scrollOpen);
    const spacer = src.indexOf('aria-hidden="true" className="h-20"', scrollOpen);
    const footer = src.indexOf('{/* Footer actions */}', scrollOpen);

    expect(scrollOpen).toBeGreaterThan(-1);
    // panels + history live after the scroll body opens (i.e. inside it)…
    expect(exportPanel).toBeGreaterThan(scrollOpen);
    expect(history).toBeGreaterThan(exportPanel);
    // …followed by the bottom spacer that clears the footer, then the scroll body closes…
    expect(spacer).toBeGreaterThan(history);
    // …and the footer action strip comes AFTER (outside the scroll body).
    expect(footer).toBeGreaterThan(spacer);
  });

  it('pins the footer as a non-shrinking strip outside the scroll body', () => {
    expect(src).toContain('border-t border-gray-200 flex flex-col gap-2 flex-shrink-0');
  });
});
