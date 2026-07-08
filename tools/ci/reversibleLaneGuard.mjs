/**
 * reversibleLaneGuard.mjs — GOV-MECH-1 Part A (CI-LANE-GUARD-1).
 *
 * PURE, dependency-free classifier for the CI `reversible-lane-guard` job. Given the set of paths a PR's diff
 * touches (added / modified / renamed[old+new] / deleted), it decides whether ANY protected path is involved.
 * The workflow combines this classification with the operator-ack-label + actor check to pass or FAIL the PR.
 *
 * Why a plain .mjs under tools/ (not src/): tsconfig `include` is ["src"], so this file is OUTSIDE tsc; `eslint src`
 * does not lint it; the CI job runs it with bare `node` (no pnpm install, no build). Its logic is unit-tested by
 * tools/ci/reversibleLaneGuard.test.mjs (added to the vitest include), which is the acceptance "negative test".
 *
 * Semantics (dispatch v2 Part A, red-team items 1-5/11): the ONLY acknowledgment is the GitHub label
 * `lane:non-reversible-ack` applied by the operator account (kelly148); that check lives in the workflow. The ack is
 * NOT a pass-to-auto-merge — it lets CI go green but the PR is EXCLUDED from Rule-15 auto-merge (operator approve
 * accept: required). This module only answers "does the diff touch a protected path?"; it never sees labels.
 */

/**
 * Protected paths. A change that adds/modifies/renames/moves/deletes any of these trips the guard.
 * Two flavors:
 *  - PATH patterns (contain "/"): matched against the FULL repo-relative path. "**" spans path segments; "*" stays
 *    within one segment.
 *  - BASENAME patterns (no "/"): matched against basename(path) so a NEW infra/hosting/env file is caught anywhere
 *    (red-team item 3 — conservative over-protection of new deployment surfaces).
 */
export const PROTECTED_PATH_PATTERNS = [
  'src/server/db/migrations/**',
  'src/server/db/schema.ts',
  'scripts/apply-prod-migrations.mjs',
  'src/server/config/featureFlags.ts', // WHOLE file, no default-value carve-out (red-team item 4)
  '.github/**', // the guard protects itself (red-team item 5)
  'tools/deploy/**',
  'scripts/deploy/**',
  'scripts/*prod*',
  'infra/**',
  'deploy/**',
];

export const PROTECTED_BASENAME_PATTERNS = [
  'railway.json',
  'nixpacks.toml',
  'Dockerfile', // recorded deliberate addition (red-team item 11)
  'Procfile',
  'docker-compose*.yml',
  'docker-compose*.yaml',
  'fly.toml',
  'render.yaml',
  '*.prod.*',
  '*.production.*',
  '.env*', // .env* templates
];

/** Convert a glob (supporting ** across segments and * within a segment) to an anchored RegExp. */
function globToRegExp(glob, { dotAll }) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        // "**" (optionally followed by "/") spans any number of path segments, including none.
        if (glob[i + 2] === '/') {
          re += '(?:.*/)?';
          i += 2;
        } else {
          re += '.*';
          i += 1;
        }
      } else {
        // single "*": any run of chars, not crossing "/" (unless dotAll basename mode has no "/").
        re += dotAll ? '[^/]*' : '[^/]*';
      }
    } else if ('.+^${}()|[]\\'.includes(c)) {
      re += '\\' + c;
    } else if (c === '?') {
      re += '[^/]';
    } else {
      re += c;
    }
  }
  return new RegExp('^' + re + '$');
}

const basename = (p) => {
  const norm = p.replace(/\\/g, '/');
  const idx = norm.lastIndexOf('/');
  return idx === -1 ? norm : norm.slice(idx + 1);
};

/** True iff a single repo-relative path is protected. */
export function isProtectedPath(rawPath) {
  const p = rawPath.replace(/\\/g, '/').trim();
  if (p.length === 0) return false;
  for (const g of PROTECTED_PATH_PATTERNS) {
    if (globToRegExp(g, { dotAll: false }).test(p)) return true;
  }
  const base = basename(p);
  for (const g of PROTECTED_BASENAME_PATTERNS) {
    if (globToRegExp(g, { dotAll: true }).test(base)) return true;
  }
  return false;
}

/** Classify a list of changed paths. `protectedHits` is deduped + sorted for a stable report. */
export function classifyChangedFiles(changedPaths) {
  const hits = new Set();
  for (const p of changedPaths) {
    if (isProtectedPath(p)) hits.add(p.replace(/\\/g, '/').trim());
  }
  const protectedHits = [...hits].sort();
  return { protectedHits, isProtected: protectedHits.length > 0 };
}

// ── CLI: node tools/ci/reversibleLaneGuard.mjs <changed-files.txt> ────────────────────────────────────────────────
// Reads newline-delimited paths, prints a human report, and writes `protected=<bool>` to $GITHUB_OUTPUT (if set).
// Exit code is ALWAYS 0 here — classification only; the workflow decides pass/FAIL by combining this with the
// operator-ack-label + actor check (fail-closed on a protected diff without a valid operator ack).
async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('usage: node reversibleLaneGuard.mjs <changed-files.txt>');
    process.exit(2);
  }
  const { readFileSync, appendFileSync } = await import('node:fs');
  const lines = readFileSync(file, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const { protectedHits, isProtected } = classifyChangedFiles(lines);
  if (isProtected) {
    console.log(`reversible-lane-guard: PROTECTED paths changed (${protectedHits.length}):`);
    for (const h of protectedHits) console.log(`  - ${h}`);
  } else {
    console.log(`reversible-lane-guard: no protected paths changed (${lines.length} files); reversible lane.`);
  }
  const out = process.env['GITHUB_OUTPUT'];
  if (out) appendFileSync(out, `protected=${isProtected}\n`);
}

// Run main only when executed directly (not when imported by the test).
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('reversibleLaneGuard.mjs')) {
  main();
}
