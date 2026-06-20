/**
 * uat_m1_deed_gate_mount_1.test.ts — DEED-GATE-MOUNT-1 (M1)
 *
 * Monster-arc UAT M1 (P1 blocker): the deed three-gate recordability panel / locality selector / RON block
 * never surfaced. Root cause (found by source grep): FOLD-DEED-1 shipped DeedGatePanel + its render test but
 * NEVER mounted it — the only references in all of src were the component file and its test. So even with
 * DEED_GATE_ENABLED=true the panel could not render (no mount point).
 *
 * Fix: mount <DeedGatePanel documentId={documentId} /> in the deed document page, gated on
 * documentType==='deed' (the server's own deed check), so it surfaces for deed docs. The panel self-gates on
 * DEED_GATE_ENABLED (dark on prod until activated) and surfaces the fail-closed states itself.
 *
 * Convention: source-audit for the page WIRING (mr_regenerate_refresh_1 / phase4b.acceptance style). The
 * panel's own render behavior is covered by components/__tests__/deedGatePanel.render.test.tsx.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../../../..');
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, 'src', rel), 'utf-8');
const doc = read('client/pages/DocumentDetail.tsx');

describe('DEED-GATE-MOUNT-1 (M1): DeedGatePanel is mounted in the deed document page', () => {
  it('imports DeedGatePanel (named export) from the component', () => {
    expect(doc).toContain("import { DeedGatePanel } from '../components/DeedGatePanel.js';");
  });

  it('renders DeedGatePanel gated on documentType === "deed", passing documentId', () => {
    // the mount only fires for deed docs (avoids an erroring deedGate.get for non-deeds)
    expect(doc).toContain("doc.documentType === 'deed'");
    expect(doc).toMatch(/doc\.documentType === 'deed' &&[\s\S]{0,200}<DeedGatePanel documentId=\{documentId\} \/>/);
  });

  it('the mount is NOT hidden behind the Context Preview toggle (always visible for deed docs)', () => {
    // it must not sit inside the `{showContextPreview && (` block
    const ctxIdx = doc.indexOf('{showContextPreview && (');
    const ctxClose = doc.indexOf(')}', ctxIdx);
    const deedIdx = doc.indexOf('<DeedGatePanel');
    expect(deedIdx).toBeGreaterThan(-1);
    // the DeedGatePanel mount is AFTER the context-preview block closes (a sibling, not a child)
    expect(deedIdx).toBeGreaterThan(ctxClose);
  });

  it('carries the DEED-GATE-MOUNT-1 (M1) marker', () => {
    expect(doc).toContain('DEED-GATE-MOUNT-1');
  });

  it('relies on the panel to self-gate (no DEED_GATE_ENABLED / isEnabled check added in the page itself)', () => {
    // the page must not re-implement the flag gate — DeedGatePanel owns it (trpc.deedGate.isEnabled).
    const panel = read('client/components/DeedGatePanel.tsx');
    expect(panel).toContain('trpc.deedGate.isEnabled.useQuery()');
    expect(panel).toContain("if (!enabledQ.data?.enabled) return null;");
    expect(doc).not.toContain('trpc.deedGate.isEnabled');
  });
});
