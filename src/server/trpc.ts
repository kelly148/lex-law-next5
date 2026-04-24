/**
 * tRPC router setup — Lex Law Next v1
 *
 * Establishes:
 *   - The tRPC context type (including ctx.userId from session)
 *   - The base router and procedure builders
 *   - The protectedProcedure builder (requires authentication)
 *   - The publicProcedure builder (login, health check)
 *
 * Ch 35.2: ctx.userId is the ONLY source of userId in procedure handlers.
 * Procedures never read userId from input.
 *
 * Ch 3.9: tRPC middleware reads the session cookie on every request,
 * validates the signature, checks expiry, and populates ctx with userId.
 * If missing or invalid, the middleware short-circuits with UNAUTHENTICATED.
 */

import { initTRPC, TRPCError } from '@trpc/server';
import type { Request, Response } from 'express';
import { getSession, extractUserId } from './middleware/session.js';

// ============================================================
// Context type
// ============================================================
export interface TrpcContext {
  req: Request;
  res: Response;
  /**
   * The authenticated attorney's userId.
   * Populated by the auth middleware from the session cookie.
   * Always a valid UUID when present; undefined only in public procedures.
   *
   * Ch 35.2: This is the ONLY source of userId. Never read from input.
   */
  userId: string | undefined;
}

// ============================================================
// Context factory — called on every request
// ============================================================
export async function createContext({
  req,
  res,
}: {
  req: Request;
  res: Response;
}): Promise<TrpcContext> {
  const session = await getSession(req, res);
  const userId = extractUserId(session) ?? undefined;

  return { req, res, userId };
}

// ============================================================
// tRPC initialization
// ============================================================
const t = initTRPC.context<TrpcContext>().create();

export const router = t.router;
export const middleware = t.middleware;
export const mergeRouters = t.mergeRouters;

// ============================================================
// Public procedure — no authentication required
// Used for: login, health check
// ============================================================
export const publicProcedure = t.procedure;

// ============================================================
// Auth middleware — validates session and injects userId
// ============================================================
const isAuthenticated = middleware(({ ctx, next }) => {
  if (!ctx.userId) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'UNAUTHENTICATED',
    });
  }
  // After this check, ctx.userId is guaranteed to be a string
  return next({
    ctx: {
      ...ctx,
      userId: ctx.userId,
    },
  });
});

// ============================================================
// Protected procedure — requires authentication
// Used for: all business-domain procedures
// ctx.userId is string (not string | undefined) after this middleware
// ============================================================
export const protectedProcedure = t.procedure.use(isAuthenticated);

// ============================================================
// Authenticated context type — userId is non-optional
// ============================================================
export type AuthenticatedContext = TrpcContext & { userId: string };
