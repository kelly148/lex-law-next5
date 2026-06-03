/**
 * FOLD-L1-3 — Shared-context conversation substrate.
 *
 * Pure-unit + source-audit (no DB): the thread summarizer, the coherent package assembler
 * ("everyone up to speed", NOT a raw dump — materials are metadata only), the Zod wall, and
 * source-audits of the wiring (router registration, owner-scoped read, no textContent leak).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  summarizeThread,
  assembleSharedContextPackage,
} from '../sharedContext/index.js';
import { SharedContextPackageSchema } from '../../shared/schemas/sharedContext.js';
import type { AssembledContext } from '../context/pipeline.js';
import type { VersionRow } from '../../shared/schemas/matters.js';
import type { MatterIdentity, OperativeDocument } from '../../shared/schemas/matterState.js';

const USER = '11111111-1111-1111-1111-111111111111';
const DOC = '33333333-3333-3333-3333-333333333333';
const MATTER = '22222222-2222-2222-2222-222222222222';
const now = new Date('2026-06-03T00:00:00Z');

function version(versionNumber: number, iterationNumber: number): VersionRow {
  return {
    id: `00000000-0000-0000-0000-${String(versionNumber).padStart(12, '0')}`,
    userId: USER,
    documentId: DOC,
    versionNumber,
    content: 'x',
    generatedByJobId: null,
    iterationNumber,
    createdAt: now,
  };
}

// ---------------------------------------------------------------------------
// summarizeThread
// ---------------------------------------------------------------------------

describe('FOLD-L1-3 — summarizeThread', () => {
  it('summarizes versions into iteration/version counts and latest version', () => {
    // newest-first, as listVersionsForDocument returns
    const versions = [version(4, 3), version(3, 2), version(2, 1), version(1, 1)];
    const t = summarizeThread(versions);
    expect(t.versionCount).toBe(4);
    expect(t.iterationCount).toBe(3); // iterations 1,2,3
    expect(t.latestVersionNumber).toBe(4);
    expect(t.recentIterations).toHaveLength(4);
    expect(t.recentIterations[0]?.versionNumber).toBe(4);
  });

  it('bounds recentIterations to 10', () => {
    const versions = Array.from({ length: 25 }, (_, i) => version(25 - i, 25 - i));
    const t = summarizeThread(versions);
    expect(t.versionCount).toBe(25);
    expect(t.recentIterations).toHaveLength(10);
  });

  it('handles an empty thread', () => {
    const t = summarizeThread([]);
    expect(t).toEqual({
      iterationCount: 0,
      versionCount: 0,
      latestVersionNumber: null,
      recentIterations: [],
    });
  });
});

// ---------------------------------------------------------------------------
// assembleSharedContextPackage
// ---------------------------------------------------------------------------

const MATTER_IDENTITY: MatterIdentity = {
  matterId: MATTER,
  title: 'Acme lease',
  clientName: null,
  practiceArea: null,
  phase: 'drafting',
  archivedAt: null,
};
const OPERATIVE_DOC: OperativeDocument = {
  documentId: DOC,
  title: 'Lease agreement',
  workflowState: 'drafting',
  currentVersionId: '44444444-4444-4444-4444-444444444444',
  currentVersionNumber: 2,
};

const ASSEMBLED: AssembledContext = {
  assembledTokens: 120,
  budgetTokens: 1000,
  includedMaterials: [
    {
      materialId: '55555555-5555-5555-5555-555555555555',
      filename: 'lease.pdf',
      textContent: 'SECRET RAW MATERIAL TEXT THAT MUST NOT LEAK INTO THE PACKAGE',
      tokenEstimate: 80,
      contextPriority: 'pinned',
      pinned: true,
    },
  ],
  includedSiblings: [],
  excluded: [],
  truncated: [],
};

describe('FOLD-L1-3 — assembleSharedContextPackage', () => {
  const pkg = assembleSharedContextPackage({
    matter: MATTER_IDENTITY,
    operativeDocument: OPERATIVE_DOC,
    lanes: ['gpt', 'claude'],
    matterStateBlock: '## Matter State\nMatter phase: drafting',
    materials: ASSEMBLED,
    thread: summarizeThread([version(2, 1), version(1, 1)]),
  });

  it('produces a Zod-valid coherent package', () => {
    expect(SharedContextPackageSchema.safeParse(pkg).success).toBe(true);
  });

  it('echoes the toggled-on lanes', () => {
    expect(pkg.lanes).toEqual(['gpt', 'claude']);
  });

  it('carries the curated matter-state block and the operative document', () => {
    expect(pkg.matterStateBlock).toContain('Matter phase: drafting');
    expect(pkg.operativeDocument?.documentId).toBe(DOC);
  });

  it('is NOT a raw dump: materials are metadata only, no textContent leaks', () => {
    expect(pkg.materials.includedMaterials).toHaveLength(1);
    const mat = pkg.materials.includedMaterials[0]!;
    expect(mat.materialId).toBe('55555555-5555-5555-5555-555555555555');
    expect(mat.filename).toBe('lease.pdf');
    expect('textContent' in mat).toBe(false);
    expect(JSON.stringify(pkg)).not.toContain('SECRET RAW MATERIAL TEXT');
  });

  it('reports assembled token footprint = materials + state block', () => {
    const blockTokens = Math.ceil('## Matter State\nMatter phase: drafting'.length / 4);
    expect(pkg.assembledTokens).toBe(120 + blockTokens);
    expect(pkg.materials.assembledTokens).toBe(120);
    expect(pkg.materials.budgetTokens).toBe(1000);
  });
});

// ---------------------------------------------------------------------------
// Source audits of the wiring
// ---------------------------------------------------------------------------

function readSrc(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
}

describe('FOLD-L1-3 — wiring (source audit)', () => {
  const router = readSrc('../router.ts');
  const proc = readSrc('../procedures/sharedContext.ts');
  const svc = readSrc('../sharedContext/index.ts');

  it('router registers the sharedContext router', () => {
    expect(router).toMatch(/sharedContext: sharedContextRouter/);
  });

  it('sharedContext.get is owner-scoped: userId from ctx, not input', () => {
    expect(proc).toMatch(/protectedProcedure/);
    expect(proc).toMatch(/userId: ctx\.userId/);
    expect(proc).not.toMatch(/userId:\s*input\./);
  });

  it('the package assembler maps material metadata only (no textContent field carried)', () => {
    const fn = svc.slice(svc.indexOf('export function assembleSharedContextPackage'));
    const body = fn.slice(0, fn.indexOf('export async function'));
    expect(body).not.toMatch(/textContent/);
  });

  it('reuses L1-1/L1-2 + the context pipeline (no duplicate substrate)', () => {
    expect(svc).toMatch(/from '\.\.\/matterState\/index\.js'/);
    expect(svc).toMatch(/from '\.\.\/matterState\/injection\.js'/);
    expect(svc).toMatch(/from '\.\.\/context\/pipeline\.js'/);
  });
});
