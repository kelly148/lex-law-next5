/*
 * GEMINI-BUDGET-CALIBRATION-1 — Increment 1 measurement runner
 *
 * Plain Node ESM (Node 24 global fetch; no TS toolchain / node_modules required). Feeds two
 * inputs — the committed synthetic large-provision fixture and (if present locally) the
 * operator's anonymized real-shaped lease — to the reviewer tracks at one or more output
 * budgets, and records PER-PROVIDER token accounting: requested maxTokens, reasoning/thinking
 * tokens (where the provider reports them), emitted output tokens, total, finish_reason, a
 * truncation flag, distance-to-truncation, and the reasoning-vs-output truncation axis.
 *
 * It answers the increment-1 question: at the current 16384 ceiling, WHERE does each model
 * truncate, and on WHICH axis (reasoning-bound vs output-bound)? The split logic here MIRRORS
 * src/server/llm/tokenAccounting.ts (the runner cannot import TS); keep the two in sync.
 *
 * CREDENTIALS: provider keys read from process.env at call time only; never printed, logged, or
 * written to artifacts. Run from PowerShell so User-scope keys reach the child Node process.
 *
 * INPUTS:
 *   - tools/calibration/fixtures/synthetic_large_provision.txt   (committed, prod-content-free)
 *   - tools/calibration/inputs/lease_anonymized_v4.txt           (LOCAL, gitignored; optional)
 *
 * MODES:
 *   --smoke   (default) synthetic × 4 full tracks @ 16384                       (4 calls)
 *   --measure           synthetic × 4 full @ 16384 + lease × 4 full @ 16384,32768 (≤12 calls)
 *   --full              adds the 4 lite tracks on both inputs @ 16384
 *   --budgets=a,b,c     override the budget sweep for the lease (measure/full)
 *
 * ARTIFACTS: tools/calibration/runs/<runId>/  (gitignored): per-call rawOutput + a
 *   grid.summary.json with the per-model demand curves. No credentials ever written.
 */
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const RUN_CAP = 40; // hard ceiling on provider invocations; abort if a grid would exceed it
const CONCURRENCY = 4;
let CALL_TIMEOUT_MS = 280000; // default below the 300s production reviewer timeout; override with --timeout-ms= (measurement may use a longer window to capture true demand, then flag cells whose elapsed exceeds the 300s prod envelope)

// ============================================================
// Per-provider token accounting — MIRRORS src/server/llm/tokenAccounting.ts
// ============================================================
const TRUNCATION_FINISH_REASONS = new Set(['length', 'max_tokens', 'MAX_TOKENS']);
function splitModel(modelString) {
  const i = modelString.indexOf(':');
  return i < 0 ? { provider: modelString, modelId: '' } : { provider: modelString.slice(0, i), modelId: modelString.slice(i + 1) };
}
function reasoningAccountingFor(provider) {
  if (provider === 'openai' || provider === 'xai') return 'within-output';
  if (provider === 'google') return 'separate-from-output';
  return 'unavailable';
}
function nonNeg(n) { return Number.isFinite(n) && n > 0 ? n : 0; }
function deriveAccounting({ modelString, requestedMaxTokens, tokensPrompt, tokensCompletion, tokensReasoning, finishReason }) {
  const { provider, modelId } = splitModel(modelString);
  const mode = reasoningAccountingFor(provider);
  const prompt = nonNeg(tokensPrompt);
  const completion = nonNeg(tokensCompletion);
  const rawReasoning = tokensReasoning === null || tokensReasoning === undefined ? null : nonNeg(tokensReasoning);
  const reasoningTokens = mode === 'unavailable' ? null : rawReasoning;
  let emitted, budgetUsed;
  if (mode === 'within-output') {
    emitted = reasoningTokens === null ? completion : Math.max(0, completion - reasoningTokens);
    budgetUsed = completion;
  } else if (mode === 'separate-from-output') {
    emitted = completion;
    budgetUsed = completion + (reasoningTokens ?? 0);
  } else {
    emitted = completion;
    budgetUsed = completion;
  }
  const truncated = finishReason ? TRUNCATION_FINISH_REASONS.has(finishReason) : false;
  const maxT = requestedMaxTokens === null || requestedMaxTokens === undefined || !Number.isFinite(requestedMaxTokens) ? null : requestedMaxTokens;
  // distanceToTruncation can be positive even when truncated (Gemini under-reports thoughts);
  // gate L2 on truncated + truncationAxis, not on this field's sign. Mirrors tokenAccounting.ts.
  const distanceToTruncation = maxT === null ? null : maxT - budgetUsed;
  const emittedOutputFraction = budgetUsed > 0 ? emitted / budgetUsed : null;
  let axis = 'indeterminate';
  if (truncated) axis = reasoningTokens !== null ? (reasoningTokens > emitted ? 'reasoning-bound' : 'output-bound') : 'indeterminate';
  return { provider, modelId, reasoningAccounting: mode, requestedMaxTokens: maxT, promptTokens: prompt, reasoningTokens, emittedOutputTokens: emitted, budgetConsumedTokens: budgetUsed, totalTokens: prompt + budgetUsed, truncated, distanceToTruncation, emittedOutputFraction, truncationAxis: axis };
}

// ============================================================
// Reviewer system prompt — representative of the production reviewer output contract
// (legacy {title, body, severity} array with embedded NARRATIVE_REVIEWER_MEMO +
// STRUCTURED_FEEDBACK_CARDS), demanding per-provision coverage to drive realistic output
// volume. Not the verbatim 6f69c68 snapshot; sufficient for DEMAND measurement.
// ============================================================
function buildReviewerSystemPrompt() {
  return [
    'You are a senior co-counsel legal document reviewer for a Virginia/Maryland transactional attorney.',
    'Review the document and return attorney-facing feedback covering EVERY material provision that has a drafting or legal-sufficiency issue. Be thorough; do not summarize or omit issues to save space.',
    'Return ONLY a JSON array of legacy feedback items. Do not include any text outside the JSON array.',
    'Each item must have this exact shape: { "title": "short issue title", "body": "detailed attorney-facing feedback", "severity": "critical"|"major"|"minor" }.',
    'Inside each body string, include two labeled sections: NARRATIVE_REVIEWER_MEMO (an attorney-readable memo explaining the issue, governing-law treatment, and recommended action) and STRUCTURED_FEEDBACK_CARDS (a JSON array of cards with fields feedback_id, reviewer_track, severity, critique_type, issue, recommendation, requires_attorney_decision).',
    'Return [] only if there is genuinely no feedback.',
  ].join('\n');
}

// ============================================================
// Provider calls — capture usage INCLUDING reasoning tokens + finish_reason, even on truncation
// (the truncation IS the measurement; never discard the token counts).
// ============================================================
function budgetParamFor(provider, modelId, maxTokens) {
  if (provider === 'openai' && /^(gpt-5|o1|o3|o4)/.test(modelId)) return { max_completion_tokens: maxTokens };
  if (provider === 'openai' || provider === 'xai') return { max_tokens: maxTokens, temperature: 0.3 };
  return {};
}
async function callOpenAiLike(url, apiKey, provider, modelId, system, user, maxTokens) {
  const body = {
    model: modelId,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    ...budgetParamFor(provider, modelId, maxTokens),
    response_format: { type: 'json_object' },
  };
  let resp;
  try {
    resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(CALL_TIMEOUT_MS) });
  } catch (err) {
    const n = err && err.name;
    return { httpOk: false, errorClass: n === 'AbortError' || n === 'TimeoutError' ? 'timeout' : 'api_error', errorMessage: `fetch failed: ${String(err)}` };
  }
  if (!resp.ok) { const t = await resp.text().catch(() => ''); return { httpOk: false, errorClass: `http_${resp.status}`, errorMessage: `API ${resp.status}: ${t.slice(0, 200)}` }; }
  const data = await resp.json();
  return {
    httpOk: true,
    rawText: data.choices?.[0]?.message?.content ?? '',
    finishReason: data.choices?.[0]?.finish_reason ?? null,
    tokensPrompt: data.usage?.prompt_tokens,
    tokensCompletion: data.usage?.completion_tokens,
    tokensReasoning: data.usage?.completion_tokens_details?.reasoning_tokens ?? null,
  };
}
async function callAnthropic(modelId, system, user, maxTokens) {
  const apiKey = process.env['ANTHROPIC_API_KEY'];
  if (!apiKey) return { httpOk: false, errorClass: 'no_key', errorMessage: 'ANTHROPIC_API_KEY not set' };
  const effSystem = `${system}\n\nRespond ONLY with valid JSON. Do not include any text outside the JSON array.`;
  const body = { model: modelId, max_tokens: maxTokens, system: effSystem, messages: [{ role: 'user', content: user }] };
  let resp;
  try {
    resp = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }, body: JSON.stringify(body), signal: AbortSignal.timeout(CALL_TIMEOUT_MS) });
  } catch (err) {
    const n = err && err.name;
    return { httpOk: false, errorClass: n === 'AbortError' || n === 'TimeoutError' ? 'timeout' : 'api_error', errorMessage: `fetch failed: ${String(err)}` };
  }
  if (!resp.ok) { const t = await resp.text().catch(() => ''); return { httpOk: false, errorClass: `http_${resp.status}`, errorMessage: `API ${resp.status}: ${t.slice(0, 200)}` }; }
  const data = await resp.json();
  return {
    httpOk: true,
    rawText: data.content?.[0]?.text ?? '',
    finishReason: data.stop_reason ?? null,
    tokensPrompt: data.usage?.input_tokens,
    tokensCompletion: data.usage?.output_tokens,
    tokensReasoning: null, // Anthropic exposes no separate thinking-token count
  };
}
async function callGoogle(modelId, system, user, maxTokens) {
  const apiKey = process.env['GOOGLE_API_KEY'];
  if (!apiKey) return { httpOk: false, errorClass: 'no_key', errorMessage: 'GOOGLE_API_KEY not set' };
  // SECURITY: `url` contains the API key in its ?key= query param (mirrors the prod google.ts
  // adapter). NEVER log, print, or write `url` to an artifact, and never surface err.cause on
  // the fetch-error path (undici puts the URL there). Errors below use String(err) (message only).
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`;
  const body = {
    contents: [{ role: 'user', parts: [{ text: user }] }],
    systemInstruction: { parts: [{ text: system }] },
    generationConfig: { maxOutputTokens: maxTokens, temperature: 0.3, responseMimeType: 'application/json' },
    safetySettings: ['HARM_CATEGORY_HARASSMENT', 'HARM_CATEGORY_HATE_SPEECH', 'HARM_CATEGORY_SEXUALLY_EXPLICIT', 'HARM_CATEGORY_DANGEROUS_CONTENT'].map((category) => ({ category, threshold: 'BLOCK_NONE' })),
  };
  let resp;
  try {
    resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(CALL_TIMEOUT_MS) });
  } catch (err) {
    const n = err && err.name;
    return { httpOk: false, errorClass: n === 'AbortError' || n === 'TimeoutError' ? 'timeout' : 'api_error', errorMessage: `fetch failed: ${String(err)}` };
  }
  if (!resp.ok) { const t = await resp.text().catch(() => ''); return { httpOk: false, errorClass: `http_${resp.status}`, errorMessage: `API ${resp.status}: ${t.slice(0, 200)}` }; }
  const data = await resp.json();
  const cand = data.candidates?.[0];
  return {
    httpOk: true,
    rawText: cand?.content?.parts?.[0]?.text ?? '',
    finishReason: cand?.finishReason ?? null,
    tokensPrompt: data.usageMetadata?.promptTokenCount,
    tokensCompletion: data.usageMetadata?.candidatesTokenCount,
    tokensReasoning: data.usageMetadata?.thoughtsTokenCount ?? null,
  };
}
async function resolveAndCall(modelString, system, user, maxTokens) {
  const { provider, modelId } = splitModel(modelString);
  if (provider === 'openai') {
    const apiKey = process.env['OPENAI_API_KEY'];
    if (!apiKey) return { httpOk: false, errorClass: 'no_key', errorMessage: 'OPENAI_API_KEY not set' };
    return callOpenAiLike('https://api.openai.com/v1/chat/completions', apiKey, provider, modelId, system, user, maxTokens);
  }
  if (provider === 'xai') {
    const apiKey = process.env['XAI_API_KEY'];
    if (!apiKey) return { httpOk: false, errorClass: 'no_key', errorMessage: 'XAI_API_KEY not set' };
    return callOpenAiLike('https://api.x.ai/v1/chat/completions', apiKey, provider, modelId, system, user, maxTokens);
  }
  if (provider === 'anthropic') return callAnthropic(modelId, system, user, maxTokens);
  if (provider === 'google') return callGoogle(modelId, system, user, maxTokens);
  throw new Error(`Unknown provider ${provider}`);
}

// ============================================================
// Inputs + tracks + grid
// ============================================================
const SYNTHETIC_PATH = join(HERE, 'fixtures', 'synthetic_large_provision.txt');
const LEASE_PATH = join(HERE, 'inputs', 'lease_anonymized_v4.txt');
function loadInputs() {
  const inputs = [];
  if (existsSync(SYNTHETIC_PATH)) inputs.push({ id: 'synthetic', label: 'synthetic large-provision fixture (committed)', text: readFileSync(SYNTHETIC_PATH, 'utf8') });
  if (existsSync(LEASE_PATH)) inputs.push({ id: 'lease', label: 'anonymized real-shaped lease (local)', text: readFileSync(LEASE_PATH, 'utf8') });
  return inputs;
}
const FULL_TRACKS = [
  { key: 'gpt', modelString: 'openai:gpt-5' },
  { key: 'claude', modelString: 'anthropic:claude-opus-4-5' },
  { key: 'gemini', modelString: 'google:gemini-2.5-pro' },
  { key: 'grok', modelString: 'xai:grok-4' },
];
const LITE_TRACKS = [
  { key: 'gpt_lite', modelString: 'openai:gpt-4.1-mini' },
  { key: 'claude_lite', modelString: 'anthropic:claude-sonnet-4-5' },
  { key: 'gemini_lite', modelString: 'google:gemini-2.5-flash' },
  { key: 'grok_lite', modelString: 'xai:grok-3-mini' },
];

function buildGrid(mode, leaseBudgets) {
  const inputs = loadInputs();
  const synthetic = inputs.find((i) => i.id === 'synthetic');
  const lease = inputs.find((i) => i.id === 'lease');
  const cells = [];
  const add = (input, track, maxTokens) => { if (input) cells.push({ inputId: input.id, inputLabel: input.label, text: input.text, ...track, maxTokens }); };
  if (mode === 'smoke') {
    for (const t of FULL_TRACKS) add(synthetic, t, 16384);
  } else {
    const tracks = mode === 'full' ? [...FULL_TRACKS, ...LITE_TRACKS] : FULL_TRACKS;
    for (const t of tracks) add(synthetic, t, 16384);
    for (const t of tracks) for (const b of leaseBudgets) add(lease, t, b);
  }
  return { cells, hasLease: !!lease, hasSynthetic: !!synthetic };
}

// ============================================================
// Runner
// ============================================================
async function runWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let idx = 0;
  async function next() {
    const i = idx++;
    if (i >= items.length) return;
    results[i] = await worker(items[i], i);
    return next();
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => next()));
  return results;
}
function isoStamp() { return new Date().toISOString().replace(/[:.]/g, '-'); }

async function runOneCall(cell, runDir) {
  const system = buildReviewerSystemPrompt();
  const t0 = Date.now();
  const res = await resolveAndCall(cell.modelString, system, cell.text, cell.maxTokens);
  const elapsedMs = Date.now() - t0;
  let accounting = null;
  if (res.httpOk) {
    accounting = deriveAccounting({
      modelString: cell.modelString,
      requestedMaxTokens: cell.maxTokens,
      tokensPrompt: res.tokensPrompt,
      tokensCompletion: res.tokensCompletion,
      tokensReasoning: res.tokensReasoning,
      finishReason: res.finishReason,
    });
    // Preserve raw output locally (gitignored). No credentials present.
    const base = `${cell.inputId}__${cell.key}__b${cell.maxTokens}`;
    writeFileSync(join(runDir, `${base}.rawOutput.txt`), res.rawText ?? '');
  }
  return {
    inputId: cell.inputId, track: cell.key, modelString: cell.modelString, maxTokens: cell.maxTokens,
    elapsedMs, httpOk: res.httpOk, errorClass: res.errorClass ?? null, errorMessage: res.errorMessage ?? null,
    finishReason: res.finishReason ?? null, accounting,
  };
}

function fmt(r) {
  if (!r.httpOk) return `${r.inputId} ${r.track} b${r.maxTokens}: ERROR [${r.errorClass}] ${r.errorMessage ?? ''}`;
  const a = r.accounting;
  return `${r.inputId} ${r.track} b${r.maxTokens}: ${a.truncated ? 'TRUNCATED' : 'ok'} prompt=${a.promptTokens} reasoning=${a.reasoningTokens ?? 'n/a'} emitted=${a.emittedOutputTokens} budgetUsed=${a.budgetConsumedTokens} dist=${a.distanceToTruncation} emitFrac=${a.emittedOutputFraction === null ? 'n/a' : a.emittedOutputFraction.toFixed(2)}${a.truncated ? ` axis=${a.truncationAxis}` : ''} fr=${r.finishReason} (${(r.elapsedMs / 1000).toFixed(0)}s)`;
}

async function main() {
  const args = process.argv.slice(2);
  const mode = args.includes('--full') ? 'full' : args.includes('--measure') ? 'measure' : 'smoke';
  const budgetsArg = args.find((a) => a.startsWith('--budgets='));
  const leaseBudgets = budgetsArg ? budgetsArg.slice('--budgets='.length).split(',').map((s) => parseInt(s, 10)).filter((n) => Number.isFinite(n)) : [16384, 32768];
  const timeoutArg = args.find((a) => a.startsWith('--timeout-ms='));
  if (timeoutArg) { const t = parseInt(timeoutArg.slice('--timeout-ms='.length), 10); if (Number.isFinite(t) && t > 0) CALL_TIMEOUT_MS = t; }
  const { cells, hasLease, hasSynthetic } = buildGrid(mode, leaseBudgets);

  const runId = isoStamp();
  const runDir = join(HERE, 'runs', `budget-cal1-${runId}`);
  mkdirSync(runDir, { recursive: true });

  console.log(`[budget-cal1] mode=${mode} runId=${runId} cells=${cells.length} (cap ${RUN_CAP}) synthetic=${hasSynthetic} lease=${hasLease} leaseBudgets=${leaseBudgets.join(',')} callTimeoutMs=${CALL_TIMEOUT_MS} (prod envelope 300000)`);
  if (!hasSynthetic) { console.error('ABORT: synthetic fixture missing — run generate_synthetic_large_provision.mjs first.'); process.exit(2); }
  if (mode !== 'smoke' && !hasLease) console.warn(`NOTE: lease input absent at ${LEASE_PATH} — lease cells skipped (synthetic only).`);
  if (cells.length > RUN_CAP) { console.error(`ABORT: ${cells.length} calls exceeds run cap ${RUN_CAP}.`); process.exit(2); }

  const results = await runWithConcurrency(cells, CONCURRENCY, async (cell) => {
    const r = await runOneCall(cell, runDir);
    console.log(`  ${fmt(r)}`);
    return r;
  });

  // Per-model demand-curve view: group by (track, input), ordered by budget.
  const curves = {};
  for (const r of results) {
    if (!r.httpOk) continue;
    const k = `${r.modelString} | ${r.inputId}`;
    (curves[k] ??= []).push({ maxTokens: r.maxTokens, truncated: r.accounting.truncated, axis: r.accounting.truncationAxis, promptTokens: r.accounting.promptTokens, reasoningTokens: r.accounting.reasoningTokens, emittedOutputTokens: r.accounting.emittedOutputTokens, budgetConsumedTokens: r.accounting.budgetConsumedTokens, distanceToTruncation: r.accounting.distanceToTruncation, emittedOutputFraction: r.accounting.emittedOutputFraction, reasoningAccounting: r.accounting.reasoningAccounting });
  }
  for (const k of Object.keys(curves)) curves[k].sort((a, b) => a.maxTokens - b.maxTokens);

  const summary = {
    engagement: 'GEMINI-BUDGET-CAL-1', increment: 1, mode, runId,
    note: 'Measurement only. Reasoning split is best-effort per provider (Anthropic exposes none). Reviewer prompt is representative of the production output contract, not the verbatim snapshot.',
    leaseBudgets, hasLease,
    calls: results.map((r) => ({ inputId: r.inputId, track: r.track, modelString: r.modelString, maxTokens: r.maxTokens, httpOk: r.httpOk, errorClass: r.errorClass, finishReason: r.finishReason, elapsedSec: Math.round(r.elapsedMs / 1000), accounting: r.accounting })),
    demandCurves: curves,
  };
  writeFileSync(join(runDir, 'grid.summary.json'), JSON.stringify(summary, null, 2));

  console.log('\n=== DEMAND CURVES (per model × input, by budget) ===');
  for (const k of Object.keys(curves)) {
    console.log(`\n${k}  [${curves[k][0].reasoningAccounting}]`);
    for (const pt of curves[k]) {
      console.log(`  b${pt.maxTokens}: ${pt.truncated ? 'TRUNCATED' : 'ok'} reasoning=${pt.reasoningTokens ?? 'n/a'} emitted=${pt.emittedOutputTokens} budgetUsed=${pt.budgetConsumedTokens} dist=${pt.distanceToTruncation}${pt.truncated ? ` axis=${pt.axis}` : ''}`);
    }
  }
  console.log(`\nartifacts: tools/calibration/runs/budget-cal1-${runId}/`);
}

main().catch((e) => { console.error('HARNESS ERROR:', e); process.exit(1); });
