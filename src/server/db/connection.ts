/**
 * Database connection — Lex Law Next v1
 *
 * Uses mysql2 driver with Drizzle ORM for TiDB-compatible MySQL.
 * The connection is a singleton; import `db` everywhere.
 *
 * Ch 3.3: Drizzle schema definitions in server/db/schema.ts are the source of truth.
 */

import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import * as schema from './schema.js';

if (!process.env['DATABASE_URL']) {
  throw new Error(
    'DATABASE_URL environment variable is required. ' +
    'Copy .env.example to .env.local and set your TiDB connection string.'
  );
}

// Create the connection pool
const pool = mysql.createPool({
  uri: process.env['DATABASE_URL'],
  // TiDB Cloud requires SSL; mysql2 handles this via the connection string
  // For local TiDB: ssl: false can be set via DATABASE_URL params
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

// Drizzle instance — the single db object used throughout the server
export const db = drizzle(pool, {
  schema,
  mode: 'default',
});

export type Database = typeof db;
