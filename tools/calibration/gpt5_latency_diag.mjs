/*
 * GPT-5 reviewer latency diagnostic (GEMINI-BUDGET-CAL-1 follow-on)
 *
 * Plain Node ESM. MEASUREMENT ONLY — does NOT touch the production adapter and writes NO
 * production fix. Re-runs GPT-5 on the anonymized real-shaped lease, varying ONE thing at a
 * time, to decide whether GPT-5 can return a full-quality, full-doc review within a tolerable
 * window — and if so how (streaming + longer envelope) vs whether it needs an async job.
 *
 * CONSTRAINT (operator): GPT-5 review quality is non-negotiable. This diagnostic MEASURES the
 * effort/time tradeoff (default vs medium vs low) to justify a recommendation; it does NOT
 * endorse capping effort or fragmenting whole-doc context.
 *
 * Inc-1 failure mechanism (confirmed in code): a non-streaming GPT-5 call that reasons for
 * minutes never sends response HEADERS in time, so undici's internal ~300s headersTimeout fires
 * and surfaces as `TypeError: fetch failed` — which the adapter wraps as api_error and which
 * isTransientRetryable() then RETRIES (the message contains "fetch failed"), wasting ~3x the
 * wall clock. Streaming sends headers immediately and streams the body incrementally.
 *
 * Uses node:https directly (NOT fetch/undici) so the only time limit is the explicit per-variant
 * signal — a long silent reasoning gap is not killed by undici's internal ~300s body/headers
 * timeout. This isolates "can GPT-5 return given enough time + a live connection?" from the
 * undici artifact that broke Inc-1.
 *
 * VARIANTS (one knob at a time):
 *   1. non-streaming, effort=default, 300s signal  — reproduce the baseline failure timing
 *   2. streaming,     effort=default, long signal   — does it return? TTFT + total
 *   3. streaming,     effort=medium,  long signal   — time drop?
 *   4. streaming,     effort=low,     long signal   — time drop + (eyeball) quality?
 *
 * Per variant records: TTFB (first byte), TTFT (first OUTPUT token; streaming only), total wall,
 * finish_reason, prompt/reasoning/emitted tokens, returned?, error. Emitted review text is saved
 * locally (gitignored) for an eyeball quality compare across efforts.
 *
 * CREDENTIALS: OPENAI_API_KEY read from process.env at call time only; never printed/written.
 *
 *   Run:  node tools/calibration/gpt5_latency_diag.mjs            (all 4 variants, sequential)
 *         node tools/calibration/gpt5_latency_diag.mjs --only=2,3 (subset)
 *         node tools/calibration/gpt5_latency_diag.mjs --max-tokens=40000 --signal-ms=900000
 */
import https from 'node:https';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const MODEL = 'gpt-5';
const API_HOST = 'api.openai.com';
const API_PATH = '/v1/chat/completions';
const LEASE_PATH = join(HERE, 'inputs', 'lease_anonymized_v4.txt');

const REVIEWER_SYSTEM = [
  'You are a senior co-counsel legal document reviewer for a Virginia/Maryland transactional attorney.',
  'Review the entire document and return attorney-facing feedback covering EVERY material provision that has a drafting or legal-sufficiency issue. Be thorough; do not summarize or omit issues to save space.',
  'Return ONLY a JSON array of items shaped { "title": string, "body": string, "severity": "critical"|"major"|"minor" }, with no text outside the JSON array. Inside each body include a NARRATIVE_REVIEWER_MEMO and a STRUCTURED_FEEDBACK_CARDS JSON array. Return [] only if there is genuinely no feedback.',
].join('\n');

function arg(name, def) {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : def;
}
const MAX_TOKENS = parseInt(arg('max-tokens', '32768'), 10); // generous so budget is not the limiter
const SIGNAL_MS = parseInt(arg('signal-ms', '900000'), 10); // 15-min ceiling for the streaming variants
const ONLY = arg('only', '').split(',').map((s) => s.trim()).filter(Boolean);

const VARIANTS = [
  { id: '1', stream: false, effort: undefined, signalMs: 300000, note: 'non-streaming, effort=default, 300s signal (reproduce baseline timing)' },
  { id: '2', stream: true, effort: undefined, signalMs: SIGNAL_MS, note: 'streaming, effort=default, long signal' },
  { id: '3', stream: true, effort: 'medium', signalMs: SIGNAL_MS, note: 'streaming, effort=medium, long signal' },
  { id: '4', stream: true, effort: 'low', signalMs: SIGNAL_MS, note: 'streaming, effort=low, long signal' },
  { id: '5', stream: false, effort: undefined, signalMs: SIGNAL_MS, note: 'non-streaming, effort=default, long signal (isolate envelope-ALONE: does just raising the timeout return full quality, no streaming refactor?)' },
];

function callGpt5(v, apiKey, lease, runDir) {
  return new Promise((resolve) => {
    const bodyObj = {
      model: MODEL,
      messages: [{ role: 'system', content: REVIEWER_SYSTEM }, { role: 'user', content: lease }],
      max_completion_tokens: MAX_TOKENS,
    };
    if (v.effort) bodyObj.reasoning_effort = v.effort;
    if (v.stream) { bodyObj.stream = true; bodyObj.stream_options = { include_usage: true }; }
    const payload = JSON.stringify(bodyObj);

    const t0 = Date.now();
    let ttfb = null, ttft = null, finishReason = null, usage = null, content = '', status = null, sseBuf = '', ended = false;

    const finishOk = () => {
      const totalMs = Date.now() - t0;
      const promptTokens = usage?.prompt_tokens ?? null;
      const completionTokens = usage?.completion_tokens ?? null;
      const reasoningTokens = usage?.completion_tokens_details?.reasoning_tokens ?? null;
      const emittedTokens =
        completionTokens !== null && reasoningTokens !== null ? Math.max(0, completionTokens - reasoningTokens) : completionTokens;
      try {
        writeFileSync(join(runDir, `variant${v.id}_effort-${v.effort ?? 'default'}_${v.stream ? 'stream' : 'nonstream'}.txt`), content);
      } catch { /* artifact write is best-effort */ }
      resolve({ ...v, returned: true, ttfbMs: ttfb, ttftMs: ttft, totalMs, httpStatus: status, finishReason, promptTokens, reasoningTokens, emittedTokens, completionTokens, charsEmitted: content.length });
    };
    const finishErr = (msg) => resolve({ ...v, returned: false, ttfbMs: ttfb, ttftMs: ttft, totalMs: Date.now() - t0, httpStatus: status, error: msg });

    const req = https.request(
      { host: API_HOST, path: API_PATH, method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}`, 'Content-Length': Buffer.byteLength(payload) } },
      (res) => {
        status = res.statusCode;
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          if (ttfb === null) ttfb = Date.now() - t0;
          if (status >= 400) { content += chunk; return; } // accumulate error body
          if (!v.stream) { content += chunk; return; } // accumulate full JSON
          sseBuf += chunk;
          let nl;
          while ((nl = sseBuf.indexOf('\n\n')) >= 0) {
            const evt = sseBuf.slice(0, nl); sseBuf = sseBuf.slice(nl + 2);
            for (const line of evt.split('\n')) {
              if (!line.startsWith('data:')) continue;
              const p = line.slice(5).trim();
              if (p === '[DONE]' || p === '') continue;
              let j; try { j = JSON.parse(p); } catch { continue; }
              const d = j.choices?.[0]?.delta?.content;
              if (d) { if (ttft === null) ttft = Date.now() - t0; content += d; }
              if (j.choices?.[0]?.finish_reason) finishReason = j.choices[0].finish_reason;
              if (j.usage) usage = j.usage;
            }
          }
        });
        res.on('end', () => {
          if (ended) return; ended = true; clearTimeout(timer);
          if (status >= 400) return finishErr(`API ${status}: ${content.slice(0, 220)}`);
          if (!v.stream) {
            try {
              const data = JSON.parse(content);
              finishReason = data.choices?.[0]?.finish_reason ?? null;
              usage = data.usage ?? null;
              content = data.choices?.[0]?.message?.content ?? '';
              ttft = Date.now() - t0; // non-streaming has no incremental signal
            } catch (e) { return finishErr(`json-parse: ${String(e?.message ?? e)}`); }
          }
          finishOk();
        });
      },
    );
    req.on('error', (err) => { if (ended) return; ended = true; clearTimeout(timer); finishErr(`req-error: ${String(err?.message ?? err)}`); });
    const timer = setTimeout(() => { if (ended) return; ended = true; req.destroy(); finishErr(`signal-timeout after ${(v.signalMs / 1000).toFixed(0)}s (no completion)`); }, v.signalMs);
    req.write(payload); req.end();
  });
}

function fmtRow(r) {
  const s = (ms) => (ms === null || ms === undefined ? 'n/a' : (ms / 1000).toFixed(1) + 's');
  const lbl = `V${r.id} [${r.effort ?? 'default'}/${r.stream ? 'stream' : 'nonstream'}]`;
  if (!r.returned) return `${lbl} FAILED ttfb=${s(r.ttfbMs)} total=${s(r.totalMs)} :: ${r.error}`;
  const overEnv = r.totalMs > 300000 ? ' >PROD-ENVELOPE(300s)' : '';
  return `${lbl} OK ttfb=${s(r.ttfbMs)} ttft(out)=${s(r.ttftMs)} total=${s(r.totalMs)}${overEnv} finish=${r.finishReason} prompt=${r.promptTokens} reasoning=${r.reasoningTokens} emitted=${r.emittedTokens} chars=${r.charsEmitted}`;
}

async function main() {
  const apiKey = process.env['OPENAI_API_KEY'];
  if (!apiKey) { console.error('ABORT: OPENAI_API_KEY not set.'); process.exit(2); }
  if (!existsSync(LEASE_PATH)) { console.error(`ABORT: lease input missing at ${LEASE_PATH}.`); process.exit(2); }
  const lease = readFileSync(LEASE_PATH, 'utf8');
  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const runDir = join(HERE, 'runs', `gpt5-latency-${runId}`);
  mkdirSync(runDir, { recursive: true });
  const variants = ONLY.length ? VARIANTS.filter((v) => ONLY.includes(v.id)) : VARIANTS;

  console.log(`[gpt5-latency-diag] runId=${runId} model=${MODEL} leaseChars=${lease.length} maxTokens=${MAX_TOKENS} signalMs=${SIGNAL_MS} variants=${variants.map((v) => v.id).join(',')} prodEnvelope=300000ms (via node:https, no undici timeout)`);
  console.log('Running sequentially for clean per-variant timing. GPT-5 at full effort may take many minutes.\n');

  const results = [];
  for (const v of variants) {
    console.log(`--- V${v.id}: ${v.note} (signal ${(v.signalMs / 1000).toFixed(0)}s)`);
    const r = await callGpt5(v, apiKey, lease, runDir);
    console.log(`    ${fmtRow(r)}\n`);
    results.push(r);
  }

  writeFileSync(join(runDir, 'matrix.json'), JSON.stringify({ engagement: 'GPT5-LATENCY-DIAG', runId, model: MODEL, maxTokens: MAX_TOKENS, leaseChars: lease.length, prodEnvelopeMs: 300000, results }, null, 2));
  console.log('=== MATRIX ===');
  for (const r of results) console.log(fmtRow(r));
  console.log(`\nemitted review text per variant + matrix.json: tools/calibration/runs/gpt5-latency-${runId}/`);
}

main().catch((e) => { console.error('DIAG ERROR:', e); process.exit(1); });
