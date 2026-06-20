/**
 * uat_f5_prompt_snapshot_read_1.test.ts — PROMPT-SNAPSHOT-READ-1 (F5)
 *
 * Monster UAT U7 (P3, transparency): prompt_snapshots captures the FULL composed system text actually sent
 * (matter-state + master + per-PA + base), but the UI's Context Preview showed included *materials* only.
 * F5 adds an owner-scoped, read-only view of the composed system prompt.
 *
 * This guards the security-critical property — OWNER SCOPING (no cross-user prompt exposure) — plus the
 * additive, read-only shape, via source analysis (the repo convention for this fix class).
 *
 * Surface:
 *   - getLatestPromptSnapshotForDocument(documentId, userId)  (Zod-walled read, owner-scoped)
 *   - contextPipeline.systemPrompt  (protectedProcedure, matter-owner check + ctx.userId)
 *   - ContextPreviewPanel "Composed System Prompt" collapsible section (read-only)
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../../..');
function readSrc(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, 'src', relPath), 'utf-8');
}
const query = readSrc('server/db/queries/promptSnapshots.ts');
const procedure = readSrc('server/procedures/contextPipeline.ts');
const panel = readSrc('client/components/ContextPreviewPanel.tsx');

// ============================================================
// T-F5-1 — the read is OWNER-SCOPED (no cross-user exposure)
// ============================================================
describe('T-F5-1: getLatestPromptSnapshotForDocument is owner-scoped', () => {
  it('exports the read function', () => {
    expect(query).toContain('export async function getLatestPromptSnapshotForDocument(');
  });

  it('filters by BOTH userId AND documentId (the owner-scope guard)', () => {
    const fn = query.slice(query.indexOf('export async function getLatestPromptSnapshotForDocument('));
    expect(fn).toContain('eq(promptSnapshots.userId, userId)');
    expect(fn).toContain('eq(promptSnapshots.documentId, documentId)');
    // both conditions combined under and(...)
    expect(fn).toMatch(/and\(\s*eq\(promptSnapshots\.userId, userId\),\s*eq\(promptSnapshots\.documentId, documentId\)\s*\)/);
  });

  it('selects the LATEST snapshot (orderBy createdAt desc, limit 1)', () => {
    const fn = query.slice(query.indexOf('export async function getLatestPromptSnapshotForDocument('));
    expect(fn).toContain('orderBy(desc(promptSnapshots.createdAt))');
    expect(fn).toContain('.limit(1)');
  });

  it('returns null when there is no row (graceful no-snapshot)', () => {
    const fn = query.slice(query.indexOf('export async function getLatestPromptSnapshotForDocument('));
    expect(fn).toContain('if (rows.length === 0) return null');
  });
});

// ============================================================
// T-F5-2 — the read passes a Zod wall and does not leak internals
// ============================================================
describe('T-F5-2: read is Zod-walled and minimal', () => {
  it('defines PromptSnapshotReadSchema and parses through it', () => {
    expect(query).toContain('export const PromptSnapshotReadSchema');
    expect(query).toContain('PromptSnapshotReadSchema.parse(rows[0])');
  });

  it('projects systemText (the audit core) for display', () => {
    const fn = query.slice(query.indexOf('export async function getLatestPromptSnapshotForDocument('));
    expect(fn).toContain('systemText: promptSnapshots.systemText');
  });

  it('does NOT project the integrity hashes (systemSha256 / assetSha256) into the read shape', () => {
    const schema = query.slice(query.indexOf('PromptSnapshotReadSchema = z.object'), query.indexOf('export type PromptSnapshotRead'));
    expect(schema).not.toContain('systemSha256');
    expect(schema).not.toContain('assetSha256');
  });
});

// ============================================================
// T-F5-3 — the procedure is owner-checked and additive
// ============================================================
describe('T-F5-3: contextPipeline.systemPrompt is owner-checked + additive', () => {
  it('adds a protected systemPrompt procedure', () => {
    expect(procedure).toContain('systemPrompt: protectedProcedure');
  });

  it('asserts matter ownership via getMatterById(input.matterId, ctx.userId)', () => {
    const block = procedure.slice(procedure.indexOf('systemPrompt: protectedProcedure'));
    expect(block).toContain('getMatterById(input.matterId, ctx.userId)');
    expect(block).toContain("throw new TRPCError({ code: 'NOT_FOUND'");
  });

  it('reads the snapshot scoped to ctx.userId (not a client-supplied user)', () => {
    const block = procedure.slice(procedure.indexOf('systemPrompt: protectedProcedure'));
    expect(block).toContain('getLatestPromptSnapshotForDocument(input.documentId, ctx.userId)');
  });

  it('returns null when no documentId is provided', () => {
    const block = procedure.slice(procedure.indexOf('systemPrompt: protectedProcedure'));
    expect(block).toContain('if (input.documentId === undefined) return null');
  });

  it('does NOT modify the existing preview procedure (additive only)', () => {
    expect(procedure).toContain('preview: protectedProcedure');
    expect(procedure).toContain('assembleContext(assembleParams)');
  });
});

// ============================================================
// T-F5-4 — the UI renders a read-only system-prompt section
// ============================================================
describe('T-F5-4: Context Preview surfaces the composed system prompt (read-only)', () => {
  it('queries contextPipeline.systemPrompt', () => {
    expect(panel).toContain('trpc.contextPipeline.systemPrompt.useQuery');
  });

  it('renders the system text in a read-only <pre>, gated on a present snapshot', () => {
    expect(panel).toContain('promptData?.systemText');
    expect(panel).toContain('<pre');
    expect(panel).toContain('{promptData.systemText}');
  });

  it('has no edit/save affordance for the prompt (display-only)', () => {
    // Slice the RENDERED section only (from its JSX guard to end of file) — not from the query comment
    // near the top, which would sweep in the unrelated operation <select> onChange.
    const section = panel.slice(panel.indexOf('promptData?.systemText && ('));
    expect(section).not.toContain('onChange');
    expect(section).not.toContain('<textarea');
    expect(section).not.toContain('.mutate(');
  });

  it('carries the PROMPT-SNAPSHOT-READ-1 (F5) marker', () => {
    expect(panel).toContain('PROMPT-SNAPSHOT-READ-1');
  });
});
