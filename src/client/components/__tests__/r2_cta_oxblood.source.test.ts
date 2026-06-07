/**
 * R2 primary-CTA oxblood — full button-grammar sweep (source guard).
 *
 * The Whereas button grammar (R2_PRIMARY_CTA_OXBLOOD_DECISION_2026-06-06): exactly ONE oxblood
 * primary per view (`bg-accent text-on-accent`), every other affirmative control = ghost
 * (`border border-line text-ink hover:bg-surface`), segmented active = the quiet surface card,
 * semantic button fills = wa tokens, and the ✦ DeliberateActButton renders ghost (tone="ghost")
 * unless it is the view's single dominant CTA — friction (the ✦ mark) is kept in both tones.
 *
 * Render tests are infeasible for the tRPC/router-bound screens (they need the full provider
 * tree), so — exactly as r1_cleanup_1.source.test.ts did for DocumentDetail/InformationRequestPage —
 * this pins the class invariants at the source level. Assertions are single-line class substrings
 * (CRLF-safe, per ci-gotchas #11) so they survive line-ending normalization.
 *
 * Scope reminder: read-only STATUS pills (bg-blue-100 phase/severity tints, *-100 badges) are
 * deliberately OUT of this sweep, so this guard checks for the blue/ink BUTTON FILLS only
 * (`bg-blue-600`, `bg-firm-navy text-white`), never the status-tint pills.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../../../..');
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf-8');
const count = (src: string, re: RegExp): number => (src.match(re) ?? []).length;

const PAGES = 'src/client/pages';
const COMP = 'src/client/components';

const OXBLOOD = 'bg-accent text-on-accent';   // the oxblood-primary fill signature
const INK_FILL = 'bg-firm-navy text-white';   // the loud ink fill R2 re-roles off controls
const GHOST = 'border border-line text-ink';  // the ghost (secondary) signature
const SEGMENTED_ACTIVE = 'bg-surface text-ink border-line shadow-sm';

describe('R2 primary-CTA oxblood — button grammar sweep', () => {
  // 1. Each named screen carries its single oxblood primary and no loud ink/blue button fill.
  const onePrimary: Record<string, string> = {
    'MatterDashboard': `${PAGES}/MatterDashboard.tsx`,     // New Matter + Create Matter (modal)
    'TemplatesPage': `${PAGES}/TemplatesPage.tsx`,         // Upload Template (header + modal)
    'SettingsPage': `${PAGES}/SettingsPage.tsx`,           // Save Voice Settings
    'LoginPage': `${PAGES}/LoginPage.tsx`,                 // Sign in
    'DocumentDetail': `${PAGES}/DocumentDetail.tsx`,       // Generate / Extract / Render / Accept (iterative)
    'InformationRequestPage': `${PAGES}/InformationRequestPage.tsx`, // Generate / Add to Client Materials
    'UploadFormatPage': `${PAGES}/UploadFormatPage.tsx`,   // Format Document (already oxblood, #184)
  };
  for (const [name, rel] of Object.entries(onePrimary)) {
    it(`${name}: oxblood primary present, no loud ink/blue button fill`, () => {
      const src = read(rel);
      expect(src).toContain(OXBLOOD);
      expect(src).not.toContain(INK_FILL);
      expect(src).not.toContain('bg-blue-600'); // no off-palette blue BUTTON fill (status pills excluded)
    });
  }

  // 2. MatterDetail composite + matter panels + Review surfaces promote NONE — zero oxblood fill.
  //    (`bg-accent-tint` pills are unaffected: this checks the solid-fill signature only.)
  //    RELAYOUT-3 / REVIEW-SKIN-1 (operator-signed) carved ReviewPane.tsx OUT of this list: the
  //    reviewer-selection state now carries ONE oxblood primary ("Start review (N)"), and the
  //    active state's one oxblood is Regenerate — one-oxblood-PER-VIEW-STATE, not zero. ReviewPane
  //    still appears in the GHOST-containing assertion below (it keeps its ghost controls).
  const ghostEverywhere = [
    `${PAGES}/MatterDetail.tsx`,
    `${COMP}/MatterIntakePanel.tsx`, `${COMP}/MatterStateDashboard.tsx`,
    `${COMP}/ClosurePackagePanel.tsx`, `${COMP}/KnowledgeBasePanel.tsx`,
    `${COMP}/ProvisionProvenancePanel.tsx`, `${COMP}/LddDiffPanel.tsx`,
    `${COMP}/OrchestrationConsolidationPanel.tsx`, `${COMP}/ExportSafetyPanel.tsx`,
    `${COMP}/MatterRecordLedger.tsx`, `${COMP}/ContextPreviewPanel.tsx`,
    `${COMP}/MaterialsDrawer.tsx`, `${COMP}/MatterReadinessStrip.tsx`,
  ];
  for (const rel of ghostEverywhere) {
    it(`${rel.split('/').pop()}: promotes nothing to oxblood (no bg-accent fill)`, () => {
      expect(read(rel)).not.toContain(OXBLOOD);
    });
  }

  // 3. Non-primary ✦ deliberate acts render ghost (friction kept, oxblood fill dropped).
  it('KnowledgeBasePanel + OrchestrationConsolidationPanel: every ✦ act is tone="ghost"', () => {
    for (const rel of [`${COMP}/KnowledgeBasePanel.tsx`, `${COMP}/OrchestrationConsolidationPanel.tsx`]) {
      const src = read(rel);
      const uses = count(src, /<DeliberateActButton/g);
      const ghosts = count(src, /tone="ghost"/g);
      expect(uses).toBeGreaterThan(0);
      expect(ghosts).toBe(uses);
    }
  });

  // 4. DocumentDetail: per-state one-oxblood — iterative Accept Substantive stays oxblood (default
  //    tone), template-path Accept Substantive is ghost (Render Document is that state's primary).
  it('DocumentDetail: two ✦ acts, exactly one ghosted (the template-path commit)', () => {
    const src = read(`${PAGES}/DocumentDetail.tsx`);
    expect(count(src, /<DeliberateActButton/g)).toBe(2);
    expect(count(src, /tone="ghost"/g)).toBe(1);
  });

  // 5. The shared component exposes both tones and keeps the ✦ friction marker in BOTH.
  it('DeliberateActButton: tone prop + ✦ friction marker preserved across tones', () => {
    const src = read(`${COMP}/DeliberateActButton.tsx`);
    expect(src).toContain("tone?: 'primary' | 'ghost'");
    expect(src).toContain("tone === 'ghost'");
    expect(src).toContain('data-deliberate-act="true"');
    expect(src).toContain('✦');
  });

  // 6. Segmented / mode-toggle active state = the quiet surface card, never a loud fill.
  it('segmented active states use the quiet surface card', () => {
    expect(read(`${PAGES}/DocumentDetail.tsx`)).toContain(SEGMENTED_ACTIVE);
    expect(read(`${COMP}/MatterReadinessStrip.tsx`)).toContain(SEGMENTED_ACTIVE);
    expect(read(`${PAGES}/UploadFormatPage.tsx`)).toContain(SEGMENTED_ACTIVE);
  });

  // 7. The ghost grammar is actually in use (secondary controls demoted to the line/ink outline).
  it('ghost secondary signature is present where buttons were demoted', () => {
    for (const rel of [`${PAGES}/InformationRequestPage.tsx`, `${COMP}/MatterIntakePanel.tsx`, `${COMP}/ReviewPane.tsx`]) {
      expect(read(rel)).toContain(GHOST);
    }
  });
});
