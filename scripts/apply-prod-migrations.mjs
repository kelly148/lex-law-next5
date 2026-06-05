/**
 * apply-prod-migrations.mjs — additive-only migration runner (Railway pre-deploy + manual).
 *
 * WHY THIS EXISTS: the repo's drizzle `db:migrate` runner needs a meta/_journal.json that
 * does not exist (these are hand-written migrations). This script applies an EXPLICIT
 * ALLOWLIST of committed .sql files, in order, against the database in DATABASE_URL.
 *
 * WIRED AS RAILWAY'S PRE-DEPLOY COMMAND (railway.json deploy.preDeployCommand). On deploy,
 * Railway runs this against ITS OWN DATABASE_URL BEFORE the new code serves. If it exits
 * non-zero the deploy FAILS and the previous version keeps serving (no half-migrated state).
 *
 * GUARDS:
 *   - ALLOWLIST ONLY: runs exactly the files in MIGRATIONS (additive). A destructive /
 *     non-additive migration is simply never added here — it stays operator-gated/manual.
 *   - ADDITIVE ASSERTION: before running each file, it is scanned for destructive DDL
 *     (DROP/TRUNCATE/DELETE/UPDATE-statement/RENAME); if found, the runner ABORTS (fails
 *     the deploy) rather than apply it. Defense-in-depth on the allowlist.
 *   - IDEMPOTENT: the allowlisted files use CREATE/ADD ... IF NOT EXISTS and additive
 *     ALTERs, so re-running on every deploy is safe.
 *   - Never prints the connection string.
 *
 * USAGE:
 *   Pre-deploy (Railway): node scripts/apply-prod-migrations.mjs        (dir auto-detected)
 *   Manual:               $env:DATABASE_URL='...'; node scripts/apply-prod-migrations.mjs [migrations-dir]
 */
import mysql from 'mysql2/promise';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Additive allowlist — IN ORDER. 0004 creates audit_events; 0005 alters it; then 0006.
// To auto-apply a FUTURE *additive* migration, append its filename here. NEVER add a
// destructive/non-additive migration — run those manually (operator-gated).
const MIGRATIONS = [
  '0004_fold_gov_1a_audit_events.sql',
  '0005_fold_l1_1_matter_state_engine.sql',
  '0006_fold_l1_4_reusable_artifacts.sql',
  '0007_fold_l0_1_matter_intake_analysis.sql',
  '0008_fold_kb_1_practice_knowledge_base.sql',
  '0009_fold_kb_1_adoptions_provenance.sql',
  '0010_fold_kb_1_kb_events.sql',
  '0011_fold_kb_1_matter_pakey.sql',
  '0012_fold_orch_1_matter_orchestration_lanes.sql',
  '0013_fold_orch_1_orchestration_persistence.sql',
  '0014_fold_orch_1_evaluator_issue_groups.sql',
  '0015_fold_draft_1_provision_provenance.sql',
  '0016_fold_draft_1_ldd_key_term.sql',
  '0017_fold_draft_1_closure_package.sql',
  '0018_fold_send_1_export_safety.sql',
];
const EXPECTED_TABLES_EXTRA = ['matter_parties', 'conflict_checks', 'conflict_hits', 'matter_analysis', 'pa_instruction_profiles', 'practice_memos', 'kb_adoptions', 'kb_events', 'provision_provenance', 'ldd_key_term', 'closure_package_item', 'sendability_rule', 'jurisdiction_rule', 'sendability_override', 'sendability_evaluation'];
const EXPECTED_TABLES = ['audit_events', 'source_authority', 'open_items', 'reusable_artifacts'];

// Destructive DDL the pre-deploy path must NEVER run. Patterns are scanned AFTER stripping
// `--` comments. UPDATE is matched only statement-initial so `ON UPDATE CURRENT_TIMESTAMP`
// (a legitimate additive column clause) does NOT trip it.
const DESTRUCTIVE = [
  /\bDROP\s+(TABLE|COLUMN|INDEX|DATABASE|SCHEMA|VIEW|CONSTRAINT|KEY|PARTITION)\b/i,
  /\bTRUNCATE\b/i,
  /\bDELETE\s+FROM\b/i,
  /\bRENAME\s+(TABLE|COLUMN|INDEX|TO)\b/i,
  /(^|;)\s*UPDATE\s+/im,
];

function assertAdditive(sql, file) {
  const stripped = sql.replace(/--[^\n]*/g, '');
  for (const re of DESTRUCTIVE) {
    if (re.test(stripped)) {
      throw new Error(
        `GUARD: ${file} contains a destructive/non-additive statement matching ${re}. ` +
          `The pre-deploy path is additive-only — run this migration manually (operator-gated).`,
      );
    }
  }
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is not set — refusing to run.');
  }
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  // Default: <repo>/src/server/db/migrations (scripts/ and src/ sit side by side in the
  // repo AND in the deployed image). Override with argv[2] for manual runs.
  const migrationsDir = process.argv[2] ?? join(scriptDir, '..', 'src', 'server', 'db', 'migrations');

  const conn = await mysql.createConnection({ uri: url, multipleStatements: true });
  try {
    const [[{ db }]] = await conn.query('SELECT DATABASE() AS db');
    console.log(`[migrate] connected to database: ${db}`);

    for (const file of MIGRATIONS) {
      const sql = readFileSync(join(migrationsDir, file), 'utf8');
      assertAdditive(sql, file); // aborts the deploy if non-additive
      process.stdout.write(`[migrate] applying ${file} ... `);
      await conn.query(sql);
      console.log('OK');
    }

    const [rows] = await conn.query('SHOW TABLES');
    const present = new Set(rows.map((r) => Object.values(r)[0]));
    for (const t of [...EXPECTED_TABLES, ...EXPECTED_TABLES_EXTRA]) {
      console.log(`[migrate] table ${t}: ${present.has(t) ? 'present' : 'MISSING'}`);
      if (!present.has(t)) throw new Error(`expected table ${t} not present after migration`);
    }
    console.log('[migrate] done (idempotent — safe to re-run).');
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  // Non-zero exit => Railway FAILS the deploy; the previous version keeps serving.
  console.error(`[migrate] FAILED: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
