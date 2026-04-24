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
