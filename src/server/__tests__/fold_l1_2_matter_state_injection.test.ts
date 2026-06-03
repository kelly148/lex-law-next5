/**
 * FOLD-L1-2 — Matter-memory injection (every model call receives current matter state).
 *
 * Covers: the pure formatter (formatMatterStateBlock), the single-chokepoint behavioral
 * wiring in executeCanonicalMutation (inject on success, best-effort no-op on failure,
 * skip when no matterId), and source-audits of the wiring. No-DB style; CI is authoritative.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { formatMatterStateBlock } from '../matterState/injection.js';
import {
  executeCanonicalMutation,
  setJobWriteFunctions,
  setMatterStateProvider,
} from '../db/canonicalMutation.js';
import { setTestLlmAdapter } from '../llm/registry.js';
import type { LlmClient, LlmGenerateParams, LlmGenerateResult } from '../llm/types.js';
import type { MatterStateModelContext } from '../../shared/schemas/matterState.js';

const USER = '11111111-1111-1111-1111-111111111111';
const MATTER = '22222222-2222-2222-2222-222222222222';
const DOC = '33333333-3333-3333-3333-333333333333';

// ---------------------------------------------------------------------------
// Pure formatter
// ---------------------------------------------------------------------------

function modelContext(overrides: Partial<MatterStateModelContext> = {}): MatterStateModelContext {
  return {
    mode: 'model_context',
    matter: {
      matterId: MATTER,
      title: 'Acme lease',
      clientName: null,
      practiceArea: null,
      phase: 'drafting',
      archivedAt: null,
    },
    operativeDocument: {
      documentId: DOC,
      title: 'Lease agreement',
      workflowState: 'drafting',
      currentVersionId: '44444444-4444-4444-4444-444444444444',
      currentVersionNumber: 2,
    },
    safeToSend: { posture: 'blocked', openBlockerCount: 1, derivedFrom: 'open_items' },
    activeLockedDecisions: [
      { id: '55555555-5555-5555-5555-555555555555', summary: 'LOCKED_DECISION_MARKER', rationale: null, origin: 'declined' },
    ],
    carriedAdoptions: [
      {
        id: '66666666-6666-6666-6666-666666666666',
        adoptedText: 'ADOPTION_MARKER',
        disposition: 'adopted_verbatim',
        status: 'active',
      },
    ],
    openBlockers: [
      { id: '77777777-7777-7777-7777-777777777777', category: 'governing_law', severity: 'blocker', summary: 'Jurisdiction mismatch', scope: 'matter' },
    ],
    openSubstantive: [
      { id: '88888888-8888-8888-8888-888888888888', category: 'over_disclosure', severity: 'substantive', summary: 'Counterparty over-disclosure', scope: 'document' },
    ],
    matterLevelItems: [
      { id: '77777777-7777-7777-7777-777777777777', category: 'governing_law', severity: 'blocker', summary: 'Jurisdiction mismatch', scope: 'matter' },
    ],
    operativeSources: [
      {
        id: '99999999-9999-9999-9999-999999999999',
        subjectType: 'material',
        subjectId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        authorityOrigin: 'operative',
        lifecycle: 'operative',
        label: 'Signed lease',
      },
    ],
    ...overrides,
  };
}

describe('FOLD-L1-2 — formatMatterStateBlock', () => {
  it('includes matter phase, operative document, and blocked send status', () => {
    const block = formatMatterStateBlock(modelContext());
    expect(block).toContain('## Matter State');
    expect(block).toContain('Matter phase: drafting');
    expect(block).toContain('Lease agreement');
    expect(block).toContain('Send status: BLOCKED');
    expect(block).toContain('Jurisdiction mismatch'); // open blocker
    expect(block).toContain('Counterparty over-disclosure'); // open substantive
    expect(block).toContain('Source authority'); // operative sources section
    expect(block).toContain('operative/operative — Signed lease');
  });

  it('EXCLUDES locked decisions and adoptions (already injected per-document by the reviewer path)', () => {
    const block = formatMatterStateBlock(modelContext());
    expect(block).not.toContain('LOCKED_DECISION_MARKER');
    expect(block).not.toContain('ADOPTION_MARKER');
  });

  it('renders a clear send status when there are no open blockers', () => {
    const block = formatMatterStateBlock(
      modelContext({
        safeToSend: { posture: 'clear', openBlockerCount: 0, derivedFrom: 'open_items' },
        openBlockers: [],
        matterLevelItems: [],
      }),
    );
    expect(block).toContain('Send status: clear');
    expect(block).not.toContain('Send status: BLOCKED');
  });

  it('omits the send-status line when posture is unknown', () => {
    const block = formatMatterStateBlock(
      modelContext({
        safeToSend: { posture: 'unknown', openBlockerCount: 0, derivedFrom: 'open_items' },
        openBlockers: [],
        openSubstantive: [],
        matterLevelItems: [],
        operativeSources: [],
      }),
    );
    expect(block).not.toContain('Send status:');
    // still anchors on matter identity (no cold reviews)
    expect(block).toContain('Matter phase: drafting');
  });
});

// ---------------------------------------------------------------------------
// Chokepoint behavioral wiring (executeCanonicalMutation)
// ---------------------------------------------------------------------------

class CapturingAdapter implements LlmClient {
  public lastSystemPrompt: string | null = null;
  public lastUserPrompt: string | null = null;
  generate(params: LlmGenerateParams): Promise<LlmGenerateResult> {
    this.lastSystemPrompt = params.systemPrompt;
    this.lastUserPrompt = params.userPrompt;
    return Promise.resolve({
      content: '[]',
      tokensPrompt: 1,
      tokensCompletion: 1,
      providerMetadata: { provider: 'capture' },
    });
  }
}

function installNoopJobWrites() {
  setJobWriteFunctions({
    insertJob: vi.fn().mockResolvedValue(undefined),
    markJobRunning: vi.fn().mockResolvedValue(1),
    markJobCompleted: vi.fn().mockResolvedValue(undefined),
    markJobFailed: vi.fn().mockResolvedValue(undefined),
    markJobTimedOut: vi.fn().mockResolvedValue(undefined),
    markJobCancelled: vi.fn().mockResolvedValue(1),
    updateJobHeartbeat: vi.fn().mockResolvedValue(undefined),
  });
}

const baseMutationParams = (matterId?: string) => ({
  userId: USER,
  jobType: 'reviewer_feedback' as const,
  modelString: 'anthropic:claude-opus-4-5',
  ...(matterId !== undefined ? { matterId } : {}),
  documentId: DOC,
  txn1Enqueue: async (jobId: string) => ({ jobId }),
  buildLlmParams: () => ({ systemPrompt: 'ROLE_SYSTEM_PROMPT', userPrompt: 'USER_PROMPT' }),
  txn2Commit: async () => {},
  txn2Revert: async () => {},
  telemetryCtx: { userId: USER, matterId: matterId ?? null, documentId: DOC, jobId: null },
});

describe('FOLD-L1-2 — executeCanonicalMutation injects matter state at the chokepoint', () => {
  afterEach(() => {
    setMatterStateProvider(null);
    setTestLlmAdapter(null);
    setJobWriteFunctions(null);
    vi.clearAllMocks();
  });

  it('prepends the matter-state block to the systemPrompt when matterId is present', async () => {
    const adapter = new CapturingAdapter();
    setTestLlmAdapter(adapter);
    installNoopJobWrites();
    setMatterStateProvider(async () => 'MATTER_STATE_BLOCK');

    const result = await executeCanonicalMutation(baseMutationParams(MATTER));

    expect(result.status).toBe('completed');
    expect(adapter.lastSystemPrompt).toBe('MATTER_STATE_BLOCK\n\nROLE_SYSTEM_PROMPT');
  });

  it('is best-effort: a failing matter-state read degrades to no injection (byte-identical prompt), call still dispatches', async () => {
    const adapter = new CapturingAdapter();
    setTestLlmAdapter(adapter);
    installNoopJobWrites();
    setMatterStateProvider(async () => {
      throw new Error('simulated matter-state read failure');
    });

    const result = await executeCanonicalMutation(baseMutationParams(MATTER));

    expect(result.status).toBe('completed');
    expect(adapter.lastSystemPrompt).toBe('ROLE_SYSTEM_PROMPT');
  });

  it('does not inject when there is no matterId', async () => {
    const adapter = new CapturingAdapter();
    setTestLlmAdapter(adapter);
    installNoopJobWrites();
    const provider = vi.fn().mockResolvedValue('SHOULD_NOT_BE_USED');
    setMatterStateProvider(provider);

    const result = await executeCanonicalMutation(baseMutationParams(undefined));

    expect(result.status).toBe('completed');
    expect(provider).not.toHaveBeenCalled();
    expect(adapter.lastSystemPrompt).toBe('ROLE_SYSTEM_PROMPT');
  });

  it('an empty block leaves the systemPrompt unchanged', async () => {
    const adapter = new CapturingAdapter();
    setTestLlmAdapter(adapter);
    installNoopJobWrites();
    setMatterStateProvider(async () => '');

    await executeCanonicalMutation(baseMutationParams(MATTER));

    expect(adapter.lastSystemPrompt).toBe('ROLE_SYSTEM_PROMPT');
  });
});

// ---------------------------------------------------------------------------
// Source audits of the wiring
// ---------------------------------------------------------------------------

function readSrc(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
}

describe('FOLD-L1-2 — chokepoint wiring (source audit)', () => {
  const cm = readSrc('../db/canonicalMutation.ts');
  const inj = readSrc('../matterState/injection.ts');

  it('canonicalMutation imports the injection builder and exposes a test seam', () => {
    expect(cm).toMatch(/import \{ buildMatterStateContextBlock \} from '\.\.\/matterState\/injection\.js'/);
    expect(cm).toMatch(/export function setMatterStateProvider/);
  });

  it('canonicalMutation injects only when matterId is present and best-effort (try/catch)', () => {
    expect(cm).toMatch(/if \(matterId\) \{/);
    expect(cm).toMatch(/getMatterStateProvider\(\)\(/);
    // the injection await is wrapped in try/catch (best-effort)
    const region = cm.slice(cm.indexOf('if (matterId) {'));
    expect(region.slice(0, region.indexOf('resolveAdapter'))).toMatch(/try \{[\s\S]*catch/);
  });

  it('injection formatter reads model_context and excludes locked/adopt rendering', () => {
    expect(inj).toMatch(/mode: 'model_context'/);
    // the formatter does not render the activeLockedDecisions / carriedAdoptions arrays
    const fn = inj.slice(inj.indexOf('export function formatMatterStateBlock'));
    expect(fn).not.toMatch(/activeLockedDecisions/);
    expect(fn).not.toMatch(/carriedAdoptions/);
  });
});
