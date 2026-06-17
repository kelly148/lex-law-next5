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
  // R2 prereqs — additive (ADD COLUMN IF NOT EXISTS). These were authored expecting auto-apply but
  // were never appended here, so the pre-deploy runner silently skipped them: matters.jurisdiction
  // (0019) and matter_parties.confirmed/confirmedAt/confirmedByUserId + conflict_checks.checkedPartyIds
  // (0020) were missing on prod, breaking every `SELECT * FROM matters`. Idempotent re-apply restores it.
  '0019_r2_pre_juris_1_matter_jurisdiction.sql',
  '0020_r2_pre_conflict_1_party_confirmation.sql',
  // FOLD-PM-1 Inc 1 — deadline/tickler engine data core. Five additive CREATE TABLE IF NOT EXISTS +
  // idempotent firm-default seeds (ON DUPLICATE KEY UPDATE). No behavior; flag DEADLINE_ENGINE_ENABLED OFF.
  '0021_fold_pm_1_deadline_engine.sql',
  // FOLD-PM-1 Inc 3 — append deadline_fired / deadline_acknowledged to audit_events.eventType (additive
  // ENUM value addition via MODIFY; existing rows untouched; idempotent).
  '0022_fold_pm_1_deadline_audit_events.sql',
  // DOC-CLIENT-TARGET-1 Inc 1 — document_party join table + documents.sourceDocumentId +
  // matter_parties.deletedAt (additive CREATE TABLE IF NOT EXISTS + ADD COLUMN IF NOT EXISTS).
  '0023_doc_client_target_1_document_party.sql',
  // MATERIALS-DROPZONE-1 Inc B — append 'processing' + 'low_confidence' to
  // matter_materials.extractionStatus ENUM (additive MODIFY; existing rows untouched; idempotent).
  '0024_materials_dropzone_1_ocr_status.sql',
  // CONFLICT-GATE-OVERRIDE-1 — gate_override table (attested per-matter, per-precondition override of the
  // fail-closed intake gate). Single additive CREATE TABLE IF NOT EXISTS; no existing table altered.
  // Renumbered 0024 -> 0025 at rebase: 0024 was taken by MATERIALS-DROPZONE-1 Inc B on main.
  '0025_conflict_gate_override_1_gate_override.sql',
  // INSTR-1A0 — prompt_snapshots (per-draft-job composed-system-text audit record). Single additive
  // CREATE TABLE IF NOT EXISTS; no existing table altered. Flag PROMPT_COMPOSITION_ENABLED OFF.
  '0026_instr_1a0_prompt_snapshots.sql',
  // REVIEWER-LATENCY-1 Step 0 — jobs.tokensReasoning (additive ADD COLUMN IF NOT EXISTS on the
  // existing jobs table). Persistence-only; no provider request changes. Idempotent.
  '0027_reviewer_latency_0_tokens_reasoning.sql',
  // REVIEWER-ASYNC-DISPLAY-1 (Gate 0 Component C): additive reviewer_lanes table. Apply BEFORE
  // flipping REVIEWER_ASYNC_ENABLED. (NOTE: 0028/0029 — the CHAT-UI-1 posture_provenance table +
  // subject column — remain absent from this allowlist; that is the separate CHAT_UI_1 exposure.)
  '0030_reviewer_async_display_1_reviewer_lanes.sql',
  // INSTR-2B-title — additive matters.engagementCapacity ENUM NOT NULL DEFAULT 'law_firm'
  // (capacity election; ADD COLUMN IF NOT EXISTS, idempotent). Apply BEFORE the INSTR-2B-title code
  // serves (matter.create / reads reference the column). Default-safe; on the additive pre-deploy path.
  '0031_instr_2b_title_matter_engagement_capacity.sql',
  // CAPACITY-ELECTION-UX — additive matters.engagementCapacityElectedAt TIMESTAMP NULL (affirmative-
  // election marker; ADD COLUMN IF NOT EXISTS, idempotent, NO backfill). NULL = unelected. Apply
  // BEFORE the CAPACITY-ELECTION-UX code serves (reads/predicates reference the column). Default-safe
  // (the Zod Wall reads it .nullable().optional()); on the additive pre-deploy path. No new env var.
  '0032_capacity_election_marker.sql',
  // CHAT-COPILOT-1 (Inc 1) — additive chat_conversations / chat_messages / chat_summaries
  // (CREATE TABLE IF NOT EXISTS, idempotent, NO FK constraints — isolation is app-layer). Written
  // ONLY when CHAT_COPILOT_ENABLED is ON (default OFF); flag-OFF never touches these tables. Apply
  // BEFORE flipping CHAT_COPILOT_ENABLED. Default-safe; on the additive pre-deploy path. No new env var
  // beyond the flag.
  '0033_chat_copilot_1_conversations.sql',
  // CHAT-COPILOT-2 (Increment A — egress control plane) — additive chat_conversations.holdFlag
  // (ADD COLUMN IF NOT EXISTS) + chat_egress_events (CREATE TABLE IF NOT EXISTS, append-only audit, NO
  // FK — isolation is app-layer). Written/read ONLY when CHAT_COPILOT_ENABLED is ON (default OFF); apply
  // BEFORE flipping CHAT_COPILOT_ENABLED. Default-safe; on the additive pre-deploy path. No new env var.
  '0034_chat_copilot_2_egress.sql',
  // CHAT-COPILOT-2 (Increment A — A2 attachments) — additive chat_attachments + chat_attachment_party
  // (CREATE TABLE IF NOT EXISTS, idempotent, NO FK — isolation app-layer). Ephemeral by-reference chat
  // attachments + G5 OCR-quality metadata + Q3 party attribution. Written/read ONLY when
  // CHAT_COPILOT_ENABLED is ON (default OFF); apply BEFORE flipping the flag. Default-safe. No new env var.
  '0035_chat_copilot_2_attachments.sql',
  // FOLD-PM-4 — additive matter_deliverable (CREATE TABLE IF NOT EXISTS, idempotent, NO FK — isolation
  // app-layer). Owner+matter-scoped to-do / ongoing-matter list. Written/read ONLY when
  // MATTER_DELIVERABLE_ENABLED is ON (default OFF); apply BEFORE flipping the flag. Default-safe. No new
  // env var beyond the flag.
  '0036_fold_pm_4_matter_deliverable.sql',
  // FOLD-PM-2 — additive material_extraction (CREATE TABLE IF NOT EXISTS, idempotent, NO FK — isolation
  // app-layer). One latest document-type structured extraction per material. Written/read ONLY when
  // DOCUMENT_EXTRACTION_ENABLED is ON (default OFF); apply BEFORE flipping the flag. Default-safe. No new
  // env var beyond the flag.
  '0037_fold_pm_2_material_extraction.sql',
  // KB-PROVENANCE-1 (MIG1) — additive nullable provenance/currency columns on practice_memos
  // (ADD COLUMN IF NOT EXISTS, idempotent; effectiveDate/reviewBy/authoritySnapshotId/
  // negativeTreatmentFlag). No backfill, no behavior change. WHEREAS_KB_CONSTITUTION §8.
  '0038_kb_provenance_1_practice_memo_provenance.sql',
  // KB-PROVENANCE-1 (MIG2) — additive authority_source registry (CREATE TABLE IF NOT EXISTS,
  // idempotent, NO FK). Durable firm/jurisdiction citation registry; NOT matter-scoped (no matterId),
  // so it survives matter closure and is not matter-purged. No client data; no behavior change.
  '0039_kb_provenance_1_authority_source.sql',
  // CHAT-COPILOT-2 (Increment B — multi-model review panel) — additive chat_review_runs +
  // chat_review_raw_outputs + chat_review_items (three CREATE TABLE IF NOT EXISTS, idempotent, NO FK —
  // isolation app-layer). Owner+matter-scoped panel-review work-product (purges WITH the matter).
  // Written/read ONLY when CHAT_REVIEW_PANEL_ENABLED is ON (default OFF); apply BEFORE flipping the flag.
  // Activation ALSO requires adding panel providers to GROUNDED_CHAT_PROVIDERS. Default-safe.
  '0040_chat_copilot_2_incb_review_panel.sql',
  // EGRESS-CONTROL-PLANE-1 (Increment 1) — additive egress_events (surface-agnostic audit ledger) +
  // egress_hold (scoped no_external hold: matter/global). Two CREATE TABLE IF NOT EXISTS, idempotent, NO
  // FK — isolation app-layer. chat_egress_events is UNTOUCHED (chat keeps writing there). Operator-apply;
  // default-safe (the document egress path is the only writer; sendability degrades to unavailable under
  // a hold or audit-write failure).
  '0041_egress_control_plane_1_egress_events.sql',
  '0042_egress_control_plane_1_egress_hold.sql',
  // EGRESS-CONTROL-PLANE-1 (Increment 2 — durable outbox + CR-4) — ADDITIVE: review_sessions
  // lifecyclePhase + partialReason (companion sub-state machine; state UNCHANGED so the
  // activeSessionKey generated-column guard is untouched), reviewer_lanes.status += blocked_by_hold,
  // jobs.idempotencyKey + unique index, audit_events.eventType += review_session_transition. All
  // ADD COLUMN/INDEX IF NOT EXISTS + ENUM-value MODIFY (trailing-append); no generated column is
  // touched; idempotent. Apply BEFORE the Inc-2 code serves (reads/writes reference the columns).
  '0043_egress_control_plane_1_inc2_outbox.sql',
  // FOLD-PM-3 — additive party/entity/contact data model (within-matter; owner-scoped).
  // Two CREATE TABLE IF NOT EXISTS (matter_entity, matter_entity_contact); idempotent;
  // NO existing table altered; NO DB FK (app-layer ownerScope). Indexes are INLINE in
  // CREATE TABLE (NOT `ALTER TABLE ... ADD INDEX IF NOT EXISTS`, which TiDB rejects).
  // Written/read ONLY when PARTY_MODEL_ENABLED is ON (default OFF); apply BEFORE flipping
  // the flag. Default-safe; on the additive pre-deploy path. No new env var beyond the flag.
  '0044_fold_pm_3_party_model.sql',
  // FOLD-NOTIFY-1 — additive notifications (in-app notification core; owner-scoped).
  // Single CREATE TABLE IF NOT EXISTS; idempotent; NO existing table altered; NO DB FK
  // (app-layer ownerScope). Indexes are INLINE in CREATE TABLE (NOT `ALTER TABLE ... ADD
  // INDEX IF NOT EXISTS`, which TiDB rejects). Written/read ONLY when NOTIFICATIONS_ENABLED
  // is ON (default OFF); apply BEFORE flipping the flag. Default-safe; on the additive
  // pre-deploy path. No new env var beyond the flag.
  '0045_fold_notify_1_notifications.sql',
];
const EXPECTED_TABLES_EXTRA = ['matter_parties', 'conflict_checks', 'conflict_hits', 'matter_analysis', 'pa_instruction_profiles', 'practice_memos', 'kb_adoptions', 'kb_events', 'provision_provenance', 'ldd_key_term', 'closure_package_item', 'sendability_rule', 'jurisdiction_rule', 'sendability_override', 'sendability_evaluation', 'deadline_rule', 'deadline_rule_revision', 'matter_deadline', 'tickler', 'holiday_calendar', 'document_party', 'gate_override', 'prompt_snapshots', 'reviewer_lanes', 'chat_conversations', 'chat_messages', 'chat_summaries', 'chat_egress_events', 'chat_attachments', 'chat_attachment_party', 'matter_deliverable', 'material_extraction', 'authority_source', 'chat_review_runs', 'chat_review_raw_outputs', 'chat_review_items', 'egress_events', 'egress_hold', 'matter_entity', 'matter_entity_contact', 'notifications'];
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
