/**
 * /api/ready — Readiness endpoint (S4, MR-DEPLOY-1)
 *
 * Performs a lightweight SELECT 1 against the shared DB pool.
 * Returns 200 { status: 'ready' } on success, 503 { status: 'not_ready' }
 * on failure or timeout. Internal error details are NEVER included in the
 * response body (server-side logs only).
 *
 * /api/health remains liveness-only (process-alive, unconditional 200) and
 * is unchanged. /api/ready is the readiness signal for Railway or any external
 * probe that needs to distinguish process liveness from DB reachability.
 *
 * Exported separately from server/index.ts so that the checkDbReady helper
 * can be unit-tested without triggering the server bootstrap (app.listen).
 */

import type { Request, Response } from 'express';
import { sql, type SQL } from 'drizzle-orm';

/** Timeout (ms) for the SELECT 1 readiness check. */
export const READY_DB_TIMEOUT_MS = 2000;

/** Minimal interface for a DB pool that can execute raw SQL. */
export interface DbPool {
  execute: (query: SQL) => Promise<unknown>;
}

/**
 * Check whether the DB pool can execute a trivial query within timeoutMs.
 *
 * @param pool      A DB pool with an execute() method (compatible with the
 *                  shared Drizzle db singleton).
 * @param timeoutMs Maximum time to wait for the query to complete.
 * @returns true if SELECT 1 completes within timeoutMs; false otherwise.
 *
 * Exported for unit testing. The /api/ready handler calls this with the
 * shared db singleton and READY_DB_TIMEOUT_MS.
 */
export async function checkDbReady(
  pool: DbPool,
  timeoutMs: number,
): Promise<boolean> {
  try {
    await Promise.race([
      pool.execute(sql`SELECT 1`),
      new Promise<never>((_resolve, reject) =>
        setTimeout(
          () => reject(new Error('DB readiness check timed out')),
          timeoutMs,
        ),
      ),
    ]);
    return true;
  } catch (err) {
    console.warn(
      '[/api/ready] DB readiness check failed:',
      err instanceof Error ? err.message : String(err),
    );
    return false;
  }
}

/**
 * Express route handler factory for GET /api/ready.
 * Returns a handler bound to the provided db pool.
 * Registered in server/index.ts as:
 *   app.get('/api/ready', makeReadyHandler(db));
 */
export function makeReadyHandler(db: DbPool) {
  return async (_req: Request, res: Response): Promise<void> => {
    const ready = await checkDbReady(db, READY_DB_TIMEOUT_MS);
    if (ready) {
      res.status(200).json({ status: 'ready' });
    } else {
      res.status(503).json({ status: 'not_ready' });
    }
  };
}
