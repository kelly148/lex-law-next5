/**
 * golden_reviewer_harness.mjs — ULTRABUILD-1 W6 (run-sheet G.6): the golden reviewer-prompt drift harness.
 *
 * DARK BY DEFAULT — NO provider egress. It reads the committed golden set (per-lane fixtures + baselines),
 * reduces each captured output to a semantic signature, and diffs it against the stored per-lane baseline.
 * Exit 0 = no drift; non-zero = drift (a CI-gateable contract).
 *
 * W6-LIVE-CAPTURE-1: --live is now IMPLEMENTED. It calls the live reviewer providers on the pinned golden
 * prompts (reusing cal7b's reviewer-prompt builder + provider machinery + config-sourced lane models),
 * captures per-lane raw outputs to golden/runs/ (gitignored), and PROMOTES per-lane fixtures.json +
 * baselines.json. It IS an egress action (operator-gated) and is the durable RE-BASELINING path after an
 * authorized model/prompt change. baselines.json shape: { scenarioId: { track: signature } }.
 *
 * MIRROR-AND-SYNC: extractSignature/diffSignature below are a VERBATIM inline copy of
 * src/server/calibration/goldenReviewerDiff.ts (this file runs as plain Node ESM without the TS build). Keep
 * the two in sync — the unit test src/server/__tests__/golden_reviewer_diff.test.ts pins the TS source of
 * truth (the tokenAccounting.ts convention). SNAPSHOT of the TS module: 2026-07-03 (ULTRABUILD-1 W6).
 *
 * Usage:
 *   node tools/calibration/golden_reviewer_harness.mjs           # DARK: per-lane fixtures vs baselines (no egress)
 *   node tools/calibration/golden_reviewer_harness.mjs --live    # LIVE: capture + promote per-lane baselines (egress)
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
// W6-LIVE-CAPTURE-1: reuse the cal7b harness's reviewer prompt builder, provider-call machinery (incl.
// the RPR-1..7 parsing + request-shape handling), and config-sourced lane models. Importing is
// zero-egress — cal7b's main() is guarded to run only when cal7b is invoked directly.
import { buildReviewerSystemPrompt, resolveAndCall, TRACKS } from './cal7b_harness.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const GOLDEN = join(HERE, 'golden');

// ── inline copy of goldenReviewerDiff.ts (keep in sync; the unit test pins the TS source) ──────────────
function joinText(items) { return items.map((i) => `${i.title}\n${i.body}`).join('\n').toLowerCase(); }
function hasMajorOrCritical(items) { return items.some((i) => i.severity === 'critical' || i.severity === 'major'); }
function anyMatch(text, ...patterns) { return patterns.some((re) => re.test(text)); }

function parseFeedbackOutput(raw) {
  const stripped = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const parsed = JSON.parse(stripped); // throws on malformed -> caller maps to PARSE_FAILURE
  if (!Array.isArray(parsed)) throw new Error('REVIEWER_OUTPUT_MALFORMED: not an array');
  return parsed.map((i) => ({ title: String(i.title), body: String(i.body), severity: i.severity }));
}

function featuresFor(scenarioId, items) {
  const text = joinText(items);
  if (scenarioId === 'P8-T1') {
    const flagsRoutineBlank =
      anyMatch(text, /signature block|notary|acknowledgment|date line|execution block|jurat/) &&
      anyMatch(text, /blank|incomplete|missing|fill in|not (yet )?(signed|completed)/);
    return { features: { flagsRoutineBlank, emptyOutput: items.length === 0 }, status: flagsRoutineBlank ? 'FAIL' : 'PASS' };
  }
  if (scenarioId === 'P8-T6') {
    const flagsAudienceRisk = anyMatch(text, /audience|over-?disclos|opposing counsel|counterparty|internal|walk-?away|reveal|expose/);
    const preservesOffer = !anyMatch(text, /change the (offer|split|50)|revise the offer|different (offer|split)|renegotiat|lower the (offer|number)/);
    const substantive = hasMajorOrCritical(items) || anyMatch(text, /substantive|drafting|audience risk/);
    const status = flagsAudienceRisk && preservesOffer ? (substantive ? 'PASS' : 'PARTIAL') : 'FAIL';
    return { features: { flagsAudienceRisk, preservesOffer, substantive }, status };
  }
  if (scenarioId === 'P8-T7') {
    const identifiesGoverningLaw = anyMatch(text, /governing law|jurisdiction|choice of law|california|conflict of law|venue/);
    const escalatesBlocker = hasMajorOrCritical(items) || anyMatch(text, /blocker|before (it can be )?sent|before send|do not send|must be resolved/);
    const status = identifiesGoverningLaw && escalatesBlocker ? 'PASS' : identifiesGoverningLaw ? 'PARTIAL' : 'FAIL';
    return { features: { identifiesGoverningLaw, escalatesBlocker }, status };
  }
  if (scenarioId === 'P8-T10') {
    const mentionsRecourse = anyMatch(text, /(^|[^-])recourse/);
    const mentionsNonRecourse = anyMatch(text, /non-?recourse/);
    const surfacesBothPaths = (mentionsRecourse && mentionsNonRecourse) || anyMatch(text, /both (options|paths)|option a[\s\S]*option b/);
    const requiresAttorneyDecision = anyMatch(text, /attorney (decision|choice|should decide|must decide|to decide)|business decision|your (call|decision)|requires a decision/);
    const choosesPath = anyMatch(text, /recommend (the )?(non-?recourse|recourse)|should (use|choose|be) (non-?recourse|recourse)|change (it|the note) to (non-?recourse|recourse)/);
    const status = surfacesBothPaths && requiresAttorneyDecision && !choosesPath ? 'PASS' : choosesPath ? 'FAIL' : 'PARTIAL';
    return { features: { surfacesBothPaths, requiresAttorneyDecision, choosesPath }, status };
  }
  throw new Error(`unknown golden scenario: ${scenarioId}`);
}

function extractSignature(scenarioId, rawOutput) {
  let items;
  try { items = parseFeedbackOutput(rawOutput); }
  catch { return { scenarioId, status: 'PARSE_FAILURE', itemCount: 0, features: {} }; }
  const { features, status } = featuresFor(scenarioId, items);
  return { scenarioId, status, itemCount: items.length, features };
}

function diffSignature(baseline, current) {
  const diffs = [];
  if (baseline.status !== current.status) diffs.push({ field: 'status', baseline: baseline.status, current: current.status });
  if (baseline.itemCount !== current.itemCount) diffs.push({ field: 'itemCount', baseline: baseline.itemCount, current: current.itemCount });
  const keys = new Set([...Object.keys(baseline.features), ...Object.keys(current.features)]);
  for (const k of keys) if (baseline.features[k] !== current.features[k]) diffs.push({ field: `features.${k}`, baseline: baseline.features[k], current: current.features[k] });
  return diffs;
}
// ── end inline copy ──────────────────────────────────────────────────────────────────────────────────

function readJson(p) { return JSON.parse(readFileSync(p, 'utf8')); }
function isoStamp() { return new Date().toISOString().replace(/[:.]/g, '-'); }

// ── W6-LIVE-CAPTURE-1: --live per-lane baseline capture ─────────────────────────────────────────────────
// For each golden scenario × each of its declared tracks, build the reviewer system prompt (the current
// production builder, reused from cal7b) + the pinned golden userPrompt, call the live provider, reduce the
// output to a semantic signature, and PROMOTE per-lane fixtures.json + baselines.json. Raw captures go to
// golden/runs/<runId>/ (gitignored). Re-runnable: this is the durable re-baselining path after an authorized
// model/prompt change. baselines.json shape: { [scenarioId]: { [track]: signature } }.
async function runLive() {
  const prompts = readJson(join(GOLDEN, 'prompts.json'));
  const scenarios = prompts.scenarios;
  const runId = isoStamp();
  const runDir = join(GOLDEN, 'runs', runId);
  mkdirSync(runDir, { recursive: true });
  console.log(`[golden --live] runId=${runId} contract=${prompts.contract}`);
  console.log('[golden --live] lane models: ' + Object.keys(TRACKS).map((k) => `${k}=${TRACKS[k].modelString}`).join('  '));

  const fixtures = { _note: 'W6 golden reviewer outputs — LIVE-captured PER LANE from the post-modernization reviewer models (W6-LIVE-CAPTURE-1). Synthetic scenarios, prod-free. Shape: { scenarioId: { track: canonicalArrayString } }. Re-capture with `node golden_reviewer_harness.mjs --live`.' };
  const baselines = { _note: 'W6 baseline signatures — LIVE-captured PER LANE (W6-LIVE-CAPTURE-1). Shape: { scenarioId: { track: signature } }. A model or reviewer-prompt swap that changes ANY of these signatures is drift (DARK harness exit 1). Re-baseline via --live after an authorized change.' };

  let calls = 0;
  for (const scenarioId of Object.keys(scenarios)) {
    const sc = scenarios[scenarioId];
    fixtures[scenarioId] = {};
    baselines[scenarioId] = {};
    for (const track of sc.tracks) {
      const t = TRACKS[track];
      if (!t) { console.error(`  ${scenarioId} x ${track}: SKIP (no such track in config)`); continue; }
      const system = buildReviewerSystemPrompt(track, t.track);
      calls += 1;
      const res = await resolveAndCall(t.modelString, system, sc.userPrompt);
      // Prefer the normalized canonical array (what the signature extractor expects); fall back to raw.
      const fixtureText = res.canonical ?? res.rawText ?? '';
      writeFileSync(join(runDir, `${scenarioId}__${track}.rawOutput.txt`), res.rawText ?? '');
      writeFileSync(join(runDir, `${scenarioId}__${track}.canonical.json`), res.canonical ?? '');
      const sig = extractSignature(scenarioId, fixtureText);
      fixtures[scenarioId][track] = fixtureText;
      baselines[scenarioId][track] = sig;
      console.log(`  ${scenarioId} x ${track} (${t.modelString}): ${sig.status} items=${sig.itemCount}${res.errorClass ? ' [' + res.errorClass + ']' : ''}`);
    }
  }

  writeFileSync(join(GOLDEN, 'fixtures.json'), JSON.stringify(fixtures, null, 2) + '\n');
  writeFileSync(join(GOLDEN, 'baselines.json'), JSON.stringify(baselines, null, 2) + '\n');
  console.log(`\n[golden --live] ${calls} live call(s). Promoted per-lane fixtures.json + baselines.json (raw captures in golden/runs/${runId}/, gitignored).`);
}

// ── DARK: committed per-lane fixtures vs committed per-lane baselines, zero egress (the CI drift gate) ──
function runDark() {
  const fixtures = readJson(join(GOLDEN, 'fixtures.json'));
  const baselines = readJson(join(GOLDEN, 'baselines.json'));
  let drift = 0;
  let checked = 0;
  for (const scenarioId of Object.keys(baselines)) {
    if (scenarioId.startsWith('_')) continue; // skip _note metadata
    const laneBaselines = baselines[scenarioId];
    const laneFixtures = fixtures[scenarioId] ?? {};
    for (const track of Object.keys(laneBaselines)) {
      checked += 1;
      const raw = laneFixtures[track];
      if (typeof raw !== 'string') { console.error(`MISSING fixture for ${scenarioId} x ${track}`); drift += 1; continue; }
      const current = extractSignature(scenarioId, raw);
      const diffs = diffSignature(laneBaselines[track], current);
      if (diffs.length === 0) { console.log(`OK    ${scenarioId} x ${track} (${current.status})`); }
      else { drift += 1; console.log(`DRIFT ${scenarioId} x ${track}: ${diffs.map((d) => `${d.field} ${JSON.stringify(d.baseline)}->${JSON.stringify(d.current)}`).join('; ')}`); }
    }
  }
  if (drift > 0) { console.error(`\n${drift}/${checked} lane-scenario(s) drifted from baseline.`); process.exit(1); }
  console.log(`\nAll ${checked} golden lane-scenarios match baseline (DARK; zero egress).`);
}

async function main() {
  if (process.argv.includes('--live')) { await runLive(); return; }
  runDark();
}

main().catch((e) => { console.error('GOLDEN HARNESS ERROR:', e); process.exit(1); });
