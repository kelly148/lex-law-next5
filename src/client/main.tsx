/**
 * Client entry point — Lex Law Next v1
 *
 * Mounts the React app with:
 * - TanStack Query (React Query) for server state
 * - tRPC client for type-safe API calls (Phase 5: wired here)
 * - React Router for client-side navigation
 *
 * Portability guardrail (DEPLOYMENT.md):
 *   - httpBatchLink uses relative URL /trpc — no hard-coded host/port.
 *   - Vite proxy (vite.config.ts) forwards /trpc → localhost:3001 in dev.
 *   - In production the server serves both the static bundle and the API.
 */
import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { httpBatchLink } from '@trpc/client';
import { BrowserRouter } from 'react-router-dom';
import { trpc } from './trpc.js';
import App from './App.js';
// Whereas design tokens (verbatim R0 source of truth) load before globals so the
// --wa-* CSS variables exist when Tailwind utilities reference them.
import './styles/whereas-tokens.css';
import './styles/globals.css';

const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      // Relative URL — Vite proxies /trpc to the API server in dev.
      // In production, the Express server handles /trpc directly.
      url: '/trpc',
    }),
  ],
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000, // 30 seconds
      retry: 1,
    },
  },
});

// ── RELAYOUT-3-FIX: stale code-split chunk recovery ───────────────────────────────────────────
// After a deploy, a tab still running the PREVIOUS index references old chunk hashes; a lazy route's
// dynamic import then 404s ("Failed to fetch dynamically imported module") and React.lazy throws ->
// blank screen. Vite emits `vite:preloadError`; reload once (timestamp-guarded against loops) to
// fetch the current build. A generic unhandledrejection fallback covers non-Vite import failures.
declare global {
  interface WindowEventMap {
    'vite:preloadError': Event;
  }
}
const CHUNK_RELOAD_KEY = 'whereas:chunk-reload-at';
function recoverFromStaleChunk(): void {
  const last = Number(sessionStorage.getItem(CHUNK_RELOAD_KEY) ?? '0');
  if (Date.now() - last < 10_000) return; // reloaded < 10s ago — don't loop on a genuinely missing chunk
  sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now()));
  window.location.reload();
}
window.addEventListener('vite:preloadError', (e) => {
  e.preventDefault();
  recoverFromStaleChunk();
});
window.addEventListener('unhandledrejection', (e) => {
  const reason = e.reason as { message?: string } | string | undefined;
  const msg = typeof reason === 'string' ? reason : (reason?.message ?? '');
  if (/Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed/i.test(msg)) {
    recoverFromStaleChunk();
  }
});

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element not found. Check index.html.');
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    </trpc.Provider>
  </React.StrictMode>
);
