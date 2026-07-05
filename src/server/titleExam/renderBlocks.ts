/**
 * renderBlocks.ts — TITLE-EXAM-1 (T6), NC-3e structural render-blocks for client/underwriter-facing output.
 *
 * A BLOCK, not a label (NC-3e): forbidden assurances ("clear/marketable title", "nothing in the land
 * records", "free and clear") and UNVERIFIED citations are structurally barred from client/underwriter-facing
 * output. Fail-closed (the deed checkAnnotationLeak discipline): any failure blocks the render and returns to
 * the attorney. Drafts-only annotation markers ([[ ]] / NOTE: / TODO) must never reach a client artifact
 * either. PURE + deterministic; no model judgment. Flag-dark by construction.
 */

export interface RenderBlockResult {
  ok: boolean;
  failures: string[];
}

// NC-3e forbidden assurances — the absolute/guarantee phrasings a title communication must never make. This
// guard runs ONLY on client/underwriter-facing output, where these read as promises; over-blocking is the
// safe direction (the attorney rephrases to a requirement/exception, or moves it to internal-only).
const FORBIDDEN_ASSURANCES: ReadonlyArray<{ label: string; re: RegExp }> = [
  { label: '"clear title" assurance', re: /\bclear\s+title\b/i },
  { label: '"clear and marketable" / "marketable and clear" assurance', re: /\b(clear\s+and\s+marketable|marketable\s+and\s+clear)\b/i },
  { label: '"marketable title" assurance', re: /\bmarketable\s+title\b/i },
  { label: '"nothing in the land records" assurance', re: /\bnothing\s+(is\s+)?(in|of\s+record\s+in)\s+the\s+land\s+records\b/i },
  { label: '"free and clear" assurance', re: /\bfree\s+and\s+clear\b/i },
  { label: 'absolute "no liens/encumbrances/defects" assurance', re: /\b(there\s+are\s+no|are\s+no|no)\s+(liens|encumbrances|defects|exceptions)\b/i },
  { label: 'guarantee/warrant of title', re: /\b(guarantee|guaranty|guaranteed|warrant|warranted)\b[^.]{0,40}\btitle\b/i },
];

// Drafts-only annotation markers — must never surface in a client artifact (mirrors the deed B6 denylist).
const ANNOTATION_MARKERS: ReadonlyArray<{ label: string; re: RegExp }> = [
  { label: '[[ ]] placeholder / research lead', re: /\[\[/ },
  { label: 'NOTE: annotation', re: /\bNOTE\s*:/i },
  { label: 'TODO annotation', re: /\bTODO\b/i },
  { label: '{{ }} template token', re: /\{\{/ },
];

// Citation-shaped tokens (statute/code cites + land-record references) that carry authority in a client
// communication and therefore must be verified.
const CITATION_PATTERNS: ReadonlyArray<RegExp> = [
  /§\s*\d[\w.-]*/g,
  /\b(Va\.?|Md\.?|D\.?C\.?)\s*Code\b[^.\n]*/gi,
  /\bU\.?S\.?C\.?\b[^.\n]*/g,
  /\b(d\.?b\.?\s*\d+\s*(pg|pg\.|page)\s*\d+|instrument\s*(no\.?|number|#)\s*\d+|liber\s*\d+\s*folio\s*\d+)\b/gi,
];
// A citation is treated as VERIFIED only when a verification marker sits within this many chars of it.
const VERIFICATION_MARKERS = /\[(externally verified|instrument-confirmed|docket-confirmed|tax-record-confirmed)\]/i;
const VERIFY_WINDOW = 60;

/** NC-3e — forbidden assurances. */
export function checkForbiddenAssurances(text: string): RenderBlockResult {
  const t = text ?? '';
  const failures: string[] = [];
  for (const { label, re } of FORBIDDEN_ASSURANCES) {
    if (re.test(t)) failures.push(`forbidden assurance — ${label}`);
  }
  return { ok: failures.length === 0, failures };
}

/** Drafts-only annotation markers must never reach a client artifact. */
export function checkAnnotationMarkers(text: string): RenderBlockResult {
  const t = text ?? '';
  const failures: string[] = [];
  for (const { label, re } of ANNOTATION_MARKERS) {
    if (re.test(t)) failures.push(`annotation leak — ${label}`);
  }
  return { ok: failures.length === 0, failures };
}

/** NC-3e — a citation that carries authority must be marked verified; an unmarked citation is blocked. */
export function checkUnverifiedCitations(text: string): RenderBlockResult {
  const t = text ?? '';
  const failures: string[] = [];
  for (const pattern of CITATION_PATTERNS) {
    const re = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
    let m: RegExpExecArray | null;
    while ((m = re.exec(t)) !== null) {
      const start = Math.max(0, m.index - VERIFY_WINDOW);
      const end = Math.min(t.length, m.index + m[0].length + VERIFY_WINDOW);
      const window = t.slice(start, end);
      if (!VERIFICATION_MARKERS.test(window)) {
        failures.push(`unverified citation — "${m[0].trim()}" carries no [externally verified]/[instrument-confirmed] marker`);
      }
      if (m.index === re.lastIndex) re.lastIndex++; // guard zero-width
    }
  }
  return { ok: failures.length === 0, failures };
}

/**
 * Aggregate NC-3e render-block gate for client/underwriter-facing output. Fail-closed: the render is
 * permitted ONLY when every sub-gate passes. Any failure blocks emission and returns to the attorney — this
 * never auto-sends or strips content silently.
 */
export function checkClientFacingRenderBlocks(text: string): RenderBlockResult {
  const results = [checkForbiddenAssurances(text), checkAnnotationMarkers(text), checkUnverifiedCitations(text)];
  const failures = results.flatMap((r) => r.failures);
  return { ok: failures.length === 0, failures };
}
