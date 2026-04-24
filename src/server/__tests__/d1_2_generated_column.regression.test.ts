/**
 * D.1.2 Regression Test — Generated Column Write Rejection
 *
 * Verifies that the MySQL/TiDB database rejects any attempt to INSERT or UPDATE
 * a value for the generated columns `activeMatterKey` (information_requests) and
 * `activeSessionKey` (review_sessions).
 *
 * Per D.1.2 resolution: these columns are declared as GENERATED ALWAYS AS ... STORED
 * in the raw SQL migration. Application code must never write to them. This test
 * confirms the database enforces that invariant.
 *
 * Test strategy:
 *   1. Connect to a real MySQL database (requires DATABASE_URL env var pointing to
 *      a database where the Phase 4b migration has been applied).
 *   2. Attempt INSERT with an explicit value for the generated column.
 *   3. Assert the database returns error code 3105 (ER_NON_DEFAULT_VALUE_FOR_GENERATED_COLUMN).
 *   4. Attempt UPDATE setting the generated column to a value.
 *   5. Assert the database returns the same error.
 *
 * This test is SKIPPED when DATABASE_URL is not set to a real DB.
 * It MUST be run against a real MySQL/TiDB instance before merging Phase 4b.
 *
 * References: R10, Ch 4.10, Ch 4.8, D.1.2
 */
import { describe, it, expect, afterAll } from 'vitest';
import mysql from 'mysql2/promise';
import { v4 as uuidv4 } from 'uuid';

const DATABASE_URL = process.env['DATABASE_URL'];
const SKIP = !DATABASE_URL || DATABASE_URL.includes('test:test@localhost');

// MySQL error number for "Generated column cannot be assigned a value"
const ER_NON_DEFAULT_VALUE_FOR_GENERATED_COLUMN = 3105;

describe.skipIf(SKIP)(
  'D.1.2 — Generated column write rejection (requires live DB)',
  () => {
    let connection: mysql.Connection | null = null;

    async function getConnection(): Promise<mysql.Connection> {
      if (!connection) {
        connection = await mysql.createConnection({ uri: DATABASE_URL! });
      }
      return connection;
    }

    afterAll(async () => {
      if (connection) {
        await connection.end();
        connection = null;
      }
    });

    // -------------------------------------------------------------------------
    // information_requests.activeMatterKey
    // -------------------------------------------------------------------------
    describe('information_requests.activeMatterKey', () => {
      it('INSERT with explicit activeMatterKey is rejected by the database', async () => {
        const conn = await getConnection();
        const id = uuidv4();
        const matterId = uuidv4();
        const userId = uuidv4();

        let errorCode: number | undefined;
        try {
          await conn.execute(
            `INSERT INTO information_requests (id, userId, matterId, status, activeMatterKey)
             VALUES (?, ?, ?, 'draft', ?)`,
            [id, userId, matterId, matterId],
          );
        } catch (err: unknown) {
          const mysqlErr = err as { errno?: number };
          errorCode = mysqlErr.errno;
        }

        expect(errorCode).toBe(ER_NON_DEFAULT_VALUE_FOR_GENERATED_COLUMN);
      });

      it('UPDATE setting activeMatterKey explicitly is rejected by the database', async () => {
        const conn = await getConnection();
        const id = uuidv4();
        const matterId = uuidv4();
        const userId = uuidv4();

        // Insert a valid row first (no activeMatterKey)
        await conn.execute(
          `INSERT INTO information_requests (id, userId, matterId, status)
           VALUES (?, ?, ?, 'draft')`,
          [id, userId, matterId],
        );

        let errorCode: number | undefined;
        try {
          await conn.execute(
            `UPDATE information_requests SET activeMatterKey = ? WHERE id = ?`,
            [matterId, id],
          );
        } catch (err: unknown) {
          const mysqlErr = err as { errno?: number };
          errorCode = mysqlErr.errno;
        }

        // Clean up
        await conn.execute(`DELETE FROM information_requests WHERE id = ?`, [id]);

        expect(errorCode).toBe(ER_NON_DEFAULT_VALUE_FOR_GENERATED_COLUMN);
      });
    });

    // -------------------------------------------------------------------------
    // review_sessions.activeSessionKey
    // -------------------------------------------------------------------------
    describe('review_sessions.activeSessionKey', () => {
      it('INSERT with explicit activeSessionKey is rejected by the database', async () => {
        const conn = await getConnection();
        const id = uuidv4();
        const documentId = uuidv4();
        const userId = uuidv4();
        const fakeKey = `${documentId}-0000000001`;

        let errorCode: number | undefined;
        try {
          await conn.execute(
            `INSERT INTO review_sessions (id, userId, documentId, iterationNumber, state, globalInstructions, activeSessionKey)
             VALUES (?, ?, ?, 1, 'active', '', ?)`,
            [id, userId, documentId, fakeKey],
          );
        } catch (err: unknown) {
          const mysqlErr = err as { errno?: number };
          errorCode = mysqlErr.errno;
        }

        expect(errorCode).toBe(ER_NON_DEFAULT_VALUE_FOR_GENERATED_COLUMN);
      });

      it('UPDATE setting activeSessionKey explicitly is rejected by the database', async () => {
        const conn = await getConnection();
        const id = uuidv4();
        const documentId = uuidv4();
        const userId = uuidv4();
        const fakeKey = `${documentId}-0000000001`;

        // Insert a valid row first (no activeSessionKey)
        await conn.execute(
          `INSERT INTO review_sessions (id, userId, documentId, iterationNumber, state, globalInstructions)
           VALUES (?, ?, ?, 1, 'active', '')`,
          [id, userId, documentId],
        );

        let errorCode: number | undefined;
        try {
          await conn.execute(
            `UPDATE review_sessions SET activeSessionKey = ? WHERE id = ?`,
            [fakeKey, id],
          );
        } catch (err: unknown) {
          const mysqlErr = err as { errno?: number };
          errorCode = mysqlErr.errno;
        }

        // Clean up
        await conn.execute(`DELETE FROM review_sessions WHERE id = ?`, [id]);

        expect(errorCode).toBe(ER_NON_DEFAULT_VALUE_FOR_GENERATED_COLUMN);
      });
    });
  },
);

// -------------------------------------------------------------------------
// Smoke test that always runs (no live DB required)
// Verifies the test file itself is correctly structured.
// -------------------------------------------------------------------------
describe('D.1.2 — Generated column regression test structure', () => {
  it('test file is importable and skip condition is evaluated', () => {
    // If DATABASE_URL is not set to a real DB, SKIP is true and the live tests
    // are skipped. This test always passes to confirm the file is valid.
    expect(typeof SKIP).toBe('boolean');
  });
});
