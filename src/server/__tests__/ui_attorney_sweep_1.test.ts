/**
 * UI-ATTORNEY-SWEEP-1 (increment 1: global patterns G1 + G3/S5) — the sweep-wide grep invariants the dispatch
 * requires. Display-only: no safeguard semantics, gates, or attestation language change.
 *   - G1: the "never auto-recorded / auto-recorded or sent" disclaimer is gone from all client UI text
 *     (auto-recording is not a capability; disclaiming a nonexistent one is noise).
 *   - G3/S5: the "You are responsible for monitoring these" first-person lecture is gone.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const CLIENT = path.resolve(__dirname, '../../client');

function allClientText(dir: string): string {
  let out = '';
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out += allClientText(p);
    else if ((e.name.endsWith('.tsx') || e.name.endsWith('.ts')) && !e.name.includes('.test.')) {
      out += fs.readFileSync(p, 'utf-8');
    }
  }
  return out;
}

describe('UI-ATTORNEY-SWEEP-1 (G1 / G3-S5) — attorney-audience text invariants', () => {
  const src = allClientText(CLIENT);

  it('G1: no "auto-recorded or sent" disclaimer anywhere in client UI', () => {
    expect(src).not.toMatch(/auto-?recorded or sent/i);
  });

  it('G1: no "never auto-recorded" disclaimer anywhere in client UI', () => {
    expect(src).not.toMatch(/never auto-?recorded/i);
  });

  it('G3/S5: no "You are responsible" first-person lecture anywhere in client UI', () => {
    expect(src).not.toMatch(/You are responsible/i);
  });
});
