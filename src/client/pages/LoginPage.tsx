/**
 * LoginPage — Lex Law Next v1
 *
 * Phase 1 scope: basic login form.
 * Uses useGuardedMutation per Ch 35.13 — every mutation button uses the hook.
 *
 * Ch 35.3 — No business logic in React components:
 *   - Validation is minimal (non-empty fields); real auth logic is server-side.
 *   - The component calls auth.login and handles the result.
 */

import React, { useState } from 'react';
import { useGuardedMutation } from '../hooks/useGuardedMutation.js';

// Minimal tRPC client stub for Phase 1 (full tRPC client wired in Phase 2+)
// This allows the component to compile and the hook to be tested.
async function loginMutationFn(input: { username: string; password: string }): Promise<{ userId: string; displayName: string }> {
  const response = await fetch('/trpc/auth.login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ json: input }),
  });

  if (!response.ok) {
    throw new Error('Invalid credentials.');
  }

  const data = await response.json() as { result: { data: { json: { userId: string; displayName: string } } } };
  return data.result.data.json;
}

export default function LoginPage(): React.ReactElement {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Ch 35.13: every mutation button uses useGuardedMutation
  const loginMutation = useGuardedMutation(loginMutationFn, {
    onSuccess: (data) => {
      // Phase 2+: redirect to the matters list
      console.log('Logged in as:', data.displayName);
      window.location.href = '/matters';
    },
    onError: (error) => {
      setErrorMessage(error.message);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!username.trim() || !password.trim()) {
      setErrorMessage('Username and password are required.');
      return;
    }

    loginMutation.mutate({ username: username.trim(), password });
  };

  return (
    <div className="min-h-screen bg-firm-light flex items-center justify-center">
      <div className="bg-white rounded-lg shadow-md p-8 w-full max-w-sm">
        <h1 className="text-2xl font-garamond text-firm-navy mb-6 text-center">
          Lex Law Next
        </h1>

        <form onSubmit={handleSubmit} noValidate>
          <div className="mb-4">
            <label
              htmlFor="username"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              Username
            </label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              disabled={loginMutation.isPending}
              autoComplete="username"
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-firm-navy disabled:opacity-50"
            />
          </div>

          <div className="mb-6">
            <label
              htmlFor="password"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              disabled={loginMutation.isPending}
              autoComplete="current-password"
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-firm-navy disabled:opacity-50"
            />
          </div>

          {errorMessage !== null && (
            <p className="text-red-600 text-sm mb-4">{errorMessage}</p>
          )}

          {/* Ch 35.13: mutation button uses useGuardedMutation — disabled during in-flight */}
          <button
            type="submit"
            disabled={loginMutation.isPending}
            className="w-full bg-firm-navy text-white rounded px-4 py-2 text-sm font-medium hover:bg-opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
          >
            {loginMutation.isPending ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
