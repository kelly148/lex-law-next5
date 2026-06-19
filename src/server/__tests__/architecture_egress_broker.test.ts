/**
 * CHAT-COPILOT-2 Increment A — G1 architecture guard (fails the build on a bypass).
 *
 * Deterministic source scans (no DB, no network). What is enforced:
 *   1. NO raw provider-SDK package is imported anywhere in src/ — the adapters are fetch-based, so a
 *      direct SDK package import (@anthropic-ai/sdk, 'openai', @google/generative-ai, ...) is an
 *      unaudited egress path. Passes today; prevents a future SDK import outside the broker.
 *   2. GLOBAL PROVIDER-PRIMITIVE CONTAINMENT — the low-level provider-reaching primitives (the adapter
 *      registry / resolveAdapter, the llmFetch wrapper, and the concrete provider-adapter modules) are
 *      imported ONLY by an allowlisted set of modules. This is the real "no module reaches a provider
 *      outside the chokepoints" invariant and it follows static AND dynamic imports.
 *   3. The CHAT-COPILOT chat→provider surfaces (chatCopilot.ts, chatDispatch.ts) reach a provider ONLY
 *      through the egress broker — they do NOT import the canonical dispatch, the registry, llmFetch, or
 *      a provider adapter (static or dynamic); they import egressClient.
 *
 * LIMITATION (honest): checks 1 + 3 inspect each named file's OWN import specifiers (static + dynamic),
 * not its full transitive import graph; check 2 is the global net that catches a provider-reaching helper
 * a named surface might pull in. A new copilot egress module must be ADDED to COPILOT_SURFACE below.
 */
import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EGRESS_SURFACE_VALUES } from '../../shared/schemas/egress.js';

const SRC_DIR = fileURLToPath(new URL('../../', import.meta.url)); // .../src/

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) out.push(full);
  }
  return out;
}

const rel = (file: string) => file.replace(SRC_DIR, 'src/').replace(/\\/g, '/');
const isTest = (file: string) => rel(file).includes('__tests__');

/** Static `... from '...'`, `require('...')`, AND dynamic `import('...')` specifiers. */
function importedSpecifiers(source: string): string[] {
  const specs: string[] = [];
  const re =
    /(?:import|export)[^'"]*?from\s*['"]([^'"]+)['"]|(?:require|import)\(\s*['"]([^'"]+)['"]\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) specs.push(m[1] ?? m[2] ?? '');
  return specs;
}

const FORBIDDEN_SDK_SPECIFIERS = [
  '@anthropic-ai/sdk', 'openai', '@google/generative-ai', '@google/genai', 'groq-sdk',
  'cohere-ai', '@mistralai/mistralai', '@ai-sdk/anthropic', '@ai-sdk/openai', '@ai-sdk/google',
];

// Provider-reaching primitives -> the ONLY non-test files allowed to import them (verified against the
// tree). A new entrant here is a deliberate, reviewed change, not an accident. This is the SHRINKING
// raw-access allowlist: EGRESS-CONTROL-PLANE-1 ONBOARDED the sendability classifier — it removed
// 'procedures/reviewSession.ts' (which no longer reaches a provider raw; sendability now routes through the
// egress plane) and added the new document egress chokepoint 'egress/documentEgress.ts'. Any NEW raw
// provider importer outside these chokepoints fails this guard (the ME-1 structural lock).
const REGISTRY_RE = /\/llm\/registry(\.js)?$/; // resolveAdapter / setTestLlmAdapter
const LLMFETCH_RE = /\/llm\/llmFetch(\.js)?$/;
const ADAPTER_RE = /\/llm\/(anthropic|openai|google|xai)(\.js)?$/;
const REGISTRY_ALLOWED = ['db/canonicalMutation.ts', 'egress/documentEgress.ts', 'llm/registry.ts'];
const LLMFETCH_ALLOWED = ['llm/anthropic.ts', 'llm/openai.ts', 'llm/google.ts', 'llm/xai.ts', 'llm/llmFetch.ts'];
const ADAPTER_ALLOWED = ['llm/registry.ts'];

const COPILOT_SURFACE = ['server/procedures/chatCopilot.ts', 'server/procedures/chatDispatch.ts', 'server/procedures/chatReviewPanel.ts'];

describe('CHAT-COPILOT-2 A1 — egress broker architecture guard', () => {
  const files = walk(SRC_DIR);

  it('no raw provider-SDK package is imported anywhere in src/', () => {
    const offenders: string[] = [];
    for (const file of files) {
      for (const s of importedSpecifiers(readFileSync(file, 'utf8'))) {
        if (FORBIDDEN_SDK_SPECIFIERS.includes(s)) offenders.push(`${rel(file)} imports '${s}'`);
      }
    }
    expect(offenders, `raw provider-SDK imports (route via egressClient):\n${offenders.join('\n')}`).toEqual([]);
  });

  it('provider-reaching primitives (registry/llmFetch/adapters) are imported ONLY by the allowlisted chokepoints', () => {
    const offenders: string[] = [];
    for (const file of files) {
      if (isTest(file)) continue; // test seams (setTestLlmAdapter, adapter live tests) are allowed
      const r = rel(file);
      for (const s of importedSpecifiers(readFileSync(file, 'utf8'))) {
        if (REGISTRY_RE.test(s) && !REGISTRY_ALLOWED.some((a) => r.endsWith(a))) offenders.push(`${r} imports registry '${s}'`);
        if (LLMFETCH_RE.test(s) && !LLMFETCH_ALLOWED.some((a) => r.endsWith(a))) offenders.push(`${r} imports llmFetch '${s}'`);
        if (ADAPTER_RE.test(s) && !ADAPTER_ALLOWED.some((a) => r.endsWith(a))) offenders.push(`${r} imports adapter '${s}'`);
      }
    }
    expect(offenders, `provider primitive reached outside the chokepoint:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('the copilot chat→provider surfaces reach a provider ONLY through the egress broker', () => {
    for (const surface of COPILOT_SURFACE) {
      const file = files.find((f) => rel(f).endsWith(surface));
      expect(file, `copilot surface not found: ${surface}`).toBeTruthy();
      const specs = importedSpecifiers(readFileSync(file!, 'utf8'));
      const banned = (pred: (s: string) => boolean, what: string) =>
        expect(specs.some(pred), `${surface} must NOT import ${what} — route through egressClient`).toBe(false);
      banned((s) => s.includes('db/canonicalMutation'), 'executeCanonicalMutation');
      banned((s) => REGISTRY_RE.test(s), 'the adapter registry');
      banned((s) => LLMFETCH_RE.test(s), 'llmFetch');
      banned((s) => ADAPTER_RE.test(s), 'a provider adapter');
      expect(specs.some((s) => s.includes('llm/egressClient')), `${surface} must import egressClient`).toBe(true);
    }
  });

  it('the egress broker routes through the single canonical dispatch chokepoint + writes the audit row', () => {
    const file = files.find((f) => rel(f).endsWith('server/llm/egressClient.ts'))!;
    const specs = importedSpecifiers(readFileSync(file, 'utf8'));
    expect(specs.some((s) => s.includes('db/canonicalMutation'))).toBe(true);
    expect(specs.some((s) => s.includes('db/queries/chatEgress'))).toBe(true);
  });
});

// EGRESS-CONTROL-PLANE-1 — the document-side surfaces NOT YET routed through the egress control plane. They
// reach a provider through the JOB plane (executeCanonicalMutation -> runJob -> llmFetch), which the triad
// disposition found is NOT control-equivalent (no audit row, no hold). Each onboards in a later increment by
// routing through egress/documentEgress (the egress plane). This is the explicit SHRINKING checklist — delete
// an entry when its surface onboards (the list shrinks to empty). Sendability (Inc 1) and REVIEWER (Inc 3a)
// are already onboarded and are therefore NOT in this list: the reviewer fan-out's single provider call in
// runJob now routes through documentEgressSend (an `egress` descriptor on its canonical params; surface
// 'reviewer'), so the reviewer transmit gets log AND hold from the plane. drafter/evaluator/outline/intake/
// information_request onboard in later increments.
const EGRESS_ONBOARDING_TODO: readonly string[] = ['drafter', 'evaluator', 'outline', 'intake', 'information_request'];

describe('EGRESS-CONTROL-PLANE-1 — egress control plane architecture guard', () => {
  const files = walk(SRC_DIR);
  const specsOf = (suffix: string): string[] => {
    const file = files.find((f) => rel(f).endsWith(suffix));
    expect(file, `module not found: ${suffix}`).toBeTruthy();
    return importedSpecifiers(readFileSync(file!, 'utf8'));
  };

  it('the shared egress PRIMITIVE is provider-agnostic (imports NO provider primitive, NO canonical dispatch)', () => {
    const specs = specsOf('server/egress/auditedEgress.ts');
    expect(specs.some((s) => REGISTRY_RE.test(s)), 'auditedEgress must not import the registry').toBe(false);
    expect(specs.some((s) => LLMFETCH_RE.test(s)), 'auditedEgress must not import llmFetch').toBe(false);
    expect(specs.some((s) => ADAPTER_RE.test(s)), 'auditedEgress must not import a provider adapter').toBe(false);
    expect(specs.some((s) => s.includes('db/canonicalMutation')), 'auditedEgress wraps an opaque dispatch — no canonical import').toBe(false);
  });

  it('the DOCUMENT egress adapter is a chokepoint: reaches the provider via the registry AND records via egress_events, over the primitive', () => {
    const specs = specsOf('server/egress/documentEgress.ts');
    expect(specs.some((s) => REGISTRY_RE.test(s)), 'documentEgress reaches the provider via the registry (the approved chokepoint)').toBe(true);
    expect(specs.some((s) => /(^|\/)auditedEgress(\.js)?$/.test(s)), 'documentEgress dispatches through the shared primitive').toBe(true);
    expect(specs.some((s) => s.includes('db/queries/egressEvents')), 'documentEgress writes the egress_events audit row').toBe(true);
    expect(specs.some((s) => s.includes('db/queries/egressHold')), 'documentEgress checks the scoped hold').toBe(true);
  });

  it('SENDABILITY is onboarded: reviewSession reaches a provider ONLY through the egress plane (the raw-access allowlist shrank)', () => {
    const specs = specsOf('server/procedures/reviewSession.ts');
    // The shrink: reviewSession no longer imports a provider primitive (it was on REGISTRY_ALLOWED only for
    // the raw sendability adapter.generate). It still imports canonicalMutation for the reviewer JOB-plane
    // dispatch (not yet onboarded — that is increment 2); the guard only bans RAW provider access.
    expect(specs.some((s) => REGISTRY_RE.test(s)), 'reviewSession must NOT import the registry — sendability now routes through documentEgress').toBe(false);
    expect(specs.some((s) => LLMFETCH_RE.test(s)), 'reviewSession must NOT import llmFetch').toBe(false);
    expect(specs.some((s) => ADAPTER_RE.test(s)), 'reviewSession must NOT import a provider adapter').toBe(false);
    expect(specs.some((s) => s.includes('egress/documentEgress')), 'reviewSession routes sendability through the document egress plane').toBe(true);
  });

  it('the onboarding inventory is the shrinking checklist (each not-yet-onboarded surface is a known ledger surface)', () => {
    // Every surface still on the job plane is a valid egress_events surface, so it can be recorded the moment
    // it onboards. As a surface routes through documentEgress, remove it here — the list shrinks to empty.
    for (const surface of EGRESS_ONBOARDING_TODO) {
      expect(
        (EGRESS_SURFACE_VALUES as readonly string[]).includes(surface),
        `onboarding-target surface '${surface}' must be a declared egress_events surface`,
      ).toBe(true);
    }
    // Sendability is NOT in the inventory (already onboarded in increment 1).
    expect(EGRESS_ONBOARDING_TODO.includes('sendability')).toBe(false);
    // EGRESS-CONTROL-PLANE-1 Inc 3a: REVIEWER is onboarded — runJob routes the reviewer fan-out's single
    // provider call through documentEgressSend (the `egress` descriptor on its canonical params), so it is
    // off the job plane and no longer in the onboarding inventory.
    expect(EGRESS_ONBOARDING_TODO.includes('reviewer')).toBe(false);
  });

  it('REVIEWER onboarding is STRUCTURALLY enforced: reviewerJobFactory carries an egress descriptor (surface reviewer) + canonicalMutation routes it through documentEgressSend', () => {
    // Reviewer onboarding is a RUNTIME routing (an `egress` descriptor on the canonical params), not an
    // import-surface change — so guard it with a source-level structural assertion in addition to the
    // behavioral test, so a refactor that silently drops the reviewer off the plane FAILS the build.
    // Single-line substrings (LF-insensitive; gotcha #11 is about \n-bearing scans).
    const factory = files.find((f) => rel(f).endsWith('server/jobs/reviewerJobFactory.ts'));
    expect(factory, 'reviewerJobFactory.ts not found').toBeTruthy();
    const factorySrc = readFileSync(factory!, 'utf8');
    expect(
      factorySrc.includes("surface: 'reviewer'"),
      'reviewerJobFactory must attach an egress descriptor with surface reviewer (reviewer must stay on the plane)',
    ).toBe(true);
    const canonical = files.find((f) => rel(f).endsWith('db/canonicalMutation.ts'));
    expect(canonical, 'canonicalMutation.ts not found').toBeTruthy();
    expect(
      readFileSync(canonical!, 'utf8').includes('documentEgressSend('),
      'canonicalMutation must route an egress-bearing job through documentEgressSend',
    ).toBe(true);
  });
});
