/**
 * Migration runner — Lex Law Next v1
 *
 * Run with: pnpm db:migrate
 *
 * This script:
 * 1. Applies all pending Drizzle migrations from src/server/db/migrations/
 * 2. Seeds the single attorney user if no user row exists yet (Ch 3.9)
 *
 * Seeding reads SEED_USERNAME and SEED_PASSWORD_HASH from environment.
 * SEED_PASSWORD_HASH must be a bcrypt hash (cost factor 12 recommended).
 * Generate: node -e "const b=require('bcryptjs');console.log(b.hashSync('pw',12))"
 */

import 'dotenv/config';
import { migrate } from 'drizzle-orm/mysql2/migrator';
import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import { v4 as uuidv4 } from 'uuid';
import * as schema from './schema.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function runMigrations() {
  if (!process.env['DATABASE_URL']) {
    throw new Error('DATABASE_URL is required');
  }

  const connection = await mysql.createConnection({
    uri: process.env['DATABASE_URL'],
  });

  const db = drizzle(connection, { schema, mode: 'default' });

  console.log('Running migrations…');
  await migrate(db, {
    migrationsFolder: path.join(__dirname, 'migrations'),
  });
  console.log('Migrations complete.');

  // Seed the single attorney user if not present (Ch 3.9)
  const existingUsers = await db.select().from(schema.users).limit(1);
  if (existingUsers.length === 0) {
    const seedUsername = process.env['SEED_USERNAME'];
    const seedPasswordHash = process.env['SEED_PASSWORD_HASH'];

    if (!seedUsername || !seedPasswordHash) {
      console.warn(
        'WARNING: No user rows exist and SEED_USERNAME / SEED_PASSWORD_HASH are not set. ' +
        'Set these environment variables and re-run migrations to create the attorney account.'
      );
    } else {
      const userId = uuidv4();
      await db.insert(schema.users).values({
        id: userId,
        username: seedUsername,
        passwordHash: seedPasswordHash,
        displayName: seedUsername,
      });
      console.log(`Seeded attorney user: ${seedUsername} (id: ${userId})`);
    }
  } else {
    console.log('User row already exists — skipping seed.');
  }

  await connection.end();
  console.log('Done.');
}

runMigrations().catch((err: unknown) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
