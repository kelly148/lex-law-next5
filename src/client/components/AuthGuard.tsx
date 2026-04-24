/**
 * AuthGuard — Lex Law Next v1
 *
 * Phase 5: Wraps protected routes. Redirects to /login if not authenticated.
 *
 * Uses auth.me via useAuth hook. While the query is loading, renders a
 * full-screen spinner so the user does not see a flash of the login page.
 *
 * Ch 35.3 — No business logic in React: auth logic is server-side.
 * This component only reads the auth state and redirects.
 */
import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.js';

interface AuthGuardProps {
  children: React.ReactNode;
}

export default function AuthGuard({ children }: AuthGuardProps): React.ReactElement {
  const { isLoading, isAuthenticated } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-firm-light">
        <div className="text-firm-navy text-sm">Loading…</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}
