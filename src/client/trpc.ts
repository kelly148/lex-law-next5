/**
 * tRPC React client — Lex Law Next v1
 *
 * Phase 5 bootstrap: creates the tRPC React hooks singleton.
 *
 * R14 — No Duplicate Primitives: this is the single authoritative tRPC client.
 * All components import `trpc` from this module.
 *
 * The httpBatchLink uses a relative URL (/trpc) so that Vite's dev proxy
 * forwards to the API server on port 3001. In production the same relative
 * path resolves correctly against the server origin.
 *
 * Portability guardrail (DEPLOYMENT.md): relative URL only — no hard-coded
 * host or port. The Vite proxy config in vite.config.ts handles the mapping.
 */
import { createTRPCReact } from '@trpc/react-query';
import type { AppRouter } from '../server/router.js';

export const trpc = createTRPCReact<AppRouter>();
