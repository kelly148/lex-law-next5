/**
 * Auth procedures — Lex Law Next v1
 *
 * Ch 3.9 — Authentication and User Context (v1):
 *   - Login: POST /api/auth/login (via tRPC)
 *   - Logout: POST /api/auth/logout (via tRPC)
 *
 * Procedure naming convention (established Phase 1, per Build Instructions B.4):
 *   <domain>.<verb> — e.g., auth.login, auth.logout
 *
 * Ch 35.2: userId is never in procedure input. The login procedure is the one
 * place where userId is produced (from the database lookup), not consumed.
 * After login, all procedures consume ctx.userId from the session.
 *
 * Security notes:
 *   - Generic "invalid credentials" response on failure — no user enumeration.
 *   - bcrypt comparison is constant-time.
 *   - Session cookie is httpOnly, sameSite=lax, secure in production.
 */

import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { router, publicProcedure, protectedProcedure } from '../trpc.js';
import { getUserByUsername } from '../db/queries/users.js';
import { getSession } from '../middleware/session.js';
import { emitTelemetry } from '../telemetry/emitTelemetry.js';
import { TRPCError } from '@trpc/server';

export const authRouter = router({
  /**
   * auth.login
   *
   * POST with username + password.
   * On success: sets session cookie with userId, returns { userId, displayName }.
   * On failure: generic UNAUTHORIZED — no user enumeration.
   */
  login: publicProcedure
    .input(
      z.object({
        username: z.string().min(1).max(64),
        password: z.string().min(1).max(128),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const user = await getUserByUsername(input.username);

      // Constant-time comparison even on user-not-found path
      // (compare against a dummy hash to prevent timing attacks)
      const dummyHash = '$2b$12$invalidhashfortimingprotection0000000000000000000000000';
      const hashToCompare = user?.passwordHash ?? dummyHash;
      const passwordValid = await bcrypt.compare(input.password, hashToCompare);

      if (!user || !passwordValid) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'Invalid credentials.',
        });
      }

      // Set session cookie
      const session = await getSession(ctx.req, ctx.res);
      session.userId = user.id;
      await session.save();

      return {
        userId: user.id,
        displayName: user.displayName,
      };
    }),

  /**
   * auth.logout
   *
   * Clears the session cookie.
   * Protected — must be authenticated to log out (prevents CSRF logout attacks).
   */
  logout: protectedProcedure
    .mutation(async ({ ctx }) => {
      const session = await getSession(ctx.req, ctx.res);

      // Emit telemetry before destroying session so we have userId
      // (No specific logout event in catalog; procedure_error would fire on failure)
      void ctx.userId; // userId is available from ctx per Ch 35.2

      session.destroy();

      emitTelemetry(
        'procedure_error', // Using procedure_error as a placeholder — no logout event in catalog
        {
          procedureName: 'auth.logout',
          errorCode: 'LOGOUT_SUCCESS', // Not an error — using this as an audit trail
          errorMessage: 'User logged out successfully.',
        },
        { userId: ctx.userId }
      );

      return { success: true };
    }),

  /**
   * auth.me
   *
   * Returns the current session's userId and displayName.
   * Used by the client to check authentication state on mount.
   */
  me: protectedProcedure
    .query(async ({ ctx }) => {
      const { getUser } = await import('../db/queries/users.js');
      const user = await getUser(ctx.userId);

      if (!user) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'UNAUTHENTICATED',
        });
      }

      return {
        userId: user.id,
        displayName: user.displayName,
        username: user.username,
      };
    }),

  /**
   * auth.changePassword (FOLD-AUTH-1)
   *
   * Authenticated self-serve password change. Verifies the CURRENT password
   * (bcrypt, constant-time) before setting the new one. Generic UNAUTHORIZED on
   * mismatch — no information leak. Used to rotate the stopgap credential and by
   * the operator to maintain their own account.
   *
   * Note: iron-session cookies are stateless/signed, so this cannot revoke other
   * outstanding sessions server-side; the current session remains valid. A
   * server-side session store (future) would be needed to invalidate all sessions.
   */
  changePassword: protectedProcedure
    .input(
      z.object({
        currentPassword: z.string().min(1).max(128),
        newPassword: z.string().min(10).max(128),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { getUser, getUserByUsername, updateUserPassword } = await import(
        '../db/queries/users.js'
      );

      const pub = await getUser(ctx.userId);
      if (!pub) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'UNAUTHENTICATED' });
      }
      // Full row (incl. passwordHash) for the current-password check.
      const full = await getUserByUsername(pub.username);
      if (!full) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'UNAUTHENTICATED' });
      }

      const currentValid = await bcrypt.compare(input.currentPassword, full.passwordHash);
      if (!currentValid) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Invalid credentials.' });
      }
      if (input.newPassword === input.currentPassword) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'New password must differ from the current password.',
        });
      }

      const newHash = await bcrypt.hash(input.newPassword, 12);
      await updateUserPassword(ctx.userId, newHash);

      emitTelemetry(
        'procedure_error', // no dedicated password-change event in the catalog; audit-trail use (mirrors auth.logout)
        {
          procedureName: 'auth.changePassword',
          errorCode: 'PASSWORD_CHANGED', // not an error — audit marker
          errorMessage: 'Password changed successfully.',
        },
        { userId: ctx.userId }
      );

      return { success: true };
    }),
});
