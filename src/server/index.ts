/**
 * Express server entry point — Lex Law Next v1
 *
 * Mounts the tRPC handler at /trpc and a health check at /api/health.
 * In development, Vite serves the client; in production, Express serves the built dist.
 *
 * Ch 3.1: Next.js was considered and rejected (decision #1); Express + Vite is the stack.
 *
 * Phase 2 additions:
 *   - LLM config validation at startup (Ch 22.3)
 *   - Job dispatcher startup (Ch 8)
 *   - Graceful shutdown handler
 */

import 'dotenv/config';
import express from 'express';
import { createExpressMiddleware } from '@trpc/server/adapters/express';
import { appRouter } from './router.js';
import { createContext } from './trpc.js';
import { setTelemetryDbWriter } from './telemetry/emitTelemetry.js';
import { db } from './db/connection.js';
import { telemetryEvents } from './db/schema.js';
import { validateLlmConfig } from './llm/config.js';
import { startDispatcher, stopDispatcher } from './jobs/dispatcher.js';

// ============================================================
// Startup validation (Ch 22.3)
// Fail fast if LLM config is invalid — do not accept connections
// with a misconfigured model whitelist.
// ============================================================
validateLlmConfig();

const app = express();
const PORT = parseInt(process.env['PORT'] ?? '3001', 10);

// ============================================================
// Telemetry database writer — wired up at server start
// ============================================================
setTelemetryDbWriter(async (event) => {
  await db.insert(telemetryEvents).values({
    eventId: event.eventId,
    eventType: event.eventType,
    userId: event.userId,
    matterId: event.matterId ?? null,
    documentId: event.documentId ?? null,
    jobId: event.jobId ?? null,
    timestamp: event.timestamp,
    payload: event.payload,
  });
});

// ============================================================
// Middleware
// ============================================================
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ============================================================
// Health check
// ============================================================
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ============================================================
// tRPC handler
// ============================================================
app.use(
  '/trpc',
  createExpressMiddleware({
    router: appRouter,
    createContext,
    onError: ({ error, path }) => {
      if (error.code !== 'UNAUTHORIZED') {
        // Log non-auth errors; UNAUTHENTICATED errors are too noisy (Ch 25.9)
        console.error(`[tRPC] Error on ${path ?? 'unknown'}:`, error.message);
      }
    },
  })
);

// ============================================================
// Start
// ============================================================
// Bind to 0.0.0.0 so the server is reachable from any network interface
// (required for containerised and proxied deployments — Part 2 portability guardrail).
const server = app.listen(PORT, '0.0.0.0', async () => {
  console.log(`[server] Lex Law Next v1 listening on 0.0.0.0:${PORT}`);
  console.log(`[server] tRPC endpoint: http://localhost:${PORT}/trpc`);
  console.log(`[server] Health check: http://localhost:${PORT}/api/health`);

  // Start the job dispatcher after the server is listening
  await startDispatcher();
});

// ============================================================
// Graceful shutdown
// ============================================================
function gracefulShutdown(signal: string): void {
  console.log(`[server] ${signal} received — shutting down gracefully`);
  stopDispatcher();
  server.close(() => {
    console.log('[server] HTTP server closed');
    process.exit(0);
  });
  // Force exit after 10s if graceful shutdown stalls
  setTimeout(() => {
    console.error('[server] Forced exit after 10s shutdown timeout');
    process.exit(1);
  }, 10_000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

export default app;
