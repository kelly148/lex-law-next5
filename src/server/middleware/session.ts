/**
 * iron-session middleware — Lex Law Next v1
 *
 * Ch 3.9 — Authentication and User Context (v1):
 *   - Session transport is cookie-based using iron-session.
 *   - On every request, middleware reads the session cookie, validates signature,
 *     checks expiry, and populates tRPC context with userId.
 *   - If cookie is missing or invalid, middleware short-circuits with UNAUTHENTICATED.
 *
 * Ch 35.2 — userId is never a procedure input:
 *   - userId is drawn exclusively from ctx.userId (this middleware).
 *   - Procedures never accept userId in their input schemas.
 *
 * Session cookie contents: { userId: string }
 * Cookie name: lex_session
 * Expiry: 14 days (default per spec)
 */

import { getIronSession, type IronSession } from 'iron-session';
import type { Request, Response } from 'express';
import { SessionDataSchema, type SessionData } from '../../shared/schemas/users.js';

/**
 * HI-6 (REVIEWER-ROBUSTNESS-1): iron-session requires the password to be at least 32 characters.
 * The prior check tested presence ONLY, so a short secret passed startup and then threw deep at the
 * first request (or weakened cookie signing). Validate both presence AND length at boot so the
 * failure is loud and immediate. Returns the validated secret. The secret VALUE is never logged —
 * only its length is named in the length error.
 */
export function assertSessionSecret(secret: string | undefined): string {
  if (!secret) {
    throw new Error(
      'SESSION_SECRET environment variable is required. ' +
      'Must be at least 32 characters. See .env.example.'
    );
  }
  if (secret.length < 32) {
    throw new Error(
      `SESSION_SECRET must be at least 32 characters (got ${secret.length}). ` +
      'iron-session requires a >=32-character password. See .env.example.'
    );
  }
  return secret;
}

const SESSION_SECRET = assertSessionSecret(process.env['SESSION_SECRET']);

export const sessionOptions = {
  password: SESSION_SECRET,
  cookieName: 'lex_session',
  cookieOptions: {
    secure: process.env['NODE_ENV'] === 'production',
    httpOnly: true,
    sameSite: 'lax' as const,
    maxAge: 60 * 60 * 24 * 14, // 14 days in seconds
  },
};

/**
 * Get the iron-session from an Express request/response pair.
 * Returns the session object; userId may be undefined if not authenticated.
 */
export async function getSession(
  req: Request,
  res: Response
): Promise<IronSession<SessionData>> {
  return getIronSession<SessionData>(req, res, sessionOptions);
}

/**
 * Extract and validate userId from a session.
 * Returns userId string if authenticated, null if not.
 *
 * Validates via SessionDataSchema (Zod) to ensure the session cookie
 * was not tampered with in a way iron-session's signature check missed.
 */
export function extractUserId(session: IronSession<SessionData>): string | null {
  try {
    const parsed = SessionDataSchema.safeParse(session);
    if (!parsed.success) {
      return null;
    }
    return parsed.data.userId;
  } catch {
    return null;
  }
}
