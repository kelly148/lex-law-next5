/**
 * R2 #5 increment 2 — draft-body provenance (source guard).
 *
 * The draft body (DocumentDetail header) surfaces a single ProvenanceBadge when the document drew on
 * an UNVERIFIED KB memo (documents.drewOnUnverifiedKb, KB-1) — one meaningful badge, gated on the
 * flag, not badge-confetti. The ProvenanceBadge component itself is render-tested in
 * provenanceBadge.render.test.tsx; this pins the wiring (CRLF-safe substrings). Review-pane provenance
 * is intentionally NOT a per-reviewer badge (anti-confetti) — it is already served by the R2 #2
 * "review basis" line + the R2 #4 export-safety panel.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../../../..');
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf-8');

describe('R2 #5 inc2: draft-body provenance badge', () => {
  const docDetail = read('src/client/pages/DocumentDetail.tsx');

  it('DocumentDetail imports and uses ProvenanceBadge, gated on doc.drewOnUnverifiedKb', () => {
    expect(docDetail).toContain("import ProvenanceBadge from '../components/ProvenanceBadge.js'");
    expect(docDetail).toContain('doc.drewOnUnverifiedKb &&');
    expect(docDetail).toContain('<ProvenanceBadge verification="unverified" />');
  });
});
