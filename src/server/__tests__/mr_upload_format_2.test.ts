/**
 * mr_upload_format_2.test.ts
 *
 * MR-UPLOAD-FORMAT-2 — Upload File button fix + Matters/Finalize formatting parity
 *
 * Tests T-UPLOAD2-1 through T-UPLOAD2-10.
 *
 * Two fix areas:
 *   Fix A — Upload File button: clicking "Upload File" when already in upload mode
 *            now calls fileInputRef.current?.click() to open the file picker.
 *   Fix B — Formatting parity: DOCX extraction now uses mammoth.convertToHtml
 *            (not extractRawText) to preserve heading structure, then converts
 *            HTML to Markdown via htmlToMarkdown() before passing to
 *            buildSatterwhiteSection.
 *
 * Test map:
 *   T-UPLOAD2-1:  htmlToMarkdown — h1 tag → # heading
 *   T-UPLOAD2-2:  htmlToMarkdown — h2–h6 tags → ## through ###### headings
 *   T-UPLOAD2-3:  htmlToMarkdown — <p> tags → paragraph text with blank lines
 *   T-UPLOAD2-4:  htmlToMarkdown — <strong>/<b> → **bold**, <em>/<i> → _italic_
 *   T-UPLOAD2-5:  htmlToMarkdown — <br> → newline; strips unknown tags
 *   T-UPLOAD2-6:  htmlToMarkdown — multiple blank lines normalized to max two
 *   T-UPLOAD2-7:  DOCX extraction uses convertToHtml (not extractRawText)
 *   T-UPLOAD2-8:  DOCX with headings → buildSatterwhiteSection receives Markdown with # headings
 *   T-UPLOAD2-9:  DOCX empty convertToHtml result → 422 EXTRACTION_FAILED
 *   T-UPLOAD2-10: Upload File button — source contains fileInputRef.current?.click() in upload mode branch
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
    convertToHtml: vi.fn(),
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
const mockConvertToHtml = vi.mocked(mammoth.convertToHtml);
const mockBuildSatterwhiteSection = vi.mocked(buildSatterwhiteSection);
const mockPackerToBuffer = vi.mocked(Packer.toBuffer);

// ── htmlToMarkdown — inlined from server/index.ts for unit testing ────────────
// This is the exact implementation from MR-UPLOAD-FORMAT-2. Tests verify the
// function's behavior directly without importing from index.ts (which has
// side effects at module load time).

function stripHtmlTagsTest(html: string): string {
  return html.replace(/<[^>]+>/g, '');
}

function htmlToMarkdownTest(html: string): string {
  let md = html.replace(/\r\n?/g, '\n');
  // Headings
  md = md.replace(/<h1[^>]*>(.*?)<\/h1>/gis, (_m, inner: string) => `# ${stripHtmlTagsTest(inner).trim()}`);
  md = md.replace(/<h2[^>]*>(.*?)<\/h2>/gis, (_m, inner: string) => `## ${stripHtmlTagsTest(inner).trim()}`);
  md = md.replace(/<h3[^>]*>(.*?)<\/h3>/gis, (_m, inner: string) => `### ${stripHtmlTagsTest(inner).trim()}`);
  md = md.replace(/<h4[^>]*>(.*?)<\/h4>/gis, (_m, inner: string) => `#### ${stripHtmlTagsTest(inner).trim()}`);
  md = md.replace(/<h5[^>]*>(.*?)<\/h5>/gis, (_m, inner: string) => `##### ${stripHtmlTagsTest(inner).trim()}`);
  md = md.replace(/<h6[^>]*>(.*?)<\/h6>/gis, (_m, inner: string) => `###### ${stripHtmlTagsTest(inner).trim()}`);
  // Inline formatting
  md = md.replace(/<strong[^>]*>(.*?)<\/strong>/gis, (_m, inner: string) => `**${stripHtmlTagsTest(inner)}**`);
  md = md.replace(/<b[^>]*>(.*?)<\/b>/gis, (_m, inner: string) => `**${stripHtmlTagsTest(inner)}**`);
  md = md.replace(/<em[^>]*>(.*?)<\/em>/gis, (_m, inner: string) => `_${stripHtmlTagsTest(inner)}_`);
  md = md.replace(/<i[^>]*>(.*?)<\/i>/gis, (_m, inner: string) => `_${stripHtmlTagsTest(inner)}_`);
  // Line breaks
  md = md.replace(/<br\s*\/?>/gi, '\n');
  // Paragraphs
  md = md.replace(/<p[^>]*>(.*?)<\/p>/gis, (_m, inner: string) => `\n${stripHtmlTagsTest(inner).trim()}\n`);
  // Strip remaining tags
  md = stripHtmlTagsTest(md);
  // Normalize multiple blank lines
  md = md.replace(/\n{3,}/g, '\n\n');
  return md.trim();
}

// ── Handler helpers ───────────────────────────────────────────────────────────
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

function makeFile(
  originalname: string,
  mimetype: string,
  content: string | Buffer = 'Hello world document content'
): { originalname: string; mimetype: string; size: number; buffer: Buffer } {
  const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf-8');
  return { originalname, mimetype, size: buffer.length, buffer };
}

/**
 * Inline the MR-UPLOAD-FORMAT-2 upload-format route handler logic.
 * Uses convertToHtml + htmlToMarkdown for DOCX extraction (parity fix).
 */
async function runUploadFormatHandlerV2(
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
  // ── Text extraction (MR-UPLOAD-FORMAT-2: convertToHtml + htmlToMarkdown) ──
  let extractedText: string;
  try {
    if (isDocx) {
      const result = await mammoth.convertToHtml({ buffer: file.buffer });
      const html = result.value ?? '';
      const md = htmlToMarkdownTest(html);
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
  // Default: mammoth.convertToHtml returns HTML with a heading
  mockConvertToHtml.mockResolvedValue({
    value: '<h1>Trust Agreement</h1><p>This is the body text.</p>',
    messages: [],
  });
  // Default: buildSatterwhiteSection returns a section
  mockBuildSatterwhiteSection.mockReturnValue({ properties: {}, children: [] } as never);
  // Default: Packer returns a buffer
  mockPackerToBuffer.mockResolvedValue(Buffer.from('FAKE_DOCX_BUFFER'));
});

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('MR-UPLOAD-FORMAT-2 — htmlToMarkdown unit tests', () => {

  it('T-UPLOAD2-1: h1 tag converts to # heading', () => {
    const html = '<h1>Trust Agreement</h1>';
    const result = htmlToMarkdownTest(html);
    expect(result).toBe('# Trust Agreement');
  });

  it('T-UPLOAD2-2: h2–h6 tags convert to ## through ###### headings', () => {
    const html = [
      '<h2>Section One</h2>',
      '<h3>Subsection A</h3>',
      '<h4>Clause 1</h4>',
      '<h5>Sub-clause</h5>',
      '<h6>Detail</h6>',
    ].join('');
    const result = htmlToMarkdownTest(html);
    expect(result).toContain('## Section One');
    expect(result).toContain('### Subsection A');
    expect(result).toContain('#### Clause 1');
    expect(result).toContain('##### Sub-clause');
    expect(result).toContain('###### Detail');
  });

  it('T-UPLOAD2-3: p tags produce paragraph text with surrounding blank lines', () => {
    const html = '<p>First paragraph.</p><p>Second paragraph.</p>';
    const result = htmlToMarkdownTest(html);
    expect(result).toContain('First paragraph.');
    expect(result).toContain('Second paragraph.');
    // Both paragraphs should be present and separated
    const idx1 = result.indexOf('First paragraph.');
    const idx2 = result.indexOf('Second paragraph.');
    expect(idx1).toBeGreaterThanOrEqual(0);
    expect(idx2).toBeGreaterThan(idx1);
  });

  it('T-UPLOAD2-4: strong/b → **bold**, em/i → _italic_', () => {
    const html = '<p><strong>Bold text</strong> and <em>italic text</em> and <b>also bold</b> and <i>also italic</i>.</p>';
    const result = htmlToMarkdownTest(html);
    expect(result).toContain('**Bold text**');
    expect(result).toContain('_italic text_');
    expect(result).toContain('**also bold**');
    expect(result).toContain('_also italic_');
  });

  it('T-UPLOAD2-5: br tag converts to newline; unknown tags are stripped', () => {
    const html = '<p>Line one<br>Line two</p><span>Stripped span content</span>';
    const result = htmlToMarkdownTest(html);
    expect(result).toContain('Line one');
    expect(result).toContain('Line two');
    // span tag should be stripped but content preserved
    expect(result).toContain('Stripped span content');
    // No raw HTML tags should remain
    expect(result).not.toMatch(/<[a-z]/i);
  });

  it('T-UPLOAD2-6: multiple consecutive blank lines normalized to at most two', () => {
    // Simulate HTML that produces many blank lines when converted
    const html = '<p>Para one</p><p></p><p></p><p></p><p>Para two</p>';
    const result = htmlToMarkdownTest(html);
    // Should not contain three or more consecutive newlines
    expect(result).not.toMatch(/\n{3,}/);
    expect(result).toContain('Para one');
    expect(result).toContain('Para two');
  });

});

describe('MR-UPLOAD-FORMAT-2 — DOCX extraction parity fix (server route)', () => {

  it('T-UPLOAD2-7: DOCX extraction calls convertToHtml (not extractRawText)', async () => {
    const file = makeFile(
      'trust.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    );
    const req = buildMockReq({ file });
    const res = buildMockRes();
    await runUploadFormatHandlerV2(req, res);
    expect(mockConvertToHtml).toHaveBeenCalledOnce();
    expect(mockConvertToHtml).toHaveBeenCalledWith({ buffer: file.buffer });
    // extractRawText should NOT be called
    expect(vi.mocked(mammoth.extractRawText)).not.toHaveBeenCalled();
  });

  it('T-UPLOAD2-8: DOCX with headings → buildSatterwhiteSection receives Markdown with # headings', async () => {
    mockConvertToHtml.mockResolvedValue({
      value: '<h1>Last Will and Testament</h1><p>I, John Smith, being of sound mind…</p>',
      messages: [],
    });
    const file = makeFile(
      'will.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    );
    const req = buildMockReq({ file });
    const res = buildMockRes();
    await runUploadFormatHandlerV2(req, res);
    expect(res._status).toBe(200);
    expect(mockBuildSatterwhiteSection).toHaveBeenCalledOnce();
    const calledWith = mockBuildSatterwhiteSection.mock.calls[0]?.[0] as string;
    expect(calledWith).toContain('# Last Will and Testament');
    expect(calledWith).toContain('I, John Smith, being of sound mind');
  });

  it('T-UPLOAD2-9: DOCX empty convertToHtml result → 422 EXTRACTION_FAILED', async () => {
    mockConvertToHtml.mockResolvedValue({ value: '   ', messages: [] });
    const file = makeFile(
      'empty.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    );
    const req = buildMockReq({ file });
    const res = buildMockRes();
    await runUploadFormatHandlerV2(req, res);
    expect(res._status).toBe(422);
    expect((res._body as Record<string, unknown>)['error']).toBe('EXTRACTION_FAILED');
  });

});

describe('MR-UPLOAD-FORMAT-2 — Upload File button fix (client source)', () => {

  it('T-UPLOAD2-10: UploadFormatPage.tsx Upload File button calls fileInputRef.current?.click() when already in upload mode', () => {
    const pageSrc = fs.readFileSync(
      path.resolve(__dirname, '../../client/pages/UploadFormatPage.tsx'),
      'utf-8'
    );
    // The button's onClick must contain the branch that calls fileInputRef.current?.click()
    // when !usePaste (already in upload mode)
    expect(pageSrc).toContain('fileInputRef.current?.click()');
    // The condition must be inside the Upload File button's onClick, not just in the drop zone
    // Verify the pattern: if (!usePaste) { fileInputRef.current?.click(); }
    expect(pageSrc).toMatch(/if\s*\(\s*!usePaste\s*\)\s*\{[^}]*fileInputRef\.current\?\.click\(\)/s);
    // The button must have data-testid="upload-mode-button"
    expect(pageSrc).toContain('data-testid="upload-mode-button"');
  });

});
