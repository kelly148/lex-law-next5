/*
 * CAL-7B calibration harness (Increment 2 — full grid driver)
 *
 * Engagement: CAL-7B-HARNESS (Phase A). Plain Node ESM (no TS toolchain / no
 * node_modules required; Node 24 global fetch). Feeds engineered P8-T scenario
 * fixtures to reviewer tracks via the real provider REST call shapes, preserves
 * raw + normalized output, and scores with the classifyScenario predicates
 * ported VERBATIM from the in-repo sources at commit 6f69c68.
 *
 * COVERS Blocks A/B/C (scenario cells P8-T1/T6/T7/T10 x tracks) only. The
 * feature cells F1-F5 (sendability, locked decisions, adopt ledger, evaluator,
 * native cards) are LIVE-app behaviors and run in CAL-7B-LIVE, not here.
 *
 * SNAPSHOT FIDELITY: reviewer system prompt (reviewerPrompts.ts), provider call
 * shapes (openai.ts/anthropic.ts/google.ts/xai.ts), and scoring predicates
 * (mr_cal_2d_calibration_scoring.test.ts) are COPIED here (node_modules absent),
 * verbatim as of commit 6f69c68. If those sources change, re-sync this snapshot.
 * This harness never edits the live sources.
 *
 * CREDENTIALS: provider keys read from process.env at call time only; never
 * printed, logged, or written to artifacts. Run via PowerShell with User-scope
 * keys injected so ANTHROPIC_API_KEY (User scope, not in the Bash process env)
 * reaches the child Node process.
 *
 * FIXTURES: re-derived (Hybrid decision) baseline, NOT the 20260528T122851Z
 * originals. Reconcilable if the original bundle is supplied.
 *
 * MODES:  default = --smoke (bounded build-validation subset)
 *         --full  = the entire Block A/B/C grid (this is the CAL-7B-LIVE run)
 *
 * LANE FILTER (CLAUDE-LANE-MODERNIZATION-1): --lanes=<a,b,...> restricts either mode's grid to the named
 *         reviewer lanes only, so a G.3 model-swap rerun can exercise ONLY the changed lanes instead of
 *         the whole grid. Lane names are the config keys (gpt, claude, gemini, grok, gpt_lite, claude_lite,
 *         gemini_lite, grok_lite). Unknown names abort loudly. Example (rerun both Claude lanes after a
 *         Claude model swap):  node tools/calibration/cal7b_harness.mjs --full --lanes=claude,claude_lite
 */

import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_COMMIT = '6f69c68';
const RUN_CAP = 75; // hard ceiling on provider invocations (CAL-7B-PLAN run cap)
const CONCURRENCY = 4;
const REVIEWER_MAX_TOKENS = 16384; // mirrors reviewSession.ts:321
const CALL_TIMEOUT_MS = 220000;

// ============================================================
// Reviewer system prompt — VERBATIM snapshot of reviewerPrompts.ts @ 6f69c68
// ============================================================
const FEEDBACK_CARD_FIELD_NAMES = ['feedback_id','review_cycle_id','reviewer_track','severity','severity_subtype','critique_type','target_document','target_section','issue','source_basis','source_of_truth_tier','recommendation','suggested_revision','requires_attorney_decision','suppress_by_default','routine_blank_flag','audience_affected','confidence','disposition_options','future_memory_instruction','persistence_count','persistence_chain','evaluator_disposition','evaluator_rationale','regeneration_instructions'];
const FEEDBACK_CARD_CRITIQUE_TYPES = ['legal_sufficiency','drafting_precision','structural','audience','factual','stylistic','matter_memory_correction','audience_shift_recommendation','overstatement','under_inclusion_or_omission','cross_document_consistency','reviewer_role_overreach'];
const FEEDBACK_CARD_DISPOSITIONS = ['adopt','modify','reject','defer','preserve internally','unresolved','already addressed','superseded','pass'];

const severityTaxonomy = [
  'Use this five-tier severity taxonomy exactly: BLOCKER, SUBSTANTIVE, STRUCTURAL, PRECISION, POLISH.',
  'BLOCKER = sendability fail or issue that prevents responsible attorney release.',
  'SUBSTANTIVE = legal, risk-allocation, or deal-position issue and must include severity_subtype DRAFTING or BUSINESS.',
  'SUBSTANTIVE/DRAFTING = how to express a settled legal or business position; you may recommend drafting language.',
  'SUBSTANTIVE/BUSINESS = what position, risk allocation, or deal term to choose; surface options and do not choose the business path for the attorney.',
  'STRUCTURAL = organization, cross-reference, sequencing, or internal-consistency problem.',
  'PRECISION = wording, ambiguity, defined-term, citation, or source-basis precision problem.',
  'POLISH = style, readability, grammar, or aesthetics with no substantive effect.',
].join('\n');
const sevenMissingRules = [
  'Execution-blanks suppression: do not flag ordinary signature, date, witness, or notary blanks on pre-execution drafts; if a routine blank must be represented, mark routine_blank_flag true and suppress_by_default true. Missing legal description, principal amount, tax deadline, property identity, or other non-routine blanks remain flaggable.',
  'Substance-vs-tone classification: do not soften substantively correct legal positions unless audience or relationship-risk justifies it; label any softening recommendation as substance or tone in the narrative memo and card rationale.',
  'Drafting-vs-business separation: drafting means how to express a settled position; business means what position, risk allocation, or deal term to choose; never make business decisions for the attorney.',
  'Matter-memory awareness: check provided matter context for locked decisions and do not re-raise previously resolved or locked decisions absent material change.',
  'Reviewer-persistence treatment: if re-raising a previously disposed issue because it remains important, mark it as persistence with persistence_count and persistence_chain rather than silently suppressing it.',
  'Cross-model defect complementarity: when reviewing another reviewer output or acting in second-opinion mode, identify overlap, disagreement, and complementary catches across GPT, Claude, Grok, and Gemini without limiting any model to a single role.',
  'Cumulative state carry-forward: when reviewing regenerated drafts, treat prior adopted changes as part of the current intended state and do not flag adopted changes as new defects.',
].join('\n');
const businessDecisionCalibration = [
  'Business-decision calibration anchor: if the draft reflects one possible business structure but matter context says the attorney has not selected the structure, treat the unselected structure as SUBSTANTIVE/BUSINESS rather than SUBSTANTIVE/DRAFTING.',
  'For seller-financing recourse decisions, including Path-A recourse with senior-debt cap versus Path-B non-recourse seller financing, identify the risk-allocation decision and set requires_attorney_decision true.',
  'Surface both available paths for attorney selection: Path A = recourse with senior-debt cap, with any cap language framed only as an option; Path B = non-recourse, preserving the current draft structure if the attorney selects it.',
  'Do not choose recourse or non-recourse for the attorney, do not recommend one path as the answer, and do not regenerate or rewrite the note to change the business structure unless the attorney has already selected that structure.',
  'For SUBSTANTIVE/BUSINESS cards, use recommendation and suggested_revision to describe options, attorney decision points, and drafting that would follow each option; never present an unselected business path as the required revision.',
].join('\n');
const jurisdictionDiscipline = [
  'Act as senior co-counsel for a Virginia/Maryland transactional attorney and write attorney-facing feedback, not consumer-facing explanations unless expressly instructed.',
  'Identify the governing jurisdiction when possible; default to Virginia only where appropriate; separate Virginia and Maryland rules; flag jurisdiction uncertainty; avoid general U.S. law where state-specific treatment matters.',
].join('\n');
const sourceAndModeDiscipline = [
  'Apply source hierarchy and source-basis discipline: tie each issue to document text, provided matter context, governing law, or another identified source; do not invent unsupported facts or authorities.',
  'Mode discipline: default to legal-review. If supplied later, respect formatting-only, second-opinion, and sendability-only mode instructions. You MAY consume any provided "Locked Decisions" context (attorney-locked decisions for this document) and must respect it per the Matter-memory awareness rule; do not, however, implement evaluator mode, persistence storage, sendability gates, or cumulative adopt ledgers in this prompt.',
  'No model specialization: do not treat this reviewer as research only, evaluator only, structural only, primary reviewer only, or second-opinion only. Each track has equivalent functional capability.',
].join('\n');
const outputContract = [
  'Return ONLY a JSON array of legacy feedback items so the active parser can persist the result. Do not include text outside the JSON array.',
  'Each item must keep this exact legacy wrapper shape: { "title": "Short issue title (under 80 characters)", "body": "Detailed attorney-facing feedback", "severity": "critical"|"major"|"minor" }.',
  'The item-level "severity" (critical, major, or minor) is REQUIRED on every item and is a DIFFERENT field from the feedback-card severity used inside the body (BLOCKER, SUBSTANTIVE, STRUCTURAL, PRECISION, POLISH). Always include the top-level critical/major/minor severity on each item; never omit it or replace it with a feedback-card tier.',
  'Inside each body string, include both sections labeled NARRATIVE_REVIEWER_MEMO and STRUCTURED_FEEDBACK_CARDS.',
  'NARRATIVE_REVIEWER_MEMO must be an attorney-readable reviewer memo explaining issue, source basis, jurisdiction treatment, recommended action, and attorney decision points.',
  'STRUCTURED_FEEDBACK_CARDS must contain a JSON array compatible with the MR-CAL-1 feedback-card contract using exact field names only.',
  `Feedback-card field names: ${FEEDBACK_CARD_FIELD_NAMES.join(', ')}.`,
  'Feedback-card severity values: BLOCKER, SUBSTANTIVE, STRUCTURAL, PRECISION, POLISH. severity_subtype must be DRAFTING or BUSINESS for SUBSTANTIVE and null otherwise.',
  `Feedback-card critique_type values: ${FEEDBACK_CARD_CRITIQUE_TYPES.join(', ')}.`,
  `Feedback-card disposition_options values: ${FEEDBACK_CARD_DISPOSITIONS.join(', ')}.`,
  'Use reviewer_track as one of GPT, Claude, Grok, Gemini. Do not invent unsupported field names such as priority_level, business_owner, evaluator_notes, or final_decision.',
  'Return [] if there is no feedback.',
].join('\n');
const styleByTrack = {
  GPT: 'Use concise headings and bullets inside the body memo.',
  Claude: 'Use XML-style section labels inside the body memo, while preserving valid JSON string escaping.',
  Grok: 'Use clean numbered markdown and direct do/don\'t rules inside the body memo.',
  Gemini: 'Use structured sections and explicit behavioral constraints inside the body memo.',
};
function buildReviewerSystemPrompt(reviewerKey, track) {
  return [
    `You are the ${track} legal document reviewer (${reviewerKey}).`,
    jurisdictionDiscipline, severityTaxonomy, sevenMissingRules, businessDecisionCalibration,
    sourceAndModeDiscipline, styleByTrack[track], outputContract,
  ].join('\n\n');
}

// ============================================================
// Wrapper normalization (union of openai/anthropic/xai rules @ 6f69c68)
// ============================================================
const KNOWN_ARRAY_WRAPPER_KEYS = ['feedback','suggestions','items','result','data'];
const KNOWN_OUTER_WRAPPER_KEYS = ['review','output','response','result','data'];
const KNOWN_INNER_ARRAY_KEYS = ['feedback','suggestions','items','issues'];
function looksLikeLegacyItem(o) {
  return o && typeof o === 'object' && !Array.isArray(o)
    && typeof o.title === 'string' && typeof o.body === 'string'
    && ['critical','major','minor'].includes(o.severity);
}
function normalizeWrapper(value) {
  if (Array.isArray(value)) return value;
  if (value !== null && typeof value === 'object') {
    const obj = value, keys = Object.keys(obj);
    if (keys.length === 1 && Array.isArray(obj[keys[0]])) return obj[keys[0]];
    for (const k of KNOWN_ARRAY_WRAPPER_KEYS) if (k in obj && Array.isArray(obj[k])) return obj[k];
    const nested = [];
    for (const ok of KNOWN_OUTER_WRAPPER_KEYS) {
      const ov = obj[ok];
      if (ov && typeof ov === 'object' && !Array.isArray(ov)) {
        for (const ik of KNOWN_INNER_ARRAY_KEYS) if (ik in ov && Array.isArray(ov[ik])) nested.push(ov[ik]);
      }
    }
    if (nested.length === 1) return nested[0];
    if (looksLikeLegacyItem(obj)) return [obj];
  }
  return value;
}
function stripFence(text) {
  const t = text.trim();
  const m = t.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/);
  return m && m[1] !== undefined ? m[1].trim() : text;
}

// REVIEWER-PARSE-RELIABILITY-1 — inlined mirrors of src/server/llm/truncationDetect.ts (RPR-1) and
// tolerantJsonParse.ts (RPR-2), so the calibration parser stays honest with production (a repairable
// malformed array is recovered; a signal-less structural truncation is reclassified, not PARSE_FAILURE'd).
function looksLikeTruncatedJson(text) {
  if (typeof text !== 'string') return false;
  const t = text.trim();
  if (t.length === 0) return false;
  const first = t[0];
  if (first !== '[' && first !== '{') return false;
  let depth = 0, inString = false, escaped = false;
  for (let i = 0; i < t.length; i += 1) {
    const c = t[i];
    if (inString) { if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') inString = false; continue; }
    if (c === '"') inString = true; else if (c === '[' || c === '{') depth += 1; else if (c === ']' || c === '}') depth -= 1;
  }
  if (inString) return true;
  const lastChar = t[t.length - 1];
  return depth > 0 && (lastChar === ',' || lastChar === ':');
}
function tryRepairArrayJson(text) {
  if (typeof text !== 'string') return null;
  const t = text.trim();
  if (t[0] !== '[') return null;
  let last = -1;
  for (let i = t.length - 1; i >= 0; i -= 1) { const c = t[i]; if (c !== ' ' && c !== '\t' && c !== '\n' && c !== '\r') { last = i; break; } }
  const candidates = [];
  const closerFixed = last >= 0 && t[last] === '}' ? t.slice(0, last) + ']' + t.slice(last + 1) : null;
  if (closerFixed) candidates.push(closerFixed);
  const commaStripped = t.replace(/,(\s*[\]}]\s*)$/, '$1');
  if (commaStripped !== t) candidates.push(commaStripped);
  if (closerFixed) { const both = closerFixed.replace(/,(\s*[\]}]\s*)$/, '$1'); if (both !== closerFixed) candidates.push(both); }
  for (const cand of candidates) { try { return { value: JSON.parse(cand) }; } catch { /* next */ } }
  return null;
}

// ============================================================
// Provider calls — VERBATIM REST shapes @ 6f69c68
// Each returns: { httpOk, rawText, canonical|null, errorClass, errorMessage, finishReason, tokensP, tokensC }
//   canonical = JSON string of the normalized array, or null if not array-normalizable.
// ============================================================
function splitModel(modelString) {
  const i = modelString.indexOf(':');
  return { provider: modelString.slice(0, i), modelId: modelString.slice(i + 1) };
}
function toResult({ httpOk = true, rawText = '', errorClass = null, errorMessage = null, finishReason = null, tokensP = null, tokensC = null }) {
  let canonical = null;
  let effErrorClass = errorClass;
  let effErrorMessage = errorMessage;
  if (httpOk && rawText) {
    const stripped = stripFence(rawText);
    let parsed;
    let ok = true;
    try {
      parsed = JSON.parse(stripped);
    } catch {
      ok = false;
      // RPR-1: a signal-less structural truncation is an api_error (truncation), not a PARSE_FAILURE.
      if (!effErrorClass && looksLikeTruncatedJson(stripped)) {
        effErrorClass = 'api_error';
        effErrorMessage = effErrorMessage ?? 'structural truncation (RPR-1)';
      } else {
        // RPR-2: minimal array-gated structural repair.
        const repair = tryRepairArrayJson(stripped);
        if (repair) { parsed = repair.value; ok = true; }
      }
    }
    if (ok) {
      const norm = normalizeWrapper(parsed);
      if (Array.isArray(norm)) canonical = JSON.stringify(norm);
    }
  }
  return { httpOk, rawText, canonical, errorClass: effErrorClass, errorMessage: effErrorMessage, finishReason, tokensP, tokensC };
}

async function callOpenAiLike(url, apiKey, modelId, system, user) {
  const usesCompletionTokens = /^(gpt-5|o1|o3|o4)/.test(modelId);
  const body = {
    model: modelId,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    ...(usesCompletionTokens ? { max_completion_tokens: REVIEWER_MAX_TOKENS } : { max_tokens: REVIEWER_MAX_TOKENS, temperature: 0.3 }),
    response_format: { type: 'json_object' },
  };
  let resp;
  try {
    resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(CALL_TIMEOUT_MS) });
  } catch (err) {
    const n = err && err.name;
    if (n === 'AbortError' || n === 'TimeoutError') return toResult({ httpOk: false, errorClass: 'timeout', errorMessage: 'timeout/abort' });
    return toResult({ httpOk: false, errorClass: 'api_error', errorMessage: `fetch failed: ${String(err)}` });
  }
  if (!resp.ok) { const t = await resp.text().catch(() => ''); return toResult({ httpOk: false, errorClass: 'api_error', errorMessage: `API ${resp.status}: ${t.slice(0, 250)}` }); }
  const data = await resp.json();
  const rawText = data.choices?.[0]?.message?.content ?? '';
  const fr = data.choices?.[0]?.finish_reason;
  if (fr === 'length') return toResult({ httpOk: false, errorClass: 'api_error', errorMessage: 'finish_reason length', rawText, finishReason: fr });
  if (!rawText) return toResult({ httpOk: false, errorClass: 'api_error', errorMessage: 'empty content', finishReason: fr });
  return toResult({ httpOk: true, rawText, finishReason: fr, tokensP: data.usage?.prompt_tokens, tokensC: data.usage?.completion_tokens });
}

async function callOpenAi(modelId, system, user) {
  const apiKey = process.env['OPENAI_API_KEY'];
  if (!apiKey) return toResult({ httpOk: false, errorClass: 'api_error', errorMessage: 'OPENAI_API_KEY not set' });
  return callOpenAiLike('https://api.openai.com/v1/chat/completions', apiKey, modelId, system, user);
}
async function callXai(modelId, system, user) {
  const apiKey = process.env['XAI_API_KEY'];
  if (!apiKey) return toResult({ httpOk: false, errorClass: 'api_error', errorMessage: 'XAI_API_KEY not set' });
  return callOpenAiLike('https://api.x.ai/v1/chat/completions', apiKey, modelId, system, user);
}
async function callAnthropic(modelId, system, user) {
  const apiKey = process.env['ANTHROPIC_API_KEY'];
  if (!apiKey) return toResult({ httpOk: false, errorClass: 'api_error', errorMessage: 'ANTHROPIC_API_KEY not set' });
  const effSystem = `${system}\n\nRespond ONLY with valid JSON matching the required schema. Do not include any text outside the JSON object.`;
  const body = { model: modelId, max_tokens: REVIEWER_MAX_TOKENS, system: effSystem, messages: [{ role: 'user', content: user }] };
  let resp;
  try {
    resp = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }, body: JSON.stringify(body), signal: AbortSignal.timeout(CALL_TIMEOUT_MS) });
  } catch (err) {
    const n = err && err.name;
    if (n === 'AbortError' || n === 'TimeoutError') return toResult({ httpOk: false, errorClass: 'timeout', errorMessage: 'timeout/abort' });
    return toResult({ httpOk: false, errorClass: 'api_error', errorMessage: `fetch failed: ${String(err)}` });
  }
  if (!resp.ok) { const t = await resp.text().catch(() => ''); return toResult({ httpOk: false, errorClass: 'api_error', errorMessage: `API ${resp.status}: ${t.slice(0, 250)}` }); }
  const data = await resp.json();
  // CLAUDE-LANE-MODERNIZATION-1: text is NOT reliably content[0] — adaptive-thinking Claude models
  // (e.g. claude-sonnet-5, adaptive-ON by default when `thinking` is omitted) return a leading
  // `thinking` block, so content[0].text is undefined (empty content -> api_error on every review).
  // Join every text-type block instead (matches the production adapter's extractAnthropicText).
  const rawText = Array.isArray(data.content)
    ? data.content.filter((b) => b && b.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('')
    : '';
  const fr = data.stop_reason;
  if (!rawText) return toResult({ httpOk: false, errorClass: 'api_error', errorMessage: 'empty content', finishReason: fr });
  return toResult({ httpOk: true, rawText, finishReason: fr, tokensP: data.usage?.input_tokens, tokensC: data.usage?.output_tokens });
}
async function callGoogle(modelId, system, user) {
  const apiKey = process.env['GOOGLE_API_KEY'];
  if (!apiKey) return toResult({ httpOk: false, errorClass: 'api_error', errorMessage: 'GOOGLE_API_KEY not set' });
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`;
  const body = {
    contents: [{ role: 'user', parts: [{ text: user }] }],
    systemInstruction: { parts: [{ text: system }] },
    generationConfig: { maxOutputTokens: REVIEWER_MAX_TOKENS, temperature: 0.3, responseMimeType: 'application/json' },
    safetySettings: [
      { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
    ],
  };
  let resp;
  try {
    resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(CALL_TIMEOUT_MS) });
  } catch (err) {
    const n = err && err.name;
    if (n === 'AbortError' || n === 'TimeoutError') return toResult({ httpOk: false, errorClass: 'timeout', errorMessage: 'timeout/abort' });
    return toResult({ httpOk: false, errorClass: 'api_error', errorMessage: `fetch failed: ${String(err)}` });
  }
  if (!resp.ok) { const t = await resp.text().catch(() => ''); return toResult({ httpOk: false, errorClass: 'api_error', errorMessage: `API ${resp.status}: ${t.slice(0, 250)}` }); }
  const data = await resp.json();
  const cand = data.candidates?.[0];
  const rawText = cand?.content?.parts?.[0]?.text ?? '';
  const fr = cand?.finishReason;
  if (!rawText) return toResult({ httpOk: false, errorClass: 'api_error', errorMessage: `no candidate text (finishReason ${fr ?? 'unknown'})`, finishReason: fr });
  return toResult({ httpOk: true, rawText, finishReason: fr, tokensP: data.usageMetadata?.promptTokenCount, tokensC: data.usageMetadata?.candidatesTokenCount });
}
async function resolveAndCall(modelString, system, user) {
  const { provider, modelId } = splitModel(modelString);
  if (provider === 'openai') return callOpenAi(modelId, system, user);
  if (provider === 'anthropic') return callAnthropic(modelId, system, user);
  if (provider === 'google') return callGoogle(modelId, system, user);
  if (provider === 'xai') return callXai(modelId, system, user);
  throw new Error(`Unknown provider ${provider}`);
}

// ============================================================
// Scoring — VERBATIM port of mr_cal_2d_calibration_scoring.test.ts @ 6f69c68
// ============================================================
function parseFeedbackOutput(raw) {
  const stripped = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let parsed;
  try { parsed = JSON.parse(stripped); } catch (err) { throw new Error(`REVIEWER_OUTPUT_MALFORMED: ${String(err)}`); }
  if (!Array.isArray(parsed)) throw new Error('REVIEWER_OUTPUT_MALFORMED: not array');
  for (const item of parsed) {
    if (!item || typeof item !== 'object' || typeof item.title !== 'string' || item.title.length < 1
      || typeof item.body !== 'string' || item.body.length < 1 || !['critical','major','minor'].includes(item.severity)) {
      throw new Error('REVIEWER_OUTPUT_MALFORMED: schema');
    }
  }
  return parsed.map((i) => ({ title: i.title, body: i.body, severity: i.severity }));
}
function isFeedbackCard(v) { return typeof v === 'object' && v !== null && !Array.isArray(v); }
function parseEmbeddedCards(body) {
  const mi = body.indexOf('STRUCTURED_FEEDBACK_CARDS');
  if (mi < 0) return [];
  const after = body.slice(mi + 'STRUCTURED_FEEDBACK_CARDS'.length);
  const start = after.indexOf('[');
  if (start < 0) return [];
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < after.length; i += 1) {
    const ch = after[i];
    if (esc) { esc = false; continue; }
    if (ch === '\\') { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === '[') depth += 1;
    if (ch === ']') { depth -= 1; if (depth === 0) { try { const p = JSON.parse(after.slice(start, i + 1)); return Array.isArray(p) ? p.filter(isFeedbackCard) : []; } catch { return []; } } }
  }
  return [];
}
function parseLegacyCalibrationOutput(raw) {
  try {
    const items = parseFeedbackOutput(raw);
    const cards = items.flatMap((i) => parseEmbeddedCards(i.body));
    return { text: items.map((i) => `${i.title}\n${i.body}\n${i.severity}`).join('\n---\n'), cards, legacyCount: items.length };
  } catch { return null; }
}
function normalizedText(o) { return o.text.toLowerCase().replace(/[‐-―]/g, '-'); }
function textContainsAny(t, terms) { return terms.some((x) => t.includes(x.toLowerCase())); }
function fieldContainsAny(cards, field, terms) { return cards.some((c) => { const v = c[field]; return typeof v === 'string' && textContainsAny(v.toLowerCase(), terms); }); }
function hasAttorneyDecision(o) {
  const t = normalizedText(o);
  return o.cards.some((c) => c.requires_attorney_decision === true) || t.includes('requires_attorney_decision') || t.includes('attorney decision') || t.includes('attorney/client selection') || t.includes('client selection');
}
function hasSeverity(o, sev) { const t = normalizedText(o).toUpperCase(); return o.cards.some((c) => c.severity === sev) || t.includes(sev); }
function hasSubtypeEquivalent(o, eq) {
  const t = normalizedText(o);
  return o.cards.some((c) => { const s = c.severity_subtype?.toLowerCase(); const cr = c.critique_type?.toLowerCase(); return eq.some((x) => s === x || cr === x || s?.includes(x) || cr?.includes(x)); })
    || eq.some((x) => t.includes(x.replace(/_/g, ' ')) || t.includes(x.replace(/_/g, '-')));
}
function modelChoosesBusinessPath(o) {
  const t = normalizedText(o);
  const protectedCtx = /do not (choose|select|recommend)|cannot (choose|select|recommend)|attorney (selects|chooses|must select|should select)|client (selects|chooses|must select|should select)|if (the )?attorney selects|if (the )?client selects/.test(t);
  const sel = /\b(i|we|reviewer|draft|note)\s+(recommend|recommends|choose|chooses|select|selects|should use|should be)\s+(path\s+)?(a|b|recourse|non-recourse)\b/.test(t)
    || /\b(recommend|choose|select)\s+(path\s+)?(a|b)\s+as\s+the\s+(answer|structure|revision)\b/.test(t)
    || /\b(the\s+note\s+should\s+be\s+(recourse|non-recourse))\b/.test(t);
  return sel && !protectedCtx;
}
function classifyProviderOutcome(outcome) {
  if (outcome.returnedSuccessfully) return null;
  const combined = `${outcome.errorClass ?? ''} ${outcome.errorMessage ?? ''} ${outcome.rawOutput}`.toLowerCase();
  if (combined.includes('timeout') || combined.includes('abort')) return { status: 'NOT_RUN', reason: 'Provider timeout/abort isolated from prompt-target failure.', providerInstability: 'timeout' };
  if (outcome.rawOutput.trim().length === 0 || combined.includes('empty')) return { status: 'NOT_RUN', reason: 'Empty provider response isolated from prompt-target failure.', providerInstability: 'empty provider response' };
  return { status: 'NOT_RUN', reason: 'Provider call returned no usable calibration output.', providerInstability: 'insufficient evidence' };
}
function classifyParseFailure(raw) { return parseLegacyCalibrationOutput(raw) === null ? { status: 'PARSE_FAILURE', reason: 'Legacy wrapper parsing failed before substantive calibration scoring.' } : null; }
function classifyP8T10(o) {
  const t = normalizedText(o);
  const both = t.includes('recourse') && t.includes('non-recourse');
  const ad = hasAttorneyDecision(o);
  const chooses = modelChoosesBusinessPath(o);
  const sevOk = hasSeverity(o, 'SUBSTANTIVE');
  const bizEq = fieldContainsAny(o.cards, 'severity_subtype', ['BUSINESS']) || fieldContainsAny(o.cards, 'critique_type', ['legal_sufficiency', 'reviewer_role_overreach']);
  const distinguishes = t.includes('business decision') || t.includes('business-decision separation') || t.includes('business choice') || t.includes('risk-allocation decision') || t.includes('not a drafting defect') || t.includes('not merely a drafting issue');
  if (chooses) return { status: 'FAIL', reason: 'Reviewer selected or recommended an unselected recourse/non-recourse business path.' };
  if (both && ad && sevOk && bizEq && distinguishes) return { status: 'PASS', reason: 'Both paths surfaced, attorney selection required, business choice separated from drafting.' };
  if (both && ad && !chooses) return { status: 'PARTIAL', reason: 'Core attorney-choice behavior present, taxonomy/field precision incomplete.' };
  return { status: 'FAIL', reason: 'Missed the core recourse/non-recourse attorney-decision target behavior.' };
}
function classifyP8T1(o) {
  const t = normalizedText(o);
  const targets = textContainsAny(t, ['signature block', 'missing signature', 'notary', 'witness', 'execution blank', 'date blank', 'printed name']);
  const suppressed = o.cards.some((c) => c.routine_blank_flag === true && c.suppress_by_default === true);
  if (o.legacyCount === 0) return { status: 'PASS', reason: 'Empty valid output correctly suppresses routine execution blanks.' };
  if (!targets) return { status: 'PASS', reason: 'Feedback does not target routine execution blanks.' };
  if (suppressed) return { status: 'PARTIAL', reason: 'Routine blank identified but suppressed by default.' };
  return { status: 'FAIL', reason: 'Routine execution blank surfaced as unsuppressed feedback.' };
}
function classifyP8T6(o) {
  const t = normalizedText(o);
  const flags = textContainsAny(t, ['over-disclosure', 'overdisclosure', 'counterparty', 'audience', 'overstatement']);
  const preserves = t.includes('50/50') && !textContainsAny(t, ['withdraw the 50/50', 'change the 50/50', 'do not offer 50/50', 'seller should not split']);
  const subDraft = hasSeverity(o, 'SUBSTANTIVE') && hasSubtypeEquivalent(o, ['DRAFTING', 'drafting_precision', 'audience_shift_recommendation', 'overstatement']);
  if (flags && preserves && subDraft) return { status: 'PASS', reason: 'Flags counterparty-facing over-disclosure while preserving the selected 50/50 offer.' };
  if (flags && preserves) return { status: 'PARTIAL', reason: 'Audience-risk behavior present, taxonomy precision incomplete.' };
  return { status: 'FAIL', reason: 'Fails to preserve the selected business offer or misses the audience-risk issue.' };
}
function classifyP8T7(o) {
  const t = normalizedText(o);
  const mismatch = t.includes('california') && t.includes('virginia') && t.includes('governing law');
  const escalates = hasSeverity(o, 'BLOCKER') || t.includes('sendability') || t.includes('do not send') || t.includes('preventing send');
  const legalEq = hasSubtypeEquivalent(o, ['legal_sufficiency', 'cross_document_consistency']) || t.includes('legal sufficiency');
  if (mismatch && escalates && hasAttorneyDecision(o) && legalEq) return { status: 'PASS', reason: 'Governing-law mismatch escalated as blocker/legal-sufficiency with attorney decision before send.' };
  if (mismatch && hasAttorneyDecision(o)) return { status: 'PARTIAL', reason: 'Mismatch and attorney decision present, blocker/sendability taxonomy incomplete.' };
  return { status: 'FAIL', reason: 'Misses the governing-law sendability blocker target behavior.' };
}
function classifyScenario(scenarioId, outcome) {
  const pc = classifyProviderOutcome(outcome); if (pc) return pc;
  const pf = classifyParseFailure(outcome.rawOutput); if (pf) return pf;
  const parsed = parseLegacyCalibrationOutput(outcome.rawOutput);
  if (parsed === null) return { status: 'PARSE_FAILURE', reason: 'Legacy wrapper parsing failed before substantive calibration scoring.' };
  if (scenarioId === 'P8-T10') return classifyP8T10(parsed);
  if (scenarioId === 'P8-T1') return classifyP8T1(parsed);
  if (scenarioId === 'P8-T6') return classifyP8T6(parsed);
  return classifyP8T7(parsed);
}

// ============================================================
// Fixtures (re-derived baseline; NOT the 20260528 originals)
// ============================================================
const FIXTURES = {
  'P8-T1': {
    label: 'Execution-blank suppression (pre-execution VA deed; only routine signature/notary/date blanks)',
    userPrompt: [
      '## Matter Context',
      'A routine pre-execution Virginia general warranty deed. All substantive terms are settled and complete: grantor, grantee, full legal description, and consideration are all present and correct. The only blanks are the ordinary execution blanks (signature, date, notary acknowledgment) that will be filled in at the signing table. The attorney is reviewing a clean pre-execution draft.',
      '',
      '## Draft to Review (Virginia General Warranty Deed — pre-execution)',
      'THIS DEED, made this ____ day of __________, 2026, between JANE A. GRANTOR (Grantor) and JOHN B. GRANTEE (Grantee).',
      'WITNESSETH: For TEN DOLLARS ($10.00) and other good and valuable consideration, Grantor grants with general warranty unto Grantee the following described real property in Fairfax County, Virginia: Lot 14, Block C, Section 2, BRIARWOOD ESTATES, as recorded in Deed Book 4821, Page 119.',
      'WITNESS the following signature and seal:',
      '_______________________ (SEAL)   JANE A. GRANTOR',
      'COMMONWEALTH OF VIRGINIA, COUNTY OF ____________, to-wit:',
      'The foregoing instrument was acknowledged before me this ____ day of __________, 2026, by JANE A. GRANTOR.',
      '_______________________  Notary Public   My commission expires: __________',
      '',
      'Review this draft and return your feedback now.',
    ].join('\n'),
  },
  'P8-T6': {
    label: 'Counterparty over-disclosure (settlement letter to opposing counsel; preserve the selected 50/50 cost-split offer)',
    userPrompt: [
      '## Matter Context',
      'This is an outbound settlement letter addressed to OPPOSING COUNSEL (the counterparty). The attorney HAS DECIDED, as a settled business decision, to offer a 50/50 split of remediation costs and does NOT want that offer changed. The concern for review is audience: the draft is counterparty-facing and may over-disclose the client\'s internal analysis and bottom line.',
      '',
      '## Draft to Review (Settlement Letter to Opposing Counsel)',
      'Dear Counsel: My client is prepared to offer a 50/50 split of the remediation costs to resolve this matter.',
      'For your information, my client\'s internal counsel has concluded that our litigation position on causation is weak and that we would likely lose at trial, so my client is highly motivated to settle and authorized me to go as high as a 70/30 split in the client\'s disfavor if necessary. Our true walk-away number is a 60/40 split.',
      'We believe the 50/50 split is fair. Please advise.',
      '',
      'Review this counterparty-facing draft and return your feedback now.',
    ].join('\n'),
  },
  'P8-T7': {
    label: 'Governing-law / sendability blocker (VA PSA with a California governing-law clause)',
    userPrompt: [
      '## Matter Context',
      'Client: a Virginia seller. Property: a single-family residence located in Fairfax County, Virginia. Both parties reside in Virginia and the transaction closes in Virginia. The attorney is licensed in Virginia and Maryland. No party has any connection to California. The attorney has NOT made any deliberate choice to apply California law; this draft was assembled from a mixed template.',
      '',
      '## Draft to Review (Virginia Residential Purchase and Sale Agreement — pre-execution)',
      'Section 1. Property. The Seller agrees to sell the residence at 123 Maple Court, Fairfax County, Virginia.',
      'Section 2. Purchase Price. $750,000, payable at settlement.',
      'Section 14. Governing Law. This Agreement shall be governed by and construed in accordance with the laws of the State of California, without regard to its conflict-of-laws principles. Any dispute shall be resolved in the state courts located in Los Angeles County, California.',
      'Section 20. Signatures. _______________________ (Seller)   Date: __________   _______________________ (Buyer)   Date: __________',
      '',
      'Review this draft and return your feedback now.',
    ].join('\n'),
  },
  'P8-T10': {
    label: 'Business-decision separation (seller-financing note drafted non-recourse; structure NOT selected by attorney)',
    userPrompt: [
      '## Matter Context',
      'A seller-financing promissory note for a commercial property sale. IMPORTANT: the attorney has NOT yet selected the risk-allocation structure (recourse vs. non-recourse). The current draft happens to be written as non-recourse, but that is a template default, not a decision. The client and attorney have not chosen between Path A (recourse, with a possible senior-debt cap) and Path B (non-recourse seller financing).',
      '',
      '## Draft to Review (Seller-Financing Promissory Note)',
      'Section 3. Recourse. This Note is NON-RECOURSE to the Maker. The Holder\'s sole remedy upon default shall be against the collateral, and the Holder shall have no right to proceed against the Maker personally for any deficiency.',
      'Section 4. Principal and Interest. $2,000,000 principal at 7.5% per annum, amortized over 20 years with a balloon at year 7.',
      '',
      'Review this draft and return your feedback now.',
    ].join('\n'),
  },
};

// ============================================================
// CAL-1B: per-lane reviewer model IDs are SOURCED FROM src/server/llm/config.ts (the single source of truth) at
// runtime — NOT hardcoded — so the harness always tests the currently pinned lanes and cannot drift after a model
// swap (G.3 corollary). The harness is standalone Node ESM (no TS toolchain), so it READS + PARSES config.ts as
// text: the REVIEWER_MODELS literals (full) and the LITE_REVIEWER_MODELS resolveLiteModel('ENV','default') lite
// lanes (env override honored EXACTLY as config does). It fails LOUDLY if any of the 8 lanes cannot be parsed —
// a config format change must never silently test an undefined model. Only the MODEL IDs are sourced here; the
// display track labels (GPT/Claude/Gemini/Grok) and all other harness logic/scoring/prompt/parser are unchanged.
// ============================================================
function loadConfigModels() {
  const configPath = join(HERE, '..', '..', 'src', 'server', 'llm', 'config.ts');
  const src = readFileSync(configPath, 'utf8');
  const out = {};

  const fullBlock = src.match(/export const REVIEWER_MODELS\s*=\s*\{([\s\S]*?)\}\s*as const;/);
  if (!fullBlock) throw new Error('CAL-1B: could not locate REVIEWER_MODELS in config.ts (format changed?)');
  for (const key of ['gpt', 'claude', 'gemini', 'grok']) {
    const m = fullBlock[1].match(new RegExp(`\\b${key}\\s*:\\s*'([^']+)'`));
    if (!m) throw new Error(`CAL-1B: could not parse full lane "${key}" from REVIEWER_MODELS`);
    out[key] = m[1];
  }

  const liteBlock = src.match(/export const LITE_REVIEWER_MODELS\s*=\s*\{([\s\S]*?)\}\s*as const;/);
  if (!liteBlock) throw new Error('CAL-1B: could not locate LITE_REVIEWER_MODELS in config.ts (format changed?)');
  for (const key of ['gpt_lite', 'claude_lite', 'gemini_lite', 'grok_lite']) {
    const m = liteBlock[1].match(new RegExp(`\\b${key}\\s*:\\s*resolveLiteModel\\('([^']+)',\\s*'([^']+)'\\)`));
    if (!m) throw new Error(`CAL-1B: could not parse lite lane "${key}" from LITE_REVIEWER_MODELS`);
    const envVar = m[1];
    const def = m[2];
    const override = process.env[envVar];
    out[key] = override && override.trim().length > 0 ? override.trim() : def; // mirror config's resolveLiteModel
  }
  return out;
}

const CONFIG_MODELS = loadConfigModels();
const TRACK_LABEL = { gpt: 'GPT', claude: 'Claude', gemini: 'Gemini', grok: 'Grok', gpt_lite: 'GPT', claude_lite: 'Claude', gemini_lite: 'Gemini', grok_lite: 'Grok' };
const TRACKS = Object.fromEntries(
  Object.keys(TRACK_LABEL).map((key) => [key, { modelString: CONFIG_MODELS[key], track: TRACK_LABEL[key] }]),
);
const SCENARIOS = ['P8-T1', 'P8-T6', 'P8-T7', 'P8-T10'];
const FULL_TRACKS = ['gpt', 'claude', 'gemini', 'grok'];

// ============================================================
// Grid definition
// ============================================================
function buildGrid(mode) {
  const cells = [];
  if (mode === 'full') {
    // Block A: scenarios x full tracks, N=3
    for (const s of SCENARIOS) for (const rk of FULL_TRACKS) cells.push({ block: 'A', scenarioId: s, reviewerKey: rk, n: 3 });
    // Block B: GPT-Lite + Claude-Lite x scenarios, N=1
    for (const s of SCENARIOS) for (const rk of ['gpt_lite', 'claude_lite']) cells.push({ block: 'B', scenarioId: s, reviewerKey: rk, n: 1 });
    // Block C: lite smoke
    cells.push({ block: 'C', scenarioId: 'P8-T7', reviewerKey: 'gemini_lite', n: 1 });
    cells.push({ block: 'C', scenarioId: 'P8-T10', reviewerKey: 'grok_lite', n: 1 });
  } else {
    // smoke: prove all 4 adapters (P8-T7 across full tracks N=1) + each remaining scorer + classify-then-flag
    for (const rk of FULL_TRACKS) cells.push({ block: 'smoke', scenarioId: 'P8-T7', reviewerKey: rk, n: 1 });
    cells.push({ block: 'smoke', scenarioId: 'P8-T10', reviewerKey: 'gpt', n: 1 });
    cells.push({ block: 'smoke', scenarioId: 'P8-T1', reviewerKey: 'gpt_lite', n: 1 }); // GPT-T1 classify-then-flag
    cells.push({ block: 'smoke', scenarioId: 'P8-T6', reviewerKey: 'gpt_lite', n: 1 }); // GPT-T6 classify-then-flag
  }
  return cells;
}

// CLAUDE-LANE-MODERNIZATION-1: optional per-lane filter so a G.3 model-swap rerun can exercise ONLY the
// changed lanes (e.g. --lanes=claude,claude_lite) instead of the whole grid. Accepts `--lanes=a,b` or
// `--lanes a,b`. Returns null when absent (unfiltered). Unknown lane names are rejected in main().
function parseLaneFilter(argv) {
  let raw = null;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith('--lanes=')) { raw = a.slice('--lanes='.length); break; }
    if (a === '--lanes') { raw = argv[i + 1] ?? ''; break; }
  }
  if (raw === null) return null;
  const lanes = raw.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
  return lanes.length ? lanes : null;
}

// classify-then-tag-and-flag (CAL-7B-PLAN revision 2)
function acceptedRiskEval(scenarioId, reviewerKey, status) {
  const isGpt = reviewerKey === 'gpt' || reviewerKey === 'gpt_lite';
  if (!isGpt) return { applies: false };
  if (scenarioId === 'P8-T1') {
    const posture = 'PARSE_FAILURE';
    if (status === posture) return { applies: true, tag: 'ACCEPTED_RISK', flag: false, note: 'Matches accepted GPT-P8-T1 parse-class posture.' };
    return { applies: true, tag: status, flag: true, note: `DEVIATION from accepted GPT-P8-T1 posture (expected ${posture}, got ${status}).${status === 'PASS' ? ' GPT may have IMPROVED.' : ''}` };
  }
  if (scenarioId === 'P8-T6') {
    const posture = 'FAIL';
    if (status === posture) return { applies: true, tag: 'ACCEPTED_RISK', flag: false, note: 'Matches accepted GPT-P8-T6 substance-failure posture.' };
    return { applies: true, tag: status, flag: true, note: `DEVIATION from accepted GPT-P8-T6 posture (expected ${posture}, got ${status}).${status === 'PASS' ? ' GPT may have IMPROVED.' : ''}` };
  }
  return { applies: false };
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

async function runOneCall({ scenarioId, reviewerKey }, runDir, runIndex) {
  const { modelString, track } = TRACKS[reviewerKey];
  const system = buildReviewerSystemPrompt(reviewerKey, track);
  const user = FIXTURES[scenarioId].userPrompt;
  const t0 = Date.now();
  const res = await resolveAndCall(modelString, system, user);
  const elapsedMs = Date.now() - t0;
  const outcome = {
    returnedSuccessfully: !!res.httpOk && !!res.rawText,
    rawOutput: res.httpOk ? (res.canonical ?? res.rawText) : (res.rawText ?? ''),
    errorClass: res.errorClass,
    errorMessage: res.errorMessage,
  };
  const classification = classifyScenario(scenarioId, outcome);
  // preserve artifacts (local; gitignored). No credentials present.
  const base = `${scenarioId}__${reviewerKey}__run${runIndex}`;
  writeFileSync(join(runDir, `${base}.rawOutput.txt`), res.rawText ?? '');
  writeFileSync(join(runDir, `${base}.normalized.json`), outcome.rawOutput ?? '');
  return {
    scenarioId, reviewerKey, track, modelString, runIndex,
    elapsedMs, httpOk: res.httpOk, finishReason: res.finishReason,
    tokensP: res.tokensP, tokensC: res.tokensC, errorClass: res.errorClass, errorMessage: res.errorMessage,
    status: classification.status, reason: classification.reason,
    artifactCaptured: 'YES (local harness file)',
  };
}

function summarizeCell(cell, runs) {
  const statuses = runs.map((r) => r.status);
  const allEqual = statuses.every((s) => s === statuses[0]);
  const counts = {};
  for (const s of statuses) counts[s] = (counts[s] ?? 0) + 1;
  const majority = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  const cellStatus = cell.n > 1 ? (allEqual ? statuses[0] : 'unstable') : statuses[0];
  // accepted-risk evaluated against the cell verdict (majority for N>1, single for N=1)
  const evalStatus = cell.n > 1 ? majority : statuses[0];
  const ar = acceptedRiskEval(cell.scenarioId, cell.reviewerKey, evalStatus);
  return { ...cell, statuses, counts, majority, cellStatus, acceptedRisk: ar, runs };
}

async function main() {
  const mode = process.argv.includes('--full') ? 'full' : 'smoke';
  const laneFilter = parseLaneFilter(process.argv);
  const runId = isoStamp();
  const runDir = join(HERE, 'runs', runId);
  mkdirSync(runDir, { recursive: true });
  let grid = buildGrid(mode);
  if (laneFilter) {
    const known = new Set(Object.keys(TRACK_LABEL));
    const unknown = laneFilter.filter((l) => !known.has(l));
    if (unknown.length) {
      console.error(`ABORT: --lanes names unknown lane(s): ${unknown.join(', ')}. Valid: ${[...known].join(', ')}`);
      process.exit(2);
    }
    const want = new Set(laneFilter);
    grid = grid.filter((c) => want.has(c.reviewerKey));
    if (grid.length === 0) {
      console.error(`ABORT: --lanes=${laneFilter.join(',')} matched 0 cells in mode=${mode} (nothing to run).`);
      process.exit(2);
    }
  }

  // run-cap guard
  const totalCalls = grid.reduce((a, c) => a + c.n, 0);
  console.log(`[CAL-7B harness] mode=${mode}${laneFilter ? ` lanes=${laneFilter.join(',')}` : ''} runId=${runId} cells=${grid.length} calls=${totalCalls} (cap ${RUN_CAP}) snapshot=${SNAPSHOT_COMMIT}`);
  // CAL-1B: report the EXACT model list sourced from config.ts (dispatch step 2), so the run records which
  // currently-pinned lanes were tested (no hardcoded drift).
  console.log('[CAL-7B harness] lane models (from src/server/llm/config.ts): ' +
    Object.keys(TRACK_LABEL).map((k) => `${k}=${TRACKS[k].modelString}`).join('  '));
  if (totalCalls > RUN_CAP) { console.error(`ABORT: ${totalCalls} calls exceeds run cap ${RUN_CAP}. Narrow the grid or raise the cap deliberately.`); process.exit(2); }

  // Flatten cells into individual calls for the concurrency pool.
  const callList = [];
  for (const cell of grid) for (let r = 0; r < cell.n; r += 1) callList.push({ cell, runIndex: r });

  const callResults = await runWithConcurrency(callList, CONCURRENCY, async ({ cell, runIndex }) => {
    const r = await runOneCall(cell, runDir, runIndex);
    console.log(`  ${cell.scenarioId} x ${cell.reviewerKey} run${runIndex}: ${r.status} (${(r.elapsedMs / 1000).toFixed(0)}s)${r.errorClass ? ' [' + r.errorClass + ']' : ''}`);
    return { cell, r };
  });

  // group runs back by cell
  const cellSummaries = grid.map((cell) => {
    const runs = callResults.filter((x) => x.cell === cell).map((x) => x.r);
    return summarizeCell(cell, runs);
  });

  const summary = {
    engagement: 'CAL-7B-HARNESS', mode, runId, snapshotCommit: SNAPSHOT_COMMIT,
    // CAL-1B: the exact per-lane models sourced from config.ts for this run (single source of truth; no drift).
    laneModels: Object.fromEntries(Object.keys(TRACK_LABEL).map((k) => [k, TRACKS[k].modelString])),
    fixtureProvenance: 're-derived baseline (NOT 20260528T122851Z originals)',
    cells: cellSummaries.map((c) => ({
      block: c.block, scenarioId: c.scenarioId, reviewerKey: c.reviewerKey, track: c.runs[0]?.track,
      modelString: c.runs[0]?.modelString, n: c.n, cellStatus: c.cellStatus, statuses: c.statuses, majority: c.majority,
      acceptedRisk: c.acceptedRisk?.applies ? c.acceptedRisk : undefined,
      flagged: c.acceptedRisk?.applies ? !!c.acceptedRisk.flag : false,
      avgElapsedSec: Math.round(c.runs.reduce((a, r) => a + r.elapsedMs, 0) / c.runs.length / 1000),
      artifactCaptured: 'YES (local harness files)',
      providerOutputInCloseout: 'YES (sanitized summary; raw local-only)',
    })),
  };
  writeFileSync(join(runDir, 'grid.summary.json'), JSON.stringify(summary, null, 2));

  console.log('\n=== CELL SUMMARY ===');
  for (const c of summary.cells) {
    const ar = c.acceptedRisk ? ` | accepted-risk:${c.acceptedRisk.tag}${c.flagged ? ' **FLAG**' : ''}` : '';
    console.log(`[${c.block}] ${c.scenarioId} x ${c.reviewerKey} (${c.modelString}) N=${c.n} -> ${c.cellStatus} {${c.statuses.join(',')}}${ar}`);
  }
  const flags = summary.cells.filter((c) => c.flagged);
  if (flags.length) { console.log('\n*** FLAGS (accepted-risk deviations, incl. improvements) ***'); for (const f of flags) console.log(`  ${f.scenarioId} x ${f.reviewerKey}: ${f.acceptedRisk.note}`); }
  console.log(`\nartifacts: tools/calibration/runs/${runId}/`);
}

main().catch((e) => { console.error('HARNESS ERROR:', e); process.exit(1); });
