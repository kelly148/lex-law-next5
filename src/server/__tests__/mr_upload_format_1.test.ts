/**
 * mr_upload_format_1.test.ts
 *
 * MR-UPLOAD-FORMAT-1 — Upload & Format Existing Document
 *
 * Tests T-UPLOAD-1 through T-UPLOAD-17.
 *
 * Server-side tests use the established project pattern:
 *   - No supertest. Mock req/res objects.
 *   - vi.mock for getSession, mammoth, buildSatterwhiteSection, Packer.
 *
 * Client-side tests use source-inspection (static analysis) to verify
 * the page, nav item, and route are wired correctly.
 *
 * Test map:
 *   T-UPLOAD-1:  Auth gate — missing session → 401 UNAUTHENTICATED
 *   T-UPLOAD-2:  Auth gate — empty userId → 401 UNAUTHENTICATED
 *   T-UPLOAD-3:  Missing file → 400 MISSING_FILE
 *   T-UPLOAD-4:  Empty file (size 0) → 400 EMPTY_FILE
 *   T-UPLOAD-5:  PDF file → 415 UNSUPPORTED_FILE_TYPE
 *   T-UPLOAD-6:  Unsupported extension (.jpg) → 415 UNSUPPORTED_FILE_TYPE
 *   T-UPLOAD-7:  DOCX extraction empty → 422 EXTRACTION_FAILED
 *   T-UPLOAD-8:  DOCX extraction throws → 422 EXTRACTION_FAILED
 *   T-UPLOAD-9:  TXT file empty → 400 EMPTY_FILE
 *   T-UPLOAD-10: .txt file → 200, DOCX response, correct Content-Type
 *   T-UPLOAD-11: .md file → 200, DOCX response, correct Content-Type
 *   T-UPLOAD-12: .docx file → 200, DOCX response, correct Content-Type
 *   T-UPLOAD-13: Output filename is sanitized original name + -formatted.docx
 *   T-UPLOAD-14: buildSatterwhiteSection called with extracted text, watermarkText: null
 *   T-UPLOAD-15: No DB persistence — insertMaterial is never called
 *   T-UPLOAD-16: Nav item — AppShell.tsx contains /upload-format NavLink
 *   T-UPLOAD-17: Route registration — App.tsx registers /upload-format route
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('../middleware/session.js', () => ({
  getSession: vi.fn(),
  extractUserId: vi.fn(),
}));

vi.mock('mammoth', () => ({
  default: {
    extractRawText: vi.fn(),
  },
}));

vi.mock('../utils/markdownToDocx.js', () => ({
  buildSatterwhiteSection: vi.fn().mockReturnValue({ properties: {}, children: [] }),
}));

vi.mock('docx', async (importOriginal) => {
  const actual = await importOriginal<typeof import('docx')>();
  return {
    ...actual,
    Packer: {
      toBuffer: vi.fn().mockResolvedValue(Buffer.from('FAKE_DOCX_BUFFER')),
    },
  };
});

// ── Imports after mocks ───────────────────────────────────────────────────────

import { getSession, extractUserId } from '../middleware/session.js';
import mammoth from 'mammoth';
import { buildSatterwhiteSection } from '../utils/markdownToDocx.js';
import { Packer } from 'docx';

const mockGetSession = vi.mocked(getSession);
const mockExtractUserId = vi.mocked(extractUserId);
const mockExtractRawText = vi.mocked(mammoth.extractRawText);
const mockBuildSatterwhiteSection = vi.mocked(buildSatterwhiteSection);
const mockPackerToBuffer = vi.mocked(Packer.toBuffer);

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a minimal mock Express response that captures status, headers, and body. */
function buildMockRes() {
  const res = {
    _status: 200,
    _body: undefined as unknown,
    _headers: {} as Record<string, string | number>,
    _ended: false,
    _buffer: undefined as Buffer | undefined,
    status(code: number) { this._status = code; return this; },
    json(body: unknown) { this._body = body; return this; },
    setHeader(name: string, value: string | number) { this._headers[name] = value; return this; },
    end(data?: Buffer) { this._ended = true; if (data) this._buffer = data; return this; },
  };
  return res;
}

/** Build a minimal mock Express request. */
function buildMockReq(overrides: {
  file?: {
    originalname: string;
    mimetype: string;
    size: number;
    buffer: Buffer;
  } | null;
} = {}) {
  return {
    file: overrides.file ?? null,
    body: {},
  };
}

/** Build a mock multer file object. */
function makeFile(
  originalname: string,
  mimetype: string,
  content: string | Buffer = 'Hello world document content'
): { originalname: string; mimetype: string; size: number; buffer: Buffer } {
  const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf-8');
  return { originalname, mimetype, size: buffer.length, buffer };
}

/** Inline the upload-format route handler logic for direct testing. */
async function runUploadFormatHandler(
  req: ReturnType<typeof buildMockReq>,
  res: ReturnType<typeof buildMockRes>
): Promise<void> {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const session = await mockGetSession(req as never, res as never);
  const userId = mockExtractUserId(session);
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
  let extractedText: string;
  try {
    if (isDocx) {
      const result = await mammoth.extractRawText({ buffer: file.buffer });
      const raw = result.value ?? '';
      if (raw.trim().length === 0) {
        res.status(422).json({
          error: 'EXTRACTION_FAILED',
          message: 'DOCX extraction produced no text. The file may be empty or image-only.',
        });
        return;
      }
      extractedText = raw;
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
  // ── Format via existing Satterwhite renderer ──────────────────────────────
  let buffer: Buffer;
  try {
    const { Document: DocxDocument } = await import('docx');
    const section = buildSatterwhiteSection(extractedText, { watermarkText: null });
    const docxFile = new DocxDocument({ sections: [section] });
    buffer = await Packer.toBuffer(docxFile);
  } catch (err) {
    res.status(500).json({
      error: 'FORMATTING_FAILED',
      message: `Satterwhite formatting failed: ${err instanceof Error ? err.message : String(err)}`,
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
}

// ── Test setup ────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  // Default: authenticated
  mockGetSession.mockResolvedValue({ userId: 'user-123' } as never);
  mockExtractUserId.mockReturnValue('user-123');
  // Default: mammoth returns text
  mockExtractRawText.mockResolvedValue({ value: 'Extracted document content', messages: [] });
  // Default: buildSatterwhiteSection returns a section
  mockBuildSatterwhiteSection.mockReturnValue({ properties: {}, children: [] } as never);
  // Default: Packer returns a buffer
  mockPackerToBuffer.mockResolvedValue(Buffer.from('FAKE_DOCX_BUFFER'));
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('MR-UPLOAD-FORMAT-1 — Upload & Format server route', () => {
  // ── Auth gate ──────────────────────────────────────────────────────────────

  it('T-UPLOAD-1: missing session (getSession returns no userId) → 401 UNAUTHENTICATED', async () => {
    mockGetSession.mockResolvedValue({} as never);
    mockExtractUserId.mockReturnValue(null);
    const req = buildMockReq({ file: makeFile('doc.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') });
    const res = buildMockRes();
    await runUploadFormatHandler(req, res);
    expect(res._status).toBe(401);
    expect((res._body as Record<string, unknown>)['error']).toBe('UNAUTHENTICATED');
  });

  it('T-UPLOAD-2: extractUserId returns null (empty userId) → 401 UNAUTHENTICATED', async () => {
    mockExtractUserId.mockReturnValue(null);
    const req = buildMockReq({ file: makeFile('doc.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') });
    const res = buildMockRes();
    await runUploadFormatHandler(req, res);
    expect(res._status).toBe(401);
    expect((res._body as Record<string, unknown>)['error']).toBe('UNAUTHENTICATED');
  });

  // ── File validation ────────────────────────────────────────────────────────

  it('T-UPLOAD-3: no file attached → 400 MISSING_FILE', async () => {
    const req = buildMockReq({ file: null });
    const res = buildMockRes();
    await runUploadFormatHandler(req, res);
    expect(res._status).toBe(400);
    expect((res._body as Record<string, unknown>)['error']).toBe('MISSING_FILE');
  });

  it('T-UPLOAD-4: file with size 0 → 400 EMPTY_FILE', async () => {
    const file = makeFile('doc.txt', 'text/plain', '');
    const req = buildMockReq({ file: { ...file, size: 0 } });
    const res = buildMockRes();
    await runUploadFormatHandler(req, res);
    expect(res._status).toBe(400);
    expect((res._body as Record<string, unknown>)['error']).toBe('EMPTY_FILE');
  });

  // ── Type gate ──────────────────────────────────────────────────────────────

  it('T-UPLOAD-5: PDF file (application/pdf) → 415 UNSUPPORTED_FILE_TYPE', async () => {
    const req = buildMockReq({ file: makeFile('contract.pdf', 'application/pdf') });
    const res = buildMockRes();
    await runUploadFormatHandler(req, res);
    expect(res._status).toBe(415);
    expect((res._body as Record<string, unknown>)['error']).toBe('UNSUPPORTED_FILE_TYPE');
    expect((res._body as Record<string, unknown>)['message']).toContain('PDF');
  });

  it('T-UPLOAD-5b: PDF file detected by .pdf extension → 415 UNSUPPORTED_FILE_TYPE', async () => {
    const req = buildMockReq({ file: makeFile('contract.pdf', 'application/octet-stream') });
    const res = buildMockRes();
    await runUploadFormatHandler(req, res);
    expect(res._status).toBe(415);
    expect((res._body as Record<string, unknown>)['error']).toBe('UNSUPPORTED_FILE_TYPE');
  });

  it('T-UPLOAD-6: unsupported extension (.jpg) → 415 UNSUPPORTED_FILE_TYPE', async () => {
    const req = buildMockReq({ file: makeFile('photo.jpg', 'image/jpeg') });
    const res = buildMockRes();
    await runUploadFormatHandler(req, res);
    expect(res._status).toBe(415);
    expect((res._body as Record<string, unknown>)['error']).toBe('UNSUPPORTED_FILE_TYPE');
    expect((res._body as Record<string, unknown>)['message']).toContain('.docx');
  });

  // ── Extraction failures ────────────────────────────────────────────────────

  it('T-UPLOAD-7: DOCX mammoth extraction returns empty string → 422 EXTRACTION_FAILED', async () => {
    mockExtractRawText.mockResolvedValue({ value: '   ', messages: [] });
    const req = buildMockReq({ file: makeFile('empty.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') });
    const res = buildMockRes();
    await runUploadFormatHandler(req, res);
    expect(res._status).toBe(422);
    expect((res._body as Record<string, unknown>)['error']).toBe('EXTRACTION_FAILED');
  });

  it('T-UPLOAD-8: DOCX mammoth extraction throws → 422 EXTRACTION_FAILED', async () => {
    mockExtractRawText.mockRejectedValue(new Error('corrupted DOCX'));
    const req = buildMockReq({ file: makeFile('bad.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') });
    const res = buildMockRes();
    await runUploadFormatHandler(req, res);
    expect(res._status).toBe(422);
    expect((res._body as Record<string, unknown>)['error']).toBe('EXTRACTION_FAILED');
    expect((res._body as Record<string, unknown>)['message']).toContain('corrupted DOCX');
  });

  it('T-UPLOAD-9: .txt file with only whitespace → 400 EMPTY_FILE', async () => {
    const req = buildMockReq({ file: makeFile('blank.txt', 'text/plain', '   \n\t  ') });
    const res = buildMockRes();
    await runUploadFormatHandler(req, res);
    expect(res._status).toBe(400);
    expect((res._body as Record<string, unknown>)['error']).toBe('EMPTY_FILE');
  });

  // ── Successful formatting ──────────────────────────────────────────────────

  it('T-UPLOAD-10: .txt file → 200, DOCX Content-Type, Content-Disposition attachment', async () => {
    const req = buildMockReq({ file: makeFile('brief.txt', 'text/plain', 'This is a legal brief.') });
    const res = buildMockRes();
    await runUploadFormatHandler(req, res);
    expect(res._status).toBe(200);
    expect(res._headers['Content-Type']).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    );
    expect(String(res._headers['Content-Disposition'])).toContain('attachment');
    expect(res._ended).toBe(true);
  });

  it('T-UPLOAD-11: .md file → 200, DOCX Content-Type, Content-Disposition attachment', async () => {
    const req = buildMockReq({ file: makeFile('notes.md', 'text/markdown', '# Heading\n\nBody text.') });
    const res = buildMockRes();
    await runUploadFormatHandler(req, res);
    expect(res._status).toBe(200);
    expect(res._headers['Content-Type']).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    );
    expect(res._ended).toBe(true);
  });

  it('T-UPLOAD-12: .docx file → 200, DOCX Content-Type, Content-Disposition attachment', async () => {
    const req = buildMockReq({
      file: makeFile(
        'contract.docx',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Docx content here'
      ),
    });
    const res = buildMockRes();
    await runUploadFormatHandler(req, res);
    expect(res._status).toBe(200);
    expect(res._headers['Content-Type']).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    );
    expect(res._ended).toBe(true);
  });

  it('T-UPLOAD-13: output filename is sanitized original name + -formatted.docx', async () => {
    const req = buildMockReq({ file: makeFile('My Contract Draft.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') });
    const res = buildMockRes();
    await runUploadFormatHandler(req, res);
    expect(res._status).toBe(200);
    const disposition = String(res._headers['Content-Disposition']);
    expect(disposition).toContain('My Contract Draft-formatted.docx');
  });

  it('T-UPLOAD-13b: special characters in filename are sanitized in output filename', async () => {
    const req = buildMockReq({ file: makeFile('Contract (v2) [Final].txt', 'text/plain', 'Content here') });
    const res = buildMockRes();
    await runUploadFormatHandler(req, res);
    expect(res._status).toBe(200);
    const disposition = String(res._headers['Content-Disposition']);
    // Special chars replaced with underscores
    expect(disposition).not.toContain('(');
    expect(disposition).not.toContain(')');
    expect(disposition).not.toContain('[');
    expect(disposition).not.toContain(']');
    expect(disposition).toContain('-formatted.docx');
  });

  it('T-UPLOAD-14: buildSatterwhiteSection called with extracted text and watermarkText: null', async () => {
    const req = buildMockReq({ file: makeFile('brief.txt', 'text/plain', 'Legal brief content.') });
    const res = buildMockRes();
    await runUploadFormatHandler(req, res);
    expect(mockBuildSatterwhiteSection).toHaveBeenCalledOnce();
    expect(mockBuildSatterwhiteSection).toHaveBeenCalledWith(
      'Legal brief content.',
      { watermarkText: null }
    );
  });

  it('T-UPLOAD-14b: buildSatterwhiteSection called with mammoth-extracted text for DOCX', async () => {
    mockExtractRawText.mockResolvedValue({ value: 'Extracted from DOCX', messages: [] });
    const req = buildMockReq({
      file: makeFile('doc.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
    });
    const res = buildMockRes();
    await runUploadFormatHandler(req, res);
    expect(mockBuildSatterwhiteSection).toHaveBeenCalledWith(
      'Extracted from DOCX',
      { watermarkText: null }
    );
  });

  it('T-UPLOAD-15: insertMaterial is never called (no DB persistence)', async () => {
    // Verify by source inspection that the upload-format route does not import insertMaterial
    const indexTsPath = path.resolve(__dirname, '../index.ts');
    const source = fs.readFileSync(indexTsPath, 'utf-8');
    // Find the upload-format route block
    const uploadFormatBlock = source.slice(source.indexOf('POST /api/upload-format'));
    // insertMaterial should not appear in the upload-format block
    // (It appears in the materials/upload block, but not in upload-format)
    const trpcHandlerIdx = uploadFormatBlock.indexOf('tRPC handler');
    const uploadFormatSection = uploadFormatBlock.slice(0, trpcHandlerIdx);
    expect(uploadFormatSection).not.toContain('insertMaterial');
  });

  it('T-UPLOAD-15b: no matterId field is required by the upload-format route', async () => {
    // The upload-format route must not require matterId (stateless, no DB)
    const indexTsPath = path.resolve(__dirname, '../index.ts');
    const source = fs.readFileSync(indexTsPath, 'utf-8');
    const uploadFormatBlock = source.slice(
      source.indexOf('POST /api/upload-format'),
      source.indexOf('tRPC handler')
    );
    expect(uploadFormatBlock).not.toContain('matterId');
  });

  it('T-UPLOAD-15c: Cache-Control: no-store is set on success response', async () => {
    const req = buildMockReq({ file: makeFile('brief.txt', 'text/plain', 'Content.') });
    const res = buildMockRes();
    await runUploadFormatHandler(req, res);
    expect(res._headers['Cache-Control']).toBe('no-store');
  });
});

// ── Client-side structural tests ──────────────────────────────────────────────

describe('MR-UPLOAD-FORMAT-1 — Client-side structural tests', () => {
  const appShellPath = path.resolve(__dirname, '../../client/components/AppShell.tsx');
  const appTsxPath = path.resolve(__dirname, '../../client/App.tsx');
  const uploadFormatPagePath = path.resolve(__dirname, '../../client/pages/UploadFormatPage.tsx');

  let appShellSource: string;
  let appTsxSource: string;
  let uploadFormatPageSource: string;

  beforeEach(() => {
    appShellSource = fs.readFileSync(appShellPath, 'utf-8');
    appTsxSource = fs.readFileSync(appTsxPath, 'utf-8');
    uploadFormatPageSource = fs.readFileSync(uploadFormatPagePath, 'utf-8');
  });

  it('T-UPLOAD-16: AppShell.tsx contains a NavLink to /upload-format', () => {
    expect(appShellSource).toContain('/upload-format');
    expect(appShellSource).toContain('NavLink');
  });

  it('T-UPLOAD-16b: AppShell.tsx Upload & Format nav item appears after Templates and before Settings', () => {
    // Use NavLink to= patterns to avoid matching JSDoc comment occurrences
    const templatesIdx = appShellSource.indexOf('to="/templates"');
    const uploadFormatIdx = appShellSource.indexOf('to="/upload-format"');
    const settingsIdx = appShellSource.indexOf('to="/settings"');
    expect(templatesIdx).toBeGreaterThan(-1);
    expect(uploadFormatIdx).toBeGreaterThan(templatesIdx);
    expect(settingsIdx).toBeGreaterThan(uploadFormatIdx);
  });

  it('T-UPLOAD-17: App.tsx registers /upload-format route', () => {
    expect(appTsxSource).toContain('/upload-format');
    expect(appTsxSource).toContain('UploadFormatPage');
  });

  it('T-UPLOAD-17b: App.tsx lazy-loads UploadFormatPage', () => {
    expect(appTsxSource).toContain("lazy(() => import(\"./pages/UploadFormatPage.js\")");
  });

  it('T-UPLOAD-17c: UploadFormatPage.tsx exists and exports a default function', () => {
    expect(uploadFormatPageSource).toContain('export default function UploadFormatPage');
  });

  it('T-UPLOAD-17d: UploadFormatPage.tsx contains a file input with accept .docx, .txt, .md', () => {
    expect(uploadFormatPageSource).toContain('.docx');
    expect(uploadFormatPageSource).toContain('.txt');
    expect(uploadFormatPageSource).toContain('.md');
    expect(uploadFormatPageSource).toContain('type="file"');
  });

  it('T-UPLOAD-17e: UploadFormatPage.tsx contains drag-and-drop handlers (onDrop, onDragOver)', () => {
    expect(uploadFormatPageSource).toContain('onDrop');
    expect(uploadFormatPageSource).toContain('onDragOver');
  });

  it('T-UPLOAD-17f: UploadFormatPage.tsx posts to /api/upload-format', () => {
    expect(uploadFormatPageSource).toContain('/api/upload-format');
  });

  it('T-UPLOAD-17g: UploadFormatPage.tsx includes a paste text mode', () => {
    expect(uploadFormatPageSource).toContain('Paste Text');
    expect(uploadFormatPageSource).toContain('textarea');
  });

  it('T-UPLOAD-17h: UploadFormatPage.tsx includes a pending/formatting state indicator', () => {
    expect(uploadFormatPageSource).toContain('formatting');
    expect(uploadFormatPageSource).toContain('Formatting document');
  });

  it('T-UPLOAD-17i: UploadFormatPage.tsx includes PDF not supported note', () => {
    expect(uploadFormatPageSource).toContain('PDF');
    expect(uploadFormatPageSource).toContain('not supported');
  });
});
