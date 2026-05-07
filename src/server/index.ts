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
import path from 'path';
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
import { getDocumentById } from './db/queries/documents.js';
import { getVersionById, getVersionByNumber } from './db/queries/versions.js';
import type { VersionRow } from '../shared/schemas/matters.js';
import { Document as DocxDocument, Packer } from 'docx';
import { buildSatterwhiteSection } from './utils/markdownToDocx.js';
import { buildLetterSection } from './utils/letterFormatter.js';
import { makeReadyHandler } from './routes/ready.js';

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
// Health check (liveness — process-only, UNCHANGED per §5.4)
// ============================================================
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ============================================================
// Readiness check (S4, MR-DEPLOY-1)
//
// /api/ready performs a lightweight SELECT 1 against the shared DB pool.
// Returns 200 { status: 'ready' } on success, 503 { status: 'not_ready' }
// on failure or timeout. Internal error details are NEVER included in the
// response body (server-side logs only).
//
// /api/health remains liveness-only (process-alive, unconditional 200).
// /api/ready is the readiness signal for Railway or any external probe that
// needs to distinguish process liveness from DB reachability.
//
// checkDbReady and makeReadyHandler are defined in routes/ready.ts so that
// unit tests can import the helper without triggering the server bootstrap.
// ============================================================
app.get('/api/ready', makeReadyHandler(db));

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
// GET /api/documents/:documentId/export — Phase 6 synchronous DOCX export (Ch 32)
//
// Generates a .docx file in memory from the appropriate version content and
// streams it directly to the client. No stored artifact, no signed URL, no
// tokenized URL is created.
//
// Auth: userId drawn from iron-session cookie (Ch 35.2). Rejected with 401 if
// session is missing or invalid. userId is never accepted from query params or body.
//
// Version-selection rule (Ch 32):
//   complete             → officialFinalVersionNumber
//   substantively_accepted | finalizing → officialSubstantiveVersionNumber if set,
//                                         else currentVersionId fallback
//   drafting             → currentVersionId
//   archived             → officialFinalVersionNumber if set,
//                          else officialSubstantiveVersionNumber if set,
//                          else currentVersionId
//
// Watermark strings (Ch 32 — locked wording):
//   drafting / finalizing            → "DRAFT — NOT FINAL"
//   substantively_accepted           → "DRAFT — SUBSTANTIVELY COMPLETE, PENDING FINAL FORMATTING"
//   archived                         → "ARCHIVED"
//   complete                         → no watermark
//
// Telemetry: emits document_exported with { versionId, watermarkState, expiresAt }.
// expiresAt is the response-generation ISO timestamp, populated solely to satisfy
// the telemetry schema. It does not represent a real download-link expiration.
// ============================================================
app.get(
  '/api/documents/:documentId/export',
  async (req: Request, res: Response): Promise<void> => {
    // ── Auth ──────────────────────────────────────────────────────────────────
    const session = await getSession(req, res);
    const userId = extractUserId(session);
    if (!userId) {
      res.status(401).json({ error: 'UNAUTHENTICATED', message: 'Not authenticated' });
      return;
    }

    const { documentId } = req.params as { documentId: string };

    // ── Load document (ownership enforced by userId predicate) ────────────────
    const doc = await getDocumentById(documentId, userId);
    if (!doc) {
      res.status(404).json({ error: 'DOCUMENT_NOT_FOUND', message: 'Document not found' });
      return;
    }

    // ── Version-selection ─────────────────────────────────────────────────────
    let version: VersionRow | null = null;
    const state = doc.workflowState;

    if (state === 'complete') {
      // complete: always use officialFinalVersionNumber
      if (doc.officialFinalVersionNumber !== null) {
        version = await getVersionByNumber(documentId, userId, doc.officialFinalVersionNumber);
      }
    } else if (state === 'substantively_accepted' || state === 'finalizing') {
      // prefer officialSubstantiveVersionNumber; fall back to currentVersionId
      if (doc.officialSubstantiveVersionNumber !== null) {
        version = await getVersionByNumber(documentId, userId, doc.officialSubstantiveVersionNumber);
      } else if (doc.currentVersionId !== null) {
        version = await getVersionById(doc.currentVersionId, userId);
      }
    } else if (state === 'drafting') {
      // drafting: currentVersionId
      if (doc.currentVersionId !== null) {
        version = await getVersionById(doc.currentVersionId, userId);
      }
    } else if (state === 'archived') {
      // archived: officialFinalVersionNumber → officialSubstantiveVersionNumber → currentVersionId
      if (doc.officialFinalVersionNumber !== null) {
        version = await getVersionByNumber(documentId, userId, doc.officialFinalVersionNumber);
      } else if (doc.officialSubstantiveVersionNumber !== null) {
        version = await getVersionByNumber(documentId, userId, doc.officialSubstantiveVersionNumber);
      } else if (doc.currentVersionId !== null) {
        version = await getVersionById(doc.currentVersionId, userId);
      }
    }

    if (!version) {
      res.status(422).json({
        error: 'NO_EXPORTABLE_VERSION',
        message: 'No exportable version is available for this document',
      });
      return;
    }

    // ── Watermark string (Ch 32 locked wording) ───────────────────────────────
    const WATERMARK: Record<string, string | null> = {
      drafting: 'DRAFT — NOT FINAL',
      finalizing: 'DRAFT — NOT FINAL',
      substantively_accepted: 'DRAFT — SUBSTANTIVELY COMPLETE, PENDING FINAL FORMATTING',
      archived: 'ARCHIVED',
      complete: null, // no watermark
    };
    const watermarkText = WATERMARK[state] ?? null;

    // ── Build DOCX in memory (MR-EXPORT-FORMAT-2) ────────────────────────────
    // buildSatterwhiteSection returns a complete ISectionOptions object with
    // Satterwhite house-style header, footer (with PAGE field), and rendered
    // content children. All style logic lives in markdownToDocx.ts.
    const section = buildSatterwhiteSection(version.content, { watermarkText });
    const docxFile = new DocxDocument({ sections: [section] });

    const buffer = await Packer.toBuffer(docxFile);

    // ── Telemetry ─────────────────────────────────────────────────────────────
    const exportedAt = new Date().toISOString();
    // expiresAt is the response-generation timestamp, populated solely to satisfy
    // the telemetry schema. It does not represent a real download-link expiration.
    void emitTelemetry(
      'document_exported',
      {
        versionId: version.id,
        watermarkState: state,
        expiresAt: exportedAt,
      },
      { userId, matterId: doc.matterId, documentId, jobId: null },
    );

    // ── Stream response ───────────────────────────────────────────────────────
    const safeTitle = doc.title.replace(/[^a-zA-Z0-9_\-. ]/g, '_').slice(0, 80);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${safeTitle}.docx"`);
    res.setHeader('Content-Length', buffer.length);
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).end(buffer);
  },
);

// ============================================================
// POST /api/upload-format — MR-UPLOAD-FORMAT-2 stateless upload-and-format
//
// Accepts a multipart/form-data upload with a single 'file' field.
// Supported types:
//   .docx  — mammoth.convertToHtml → htmlToMarkdown → buildSatterwhiteSection → DOCX download
//   .txt   — UTF-8 read → buildSatterwhiteSection → DOCX download
//   .md    — UTF-8 read → buildSatterwhiteSection → DOCX download
//   .pdf   — not supported; returns 415 UNSUPPORTED_FILE_TYPE
//   other  — returns 415 UNSUPPORTED_FILE_TYPE
//
// MR-UPLOAD-FORMAT-2 change: DOCX extraction now uses mammoth.convertToHtml
// (not extractRawText) to preserve heading structure. The resulting HTML is
// converted to Markdown via htmlToMarkdown() so that buildSatterwhiteSection
// can apply section-heading formatting and infer the document title for the
// running header, matching Matters/Finalize parity.
//
// Auth: userId drawn from iron-session cookie. Rejected with 401 if absent.
// No DB persistence. No LLM calls. Reuses existing Satterwhite renderer.
// File size limit: 50 MB.
// Output filename: sanitized original name with -formatted.docx suffix.
// ============================================================

/**
 * htmlToMarkdown — minimal HTML-to-Markdown converter for mammoth.convertToHtml output.
 *
 * Converts the subset of HTML produced by mammoth.convertToHtml to Markdown:
 *   <h1>…</h1>  →  # …
 *   <h2>…</h2>  →  ## …
 *   <h3>…</h3>  →  ### …
 *   <h4>…</h4>  →  #### …
 *   <h5>…</h5>  →  ##### …
 *   <h6>…</h6>  →  ###### …
 *   <p>…</p>    →  paragraph text (blank line between)
 *   <strong>…</strong> / <b>…</b>  →  **…**
 *   <em>…</em> / <i>…</i>          →  _…_
 *   <br>        →  newline
 *   All other tags stripped.
 *
 * Intentionally narrow — handles only structural elements that affect
 * buildSatterwhiteSection rendering.
 */
function stripHtmlTags(html: string): string {
  return html.replace(/<[^>]+>/g, '');
}

function htmlToMarkdown(html: string): string {
  let md = html.replace(/\r\n?/g, '\n');
  // Headings
  md = md.replace(/<h1[^>]*>(.*?)<\/h1>/gis, (_m, inner: string) => `# ${stripHtmlTags(inner).trim()}`);
  md = md.replace(/<h2[^>]*>(.*?)<\/h2>/gis, (_m, inner: string) => `## ${stripHtmlTags(inner).trim()}`);
  md = md.replace(/<h3[^>]*>(.*?)<\/h3>/gis, (_m, inner: string) => `### ${stripHtmlTags(inner).trim()}`);
  md = md.replace(/<h4[^>]*>(.*?)<\/h4>/gis, (_m, inner: string) => `#### ${stripHtmlTags(inner).trim()}`);
  md = md.replace(/<h5[^>]*>(.*?)<\/h5>/gis, (_m, inner: string) => `##### ${stripHtmlTags(inner).trim()}`);
  md = md.replace(/<h6[^>]*>(.*?)<\/h6>/gis, (_m, inner: string) => `###### ${stripHtmlTags(inner).trim()}`);
  // Inline formatting
  md = md.replace(/<strong[^>]*>(.*?)<\/strong>/gis, (_m, inner: string) => `**${stripHtmlTags(inner)}**`);
  md = md.replace(/<b[^>]*>(.*?)<\/b>/gis, (_m, inner: string) => `**${stripHtmlTags(inner)}**`);
  md = md.replace(/<em[^>]*>(.*?)<\/em>/gis, (_m, inner: string) => `_${stripHtmlTags(inner)}_`);
  md = md.replace(/<i[^>]*>(.*?)<\/i>/gis, (_m, inner: string) => `_${stripHtmlTags(inner)}_`);
  // Line breaks
  md = md.replace(/<br\s*\/?>/gi, '\n');
  // Paragraphs
  md = md.replace(/<p[^>]*>(.*?)<\/p>/gis, (_m, inner: string) => `\n${stripHtmlTags(inner).trim()}\n`);
  // Strip remaining tags
  md = stripHtmlTags(md);
  // Normalize multiple blank lines
  md = md.replace(/\n{3,}/g, '\n\n');
  return md.trim();
}

const uploadFormatMiddleware = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
}).single('file');

app.post(
  '/api/upload-format',
  (req: Request, res: Response, next: NextFunction) => {
    uploadFormatMiddleware(req, res, (err: unknown) => {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          res.status(413).json({ error: 'FILE_TOO_LARGE', message: 'File exceeds 50 MB limit' });
          return;
        }
        res.status(400).json({ error: err.code, message: err.message });
        return;
      }
      if (err) { next(err); return; }
      next();
    });
  },
  async (req: Request, res: Response): Promise<void> => {
    // ── Auth ──────────────────────────────────────────────────────────────────
    const session = await getSession(req, res);
    const userId = extractUserId(session);
    if (!userId) {
      res.status(401).json({ error: 'UNAUTHENTICATED', message: 'Not authenticated' });
      return;
    }
    // ── File validation ───────────────────────────────────────────────────────
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: 'MISSING_FILE', message: "A file field named 'file' is required" });
      return;
    }
    if (file.size === 0) {
      res.status(400).json({ error: 'EMPTY_FILE', message: 'Uploaded file is empty' });
      return;
    }
    const originalName = file.originalname;
    const dotIdx = originalName.lastIndexOf('.');
    const ext = dotIdx >= 0 ? originalName.slice(dotIdx + 1).toLowerCase() : '';
    const mimeType = file.mimetype;
    // ── Type gate ─────────────────────────────────────────────────────────────
    const isDocx =
      mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      ext === 'docx';
    const isTxt = mimeType === 'text/plain' || ext === 'txt';
    const isMd = mimeType === 'text/markdown' || ext === 'md';
    const isPdf = mimeType === 'application/pdf' || ext === 'pdf';
    if (isPdf) {
      res.status(415).json({
        error: 'UNSUPPORTED_FILE_TYPE',
        message: 'PDF upload is not supported. Please convert to .docx or paste text directly.',
      });
      return;
    }
    if (!isDocx && !isTxt && !isMd) {
      res.status(415).json({
        error: 'UNSUPPORTED_FILE_TYPE',
        message: `Unsupported file type '${ext || mimeType}'. Supported: .docx, .txt, .md`,
      });
      return;
    }
    // ── Text extraction ───────────────────────────────────────────────────────
    // MR-UPLOAD-FORMAT-2: DOCX uses convertToHtml → htmlToMarkdown to preserve
    // heading structure for Matters/Finalize formatting parity.
    let extractedText: string;
    try {
      if (isDocx) {
        const result = await mammoth.convertToHtml({ buffer: file.buffer });
        const html = result.value ?? '';
        const md = htmlToMarkdown(html);
        if (md.trim().length === 0) {
          res.status(422).json({
            error: 'EXTRACTION_FAILED',
            message: 'DOCX extraction produced no text. The file may be empty or image-only.',
          });
          return;
        }
        extractedText = md;
      } else {
        extractedText = file.buffer.toString('utf-8');
        if (extractedText.trim().length === 0) {
          res.status(400).json({ error: 'EMPTY_FILE', message: 'Uploaded file contains no text content' });
          return;
        }
      }
    } catch (err) {
      res.status(422).json({
        error: 'EXTRACTION_FAILED',
        message: `Failed to extract text: ${err instanceof Error ? err.message : String(err)}`,
      });
      return;
    }
    // ── Profile routing (MR-UPLOAD-FORMAT-3) ─────────────────────────────────
    const rawProfile = typeof req.body?.profile === 'string' ? req.body.profile : 'general';
    const profile = rawProfile === 'letter' ? 'letter' : 'general';
    // ── Format via renderer ───────────────────────────────────────────────────
    let buffer: Buffer;
    try {
      const section = profile === 'letter'
        ? buildLetterSection(extractedText)
        : buildSatterwhiteSection(extractedText, { watermarkText: null });
      const docxFile = new DocxDocument({ sections: [section] });
      buffer = await Packer.toBuffer(docxFile);
    } catch (err) {
      res.status(500).json({
        error: 'FORMATTING_FAILED',
        message: `Formatting failed: ${err instanceof Error ? err.message : String(err)}`,
      });
      return;
    }
    // ── Output filename ───────────────────────────────────────────────────────
    const baseName = dotIdx >= 0 ? originalName.slice(0, dotIdx) : originalName;
    const safeBase = baseName.replace(/[^a-zA-Z0-9_\-. ]/g, '_').slice(0, 80);
    const outputFilename = `${safeBase}-formatted.docx`;
    // ── Stream response ───────────────────────────────────────────────────────
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${outputFilename}"`);
    res.setHeader('Content-Length', buffer.length);
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).end(buffer);
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
// Static client assets (production)
//
// Registered AFTER all /api and /trpc routes so API routes take precedence.
// In development, Vite serves the client on port 5173 and proxies /api and /trpc
// to this server. In production, this server serves the built dist/ assets on the
// same port, eliminating the need for a separate Vite process.
//
// Express version: 4.22.1 — app.get('*', ...) is safe on Express 4.
// The path-to-regexp wildcard issue only affects Express 5.
// ============================================================
const distPath = path.resolve(process.cwd(), 'dist');
app.use(express.static(distPath));
// SPA catch-all: any route not matched above returns index.html so that
// React Router can handle client-side navigation (e.g. /matters/:id).
app.get('*', (_req: Request, res: Response) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

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
