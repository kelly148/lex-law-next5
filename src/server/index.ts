/**
 * Express server entry point — Lex Law Next v1
 *
 * Mounts the tRPC handler at /trpc and a health check at /api/health.
 * In development, Vite serves the client; in production, Express serves the built dist.
 *
 * Ch 3.1: Next.js was considered and rejected (decision #1); Express + Vite is the stack.
 */

import 'dotenv/config';
import express from 'express';
import { createExpressMiddleware } from '@trpc/server/adapters/express';
import { appRouter } from './router.js';
import { createContext } from './trpc.js';
import { setTelemetryDbWriter } from './telemetry/emitTelemetry.js';
import { db } from './db/connection.js';
import { telemetryEvents } from './db/schema.js';
import { v4 as uuidv4 } from 'uuid';

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
    matterId: event.matterId ?? undefined,
    documentId: event.documentId ?? undefined,
    jobId: event.jobId ?? undefined,
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
app.listen(PORT, () => {
  console.log(`[server] Lex Law Next v1 listening on port ${PORT}`);
  console.log(`[server] tRPC endpoint: http://localhost:${PORT}/trpc`);
  console.log(`[server] Health check: http://localhost:${PORT}/api/health`);
});

export default app;
