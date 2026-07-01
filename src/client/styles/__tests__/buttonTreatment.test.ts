import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * BUTTON-CONTRAST-1 — guard the shared secondary/ghost button treatment.
 *
 * The app has no Button component; the oxblood-outline treatment for faint
 * secondary/ghost buttons lives entirely in the `.btn-secondary` / `.btn-ghost`
 * component classes in globals.css. If those are deleted or weakened, every
 * migrated call site silently loses its legibility fix with nothing else to
 * catch it (jsdom cannot compute Tailwind styles). This locks in the source
 * of truth: the classes exist, sit in @layer components, and carry the oxblood
 * (firm-gold / accent) ink + a visible focus ring.
 */
const css = readFileSync(fileURLToPath(new URL('../globals.css', import.meta.url)), 'utf8');

function classBlock(name: string): string {
  const start = css.indexOf(`.${name} {`);
  expect(start, `.${name} must be defined in globals.css`).toBeGreaterThan(-1);
  const end = css.indexOf('}', start);
  return css.slice(start, end);
}

describe('BUTTON-CONTRAST-1 secondary/ghost button treatment', () => {
  it('defines the shared classes inside @layer components', () => {
    const layerStart = css.indexOf('@layer components');
    expect(layerStart, '@layer components block must exist').toBeGreaterThan(-1);
    expect(css.indexOf('.btn-secondary {')).toBeGreaterThan(layerStart);
    expect(css.indexOf('.btn-ghost {')).toBeGreaterThan(layerStart);
  });

  it('.btn-secondary carries oxblood ink, an outline, a clear hover and a focus ring', () => {
    const block = classBlock('btn-secondary');
    expect(block).toContain('text-firm-gold'); // oxblood text (legible on paper + dark)
    expect(block).toContain('border'); // outlined, not filled
    expect(block).toMatch(/hover:/); // a clear hover state
    expect(block).toContain('focus-visible:ring'); // keyboard-visible focus
  });

  it('.btn-ghost carries oxblood ink and a focus ring but no base border', () => {
    const block = classBlock('btn-ghost');
    expect(block).toContain('text-firm-gold');
    expect(block).toContain('focus-visible:ring');
    // borderless: the base (non-hover) declarations must not add a border.
    const base = block.split('hover:')[0];
    expect(base).not.toMatch(/\bborder\b/);
  });
});
