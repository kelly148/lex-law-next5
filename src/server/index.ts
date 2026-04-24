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
import express, { type Request, type Response, type NextFunction } from 'express';
import { createExpressMiddleware } from '@trpc/server/adapters/express';
import multer from 'multer';
import mammoth from 'mammoth';
import { appRouter } from './router.js';
import { createContext } from './trpc.js';
import { setTelemetryDbWriter, emitTelemetry } from './telemetry/emitTelemetry.js';
import { db } from './db/connection.js';
import { telemetryEvents } from './db/schema.js';
import { validateLlmConfig } from './llm/config.js';
import { startDispatcher, stopDispatcher } from './jobs/dispatcher.js';
import { getSession, extractUserId } from './middleware/session.js';
import { insertMaterial } from './db/queries/materials.js';
import { getMatterById } from './db/queries/matters.js';

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
// POST /api/materials/upload — Phase 5 file-upload endpoint (Ch 21.6 / Ch 27)
//
// Transport only: receives a multipart file, extracts text content via mammoth
// (for .docx) or reads buffer as UTF-8 (for text/plain), then calls the existing
// insertMaterial() DB primitive. No new persistence primitive is introduced.
//
// Auth: userId drawn from iron-session cookie (Ch 35.2). Request rejected with
// 401 if session is missing or invalid — same guarantee as tRPC protectedProcedure.
//
// Zod Wall: the resulting material row is returned through insertMaterial(), which
// calls parseMaterialRow() → MatterMaterialRowSchema.parse() on every read.
//
// Storage: storageKey is set to a deterministic placeholder path
// (materials/{userId}/{materialId}.{ext}). No external blob storage client is
// introduced in v1 — the spec defers actual blob storage to a later phase.
// The placeholder key records the intended storage path for future migration.
//
// Supported MIME types:
//   application/vnd.openxmlformats-officedocument.wordprocessingml.document (.docx)
//   text/plain (.txt)
//   application/pdf — extractionStatus set to 'not_supported' (no PDF extractor in v1)
//   All others      — extractionStatus set to 'not_supported'
//
// File size limit: 50 MB (multer LIMIT_FILE_SIZE).
// ============================================================
const uploadMiddleware = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
}).single('file');

app.post(
  '/api/materials/upload',
  (req: Request, res: Response, next: NextFunction) => {
    uploadMiddleware(req, res, (err: unknown) => {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          res.status(413).json({ error: 'FILE_TOO_LARGE', message: 'File exceeds 50 MB limit' });
          return;
        }
        res.status(400).json({ error: err.code, message: err.message });
        return;
      }
      if (err) {
        next(err);
        return;
      }
      next();
    });
  },
  async (req: Request, res: Response): Promise<void> => {
    // ── Auth: extract userId from iron-session (Ch 35.2) ──────────────────────
    const session = await getSession(req, res);
    const userId = extractUserId(session);
    if (!userId) {
      res.status(401).json({ error: 'UNAUTHENTICATED', message: 'Not authenticated' });
      return;
    }

    // ── Validate form fields ──────────────────────────────────────────────────
    const matterId = typeof req.body?.['matterId'] === 'string'
      ? (req.body['matterId'] as string)
      : null;
    if (!matterId) {
      res.status(400).json({ error: 'MISSING_MATTER_ID', message: 'matterId is required' });
      return;
    }

    const file = req.file;
    if (!file) {
      res.status(400).json({ error: 'MISSING_FILE', message: "A file field named 'file' is required" });
      return;
    }

    // ── Ownership check: matter must belong to userId ─────────────────────────
    const matter = await getMatterById(matterId, userId);
    if (!matter) {
      res.status(404).json({ error: 'MATTER_NOT_FOUND', message: 'Matter not found' });
      return;
    }
    if (matter.archivedAt !== null) {
      res.status(409).json({ error: 'MATTER_ARCHIVED', message: 'Cannot upload to an archived matter' });
      return;
    }

    // ── Text extraction ───────────────────────────────────────────────────────
    const mimeType = file.mimetype;
    const originalName = file.originalname;
    const dotIdx = originalName.lastIndexOf('.');
    const ext = dotIdx >= 0 ? originalName.slice(dotIdx + 1).toLowerCase() : '';
    // storageKey uses a placeholder UUID for the path; insertMaterial generates the real id
    const { v4: uuidv4 } = await import('uuid');
    const pathId = uuidv4();
    const storageKey = `materials/${userId}/${pathId}${ext ? '.' + ext : ''}`;

    let textContent: string | null = null;
    let extractionStatus: 'extracted' | 'partial' | 'failed' | 'not_supported' = 'not_supported';
    let extractionError: string | null = null;

    if (
      mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      ext === 'docx'
    ) {
      try {
        const result = await mammoth.extractRawText({ buffer: file.buffer });
        textContent = result.value ?? null;
        extractionStatus = textContent !== null && textContent.trim().length > 0
          ? 'extracted'
          : 'partial';
      } catch (err) {
        extractionStatus = 'failed';
        extractionError = err instanceof Error ? err.message : String(err);
      }
    } else if (mimeType === 'text/plain' || ext === 'txt') {
      try {
        textContent = file.buffer.toString('utf-8');
        extractionStatus = 'extracted';
      } catch (err) {
        extractionStatus = 'failed';
        extractionError = err instanceof Error ? err.message : String(err);
      }
    }
    // else: pdf and other types — extractionStatus remains 'not_supported'

    // ── Persist via existing insertMaterial() primitive ───────────────────────
    const material = await insertMaterial({
      userId,
      matterId,
      filename: originalName,
      mimeType,
      fileSize: file.size,
      storageKey,
      textContent,
      extractionStatus,
      extractionError,
      tags: [],
      description: null,
      pinned: false,
      uploadSource: 'upload',
      deletedAt: null,
    });

    // ── Telemetry ─────────────────────────────────────────────────────────────
    void emitTelemetry(
      'material_uploaded',
      {
        filename: originalName,
        mimeType,
        fileSize: file.size,
        extractionStatus,
        uploadSource: 'upload',
      },
      { userId, matterId, documentId: null, jobId: null },
    );

    res.status(201).json(material);
  },
);

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
