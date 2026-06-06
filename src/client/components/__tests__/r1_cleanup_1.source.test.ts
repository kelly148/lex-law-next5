/**
 * R1-CLEANUP-1 — off-palette/off-spec CONTROL color sweep (source guard).
 *
 * Blue exists nowhere in the Whereas palette, and segmented/active states must be subtle (no heavy
 * navy/black fill). This guard pins the four control fixes and prevents regression. Assertions are
 * single-line class substrings (CRLF-safe, per ci-gotchas #11). Scope is CONTROLS only — status-tint
 * pills (e.g. bg-blue-100 state badges) are deliberately OUT of this engagement.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../../../..');
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf-8');

describe('R1-CLEANUP-1: control colors mapped to tokens', () => {
  const upload = read('src/client/pages/UploadFormatPage.tsx');
  const docDetail = read('src/client/pages/DocumentDetail.tsx');
  const infoReq = read('src/client/pages/InformationRequestPage.tsx');

  it('UploadFormatPage: download/format primary is oxblood (accent), no navy/blue fill on controls', () => {
    expect(upload).toContain('bg-accent text-on-accent');
    // the old navy-fill control pattern (toggle active + format button) is gone
    expect(upload).not.toContain('bg-firm-navy text-white');
    expect(upload).not.toMatch(/bg-blue/);
  });

  it('UploadFormatPage: segmented active state is the subtle surface card (no loud highlight)', () => {
    expect(upload).toContain('bg-surface text-ink border-line shadow-sm');
  });

  it('DocumentDetail: Accept Substantive is the DeliberateActButton ✦ commit affordance, no blue button', () => {
    expect(docDetail).toContain("import DeliberateActButton from '../components/DeliberateActButton.js'");
    expect(docDetail).not.toContain('bg-blue-600'); // the off-palette button fill is gone
    const deliberateUses = (docDetail.match(/<DeliberateActButton/g) ?? []).length;
    expect(deliberateUses).toBeGreaterThanOrEqual(2); // both Accept Substantive sites
  });

  it('InformationRequestPage: the off-palette blue hover is gone (navy hover instead)', () => {
    expect(infoReq).not.toContain('hover:bg-blue-900');
    expect(infoReq).toContain('hover:bg-firm-navy/90');
  });
});
