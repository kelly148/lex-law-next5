/**
 * create-smoke-user.mjs — provision the DEDICATED post-deploy smoke account (FOLD-DEPLOY-VERIFY-1 / MODE A).
 *
 * Creates a SEPARATE login used ONLY by the post-deploy smoke suite — never the
 * attorney's admin/real-data account. The smoke checks log in and exercise the auth
 * endpoints against this account; keep it free of real client matters.
 *
 * NOTE ON "LOW-PRIVILEGE": this app is single-tier (no RBAC yet — settled decision).
 * So "low-privilege" here means an ISOLATED account: owner-scoped to its own (empty)
 * data, distinct from the admin login. True least-privilege (a restricted role) is a
 * later layer; this is the available form of isolation today. (Residual flagged.)
 *
 * The operator runs this ONCE against prod. It NEVER prints the password. It is
 * idempotent: if the username already exists, it makes no change.
 *
 * Usage (PowerShell) — the username/password MUST match the GitHub secrets
 * SMOKE_USERNAME / SMOKE_PASSWORD you will set:
 *   $env:DATABASE_URL = '<prod TiDB connection string>'
 *   $env:SMOKE_USERNAME = 'smoke-bot'
 *   $env:SMOKE_PASSWORD = '<a strong password, >=12 chars>'
 *   node scripts/create-smoke-user.mjs
 * Requires bcryptjs + mysql2 resolvable (both are project deps; e.g. install them in a
 * throwaway folder and run this script from there).
 */
import bcrypt from 'bcryptjs';
import mysql from 'mysql2/promise';
import { randomUUID } from 'node:crypto';

const BCRYPT_COST = 12; // matches src/server/procedures/auth.ts

async function main() {
  const url = process.env.DATABASE_URL;
  const username = process.env.SMOKE_USERNAME;
  const password = process.env.SMOKE_PASSWORD;
  if (!url) throw new Error('DATABASE_URL is not set — refusing to run.');
  if (!username) throw new Error('SMOKE_USERNAME is not set.');
  if (!password) throw new Error('SMOKE_PASSWORD is not set.');
  if (password.length < 12) throw new Error('SMOKE_PASSWORD must be at least 12 characters.');
  if (username.length > 64) throw new Error('SMOKE_USERNAME must be <= 64 characters.');

  const conn = await mysql.createConnection({ uri: url });
  try {
    const [[{ db }]] = await conn.query('SELECT DATABASE() AS db');
    console.log(`[smoke-user] connected to database: ${db}`);

    const [existing] = await conn.query('SELECT id FROM users WHERE username = ? LIMIT 1', [username]);
    if (Array.isArray(existing) && existing.length > 0) {
      console.log(`[smoke-user] user "${username}" already exists (id=${existing[0].id}); no change. (idempotent)`);
      return;
    }

    const id = randomUUID();
    const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
    await conn.query(
      'INSERT INTO users (id, username, passwordHash, displayName) VALUES (?, ?, ?, ?)',
      [id, username, passwordHash, username],
    );
    console.log(`[smoke-user] created dedicated smoke account "${username}" (id=${id}).`);
    console.log('[smoke-user] Reminder: keep this account free of real client matters (no RBAC — isolation is by separate account).');
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error(`[smoke-user] FAILED: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
