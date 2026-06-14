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
// tree). A new entrant here is a deliberate, reviewed change, not an accident.
const REGISTRY_RE = /\/llm\/registry(\.js)?$/; // resolveAdapter / setTestLlmAdapter
const LLMFETCH_RE = /\/llm\/llmFetch(\.js)?$/;
const ADAPTER_RE = /\/llm\/(anthropic|openai|google|xai)(\.js)?$/;
const REGISTRY_ALLOWED = ['db/canonicalMutation.ts', 'procedures/reviewSession.ts', 'llm/registry.ts'];
const LLMFETCH_ALLOWED = ['llm/anthropic.ts', 'llm/openai.ts', 'llm/google.ts', 'llm/xai.ts', 'llm/llmFetch.ts'];
const ADAPTER_ALLOWED = ['llm/registry.ts'];

const COPILOT_SURFACE = ['server/procedures/chatCopilot.ts', 'server/procedures/chatDispatch.ts'];

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
