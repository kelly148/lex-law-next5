/**
 * Database connection — Lex Law Next v1
 *
 * Uses mysql2 driver with Drizzle ORM for TiDB-compatible MySQL.
 * The connection is a singleton; import `db` everywhere.
 *
 * Ch 3.3: Drizzle schema definitions in server/db/schema.ts are the source of truth.
 *
 * DATABASE_URL is validated at server startup (server/index.ts) and during
 * the first actual DB call. The module-level check is deferred to avoid
 * crashing test imports that mock the query layer and never touch the real DB.
 */

import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import * as schema from './schema.js';

function createDb() {
  const url = process.env['DATABASE_URL'];
  if (!url) {
    // In test environments that mock the query layer, this path is never reached.
    // In production, server/index.ts validates DATABASE_URL at startup before
    // any request is served, so this error is a belt-and-suspenders guard.
    throw new Error(
      'DATABASE_URL environment variable is required. ' +
      'Copy .env.example to .env.local and set your TiDB connection string.'
    );
  }

  const pool = mysql.createPool({
    uri: url,
    // TiDB Cloud requires SSL; mysql2 handles this via the connection string
    // For local TiDB: ssl: false can be set via DATABASE_URL params
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    // S2 (MR-DEPLOY-1): Explicit keep-alive settings.
    // enableKeepAlive is true by default in mysql2 >=3.x, but set explicitly
    // to guard against future version drift and make intent visible in code.
    // keepAliveInitialDelay defaults to undefined (OS-level, ~7200s on Linux),
    // which is far too long for cloud-managed MySQL idle-timeout patterns.
    // 10000ms (10s) is conservative and works against any plausible idle policy
    // in the typical 60s–600s range (assumption per MR-DEPLOY-1 S1.a).
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000,
  });

  return drizzle(pool, {
    schema,
    mode: 'default',
  });
}

// Lazy singleton — only created when first accessed
let _db: ReturnType<typeof createDb> | null = null;

export function getDb(): ReturnType<typeof createDb> {
  if (_db === null) {
    _db = createDb();
  }
  return _db;
}

/**
 * The db export — used throughout the server.
 * Accessing this in a test that mocks the query layer is safe because
 * the mock intercepts before any actual DB call is made.
 *
 * If you need to access the db in a test that does NOT mock the query layer,
 * set DATABASE_URL in the test environment.
 */
export const db = new Proxy({} as ReturnType<typeof createDb>, {
  get(_target, prop) {
    return getDb()[prop as keyof ReturnType<typeof createDb>];
  },
});

export type Database = ReturnType<typeof createDb>;
