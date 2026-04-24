/**
 * useAuth — Lex Law Next v1
 *
 * Phase 5: Auth context hook using auth.me tRPC query.
 *
 * R14 — No Duplicate Primitives: single authoritative auth hook.
 * All components that need auth state import this hook.
 *
 * Returns:
 *   - user: { userId, displayName, username } | null
 *   - isLoading: boolean — true while the auth.me query is in flight
 *   - isAuthenticated: boolean — true when user is non-null
 *
 * The hook uses auth.me which is a protectedProcedure — it returns
 * UNAUTHORIZED if no valid session cookie is present. The component
 * layer treats any error as "not authenticated".
 */
import { trpc } from '../trpc.js';

export interface AuthUser {
  userId: string;
  displayName: string;
  username: string;
}

export interface UseAuthResult {
  user: AuthUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
}

export function useAuth(): UseAuthResult {
  const { data, isLoading } = trpc.auth.me.useQuery(undefined, {
    // Do not retry on auth failure — 401 means not logged in
    retry: false,
    // Suppress error toasts for auth checks
    throwOnError: false,
  });

  const user: AuthUser | null = data
    ? { userId: data.userId, displayName: data.displayName, username: data.username }
    : null;

  return {
    user,
    isLoading,
    isAuthenticated: user !== null,
  };
}
