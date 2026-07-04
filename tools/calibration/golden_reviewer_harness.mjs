/**
 * golden_reviewer_harness.mjs — ULTRABUILD-1 W6 (run-sheet G.6): the golden reviewer-prompt drift harness.
 *
 * DARK BY DEFAULT — NO provider egress. It reads the committed synthetic golden set (prompts + canned reviewer
 * outputs), reduces each output to a semantic signature, and diffs it against the stored baseline. Exit 0 = no
 * drift; non-zero = drift (a CI-gateable contract). The FIRST live baseline capture is CAL-1, a separate
 * operator-gated dispatch that IS an egress action — this harness hard-refuses any provider call unless the
 * (not-yet-built) --live path is explicitly requested.
 *
 * MIRROR-AND-SYNC: extractSignature/diffSignature below are a VERBATIM inline copy of
 * src/server/calibration/goldenReviewerDiff.ts (this file runs as plain Node ESM without the TS build). Keep
 * the two in sync — the unit test src/server/__tests__/golden_reviewer_diff.test.ts pins the TS source of
 * truth (the tokenAccounting.ts convention). SNAPSHOT of the TS module: 2026-07-03 (ULTRABUILD-1 W6).
 *
 * Usage:
 *   node tools/calibration/golden_reviewer_harness.mjs           # DARK: fixtures vs baselines (no egress)
 *   node tools/calibration/golden_reviewer_harness.mjs --live    # refuses (CAL-1 owns live capture)
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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

function main() {
  if (process.argv.includes('--live')) {
    console.error('REFUSED: --live provider capture is NOT implemented here. Live golden-baseline capture is CAL-1 (operator-gated, an egress action). This harness is DARK-only: it runs committed fixtures against committed baselines with zero egress.');
    process.exit(2);
  }
  const fixtures = readJson(join(GOLDEN, 'fixtures.json'));   // { [scenarioId]: rawOutputString }
  const baselines = readJson(join(GOLDEN, 'baselines.json')); // { [scenarioId]: signature }
  let drift = 0;
  for (const scenarioId of Object.keys(baselines)) {
    if (scenarioId.startsWith('_')) continue; // skip _note metadata
    const raw = fixtures[scenarioId];
    if (typeof raw !== 'string') { console.error(`MISSING fixture for ${scenarioId}`); drift++; continue; }
    const current = extractSignature(scenarioId, raw);
    const diffs = diffSignature(baselines[scenarioId], current);
    if (diffs.length === 0) { console.log(`OK   ${scenarioId} (${current.status})`); }
    else { drift++; console.log(`DRIFT ${scenarioId}: ${diffs.map((d) => `${d.field} ${JSON.stringify(d.baseline)}->${JSON.stringify(d.current)}`).join('; ')}`); }
  }
  if (drift > 0) { console.error(`\n${drift} scenario(s) drifted from baseline.`); process.exit(1); }
  console.log('\nAll golden scenarios match baseline (DARK; zero egress).');
}

main();
