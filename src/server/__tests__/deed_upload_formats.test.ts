/**
 * deed_upload_formats.test.ts — MONSTER BUILD 2 E2: the shared upload-format routing (server endpoint + client
 * dropzone consume the SAME module, so this guards them both against drift). Pure; no OCR/file deps.
 */
import { describe, it, expect } from 'vitest';
import {
  routeUploadFormat,
  isAcceptedUpload,
  ACCEPTED_UPLOAD_EXTENSIONS,
  ACCEPTED_UPLOAD_MIME,
  ACCEPTED_UPLOAD_ATTR,
  UNSUPPORTED_NEEDS_DEP,
} from '../../shared/deedUploadFormats.js';

describe('deedUploadFormats — E2 routing', () => {
  it('routes the already-supported (MATERIALS-DROPZONE-1) formats unchanged', () => {
    expect(routeUploadFormat('application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'docx')).toBe('docx');
    expect(routeUploadFormat('text/plain', 'txt')).toBe('text');
    expect(routeUploadFormat('application/pdf', 'pdf')).toBe('pdf');
    expect(routeUploadFormat('image/png', 'png')).toBe('image');
    expect(routeUploadFormat('image/jpeg', 'jpg')).toBe('image');
    expect(routeUploadFormat('image/jpeg', 'jpeg')).toBe('image');
  });

  it('E2 widens: .md -> text; .tif/.tiff/.webp -> image (OCR)', () => {
    expect(routeUploadFormat('text/markdown', 'md')).toBe('text');
    expect(routeUploadFormat(null, 'md')).toBe('text');
    expect(routeUploadFormat('image/tiff', 'tif')).toBe('image');
    expect(routeUploadFormat(null, 'tiff')).toBe('image');
    expect(routeUploadFormat('image/webp', 'webp')).toBe('image');
  });

  it('extension wins over an unknown/missing MIME; MIME is the fallback; leading dot tolerated', () => {
    expect(routeUploadFormat('application/octet-stream', 'pdf')).toBe('pdf'); // ext wins over generic mime
    expect(routeUploadFormat('application/pdf', '')).toBe('pdf'); // mime fallback when no ext
    expect(routeUploadFormat('image/png', 'unknownext')).toBe('image'); // unknown ext -> mime fallback
    expect(routeUploadFormat(null, '.docx')).toBe('docx'); // leading dot stripped
    expect(routeUploadFormat(undefined, undefined)).toBe('unsupported');
  });

  it('.doc and .heic are NOT accepted (each needs a new dependency — operator-gated, surfaced)', () => {
    expect(routeUploadFormat('application/msword', 'doc')).toBe('unsupported');
    expect(routeUploadFormat('image/heic', 'heic')).toBe('unsupported');
    expect(isAcceptedUpload(null, 'doc')).toBe(false);
    expect(isAcceptedUpload('image/heic', 'heic')).toBe(false);
    expect([...UNSUPPORTED_NEEDS_DEP].sort()).toEqual(['doc', 'heic']);
  });

  it('the accepted lists + accept attribute cover the widened set', () => {
    for (const x of ['docx', 'txt', 'md', 'pdf', 'png', 'jpg', 'jpeg', 'tif', 'tiff', 'webp']) {
      expect(ACCEPTED_UPLOAD_EXTENSIONS).toContain(x);
      expect(ACCEPTED_UPLOAD_ATTR).toContain(`.${x}`);
      expect(isAcceptedUpload(null, x)).toBe(true);
    }
    expect(ACCEPTED_UPLOAD_MIME).toContain('text/markdown');
    expect(ACCEPTED_UPLOAD_MIME).toContain('image/tiff');
    expect(ACCEPTED_UPLOAD_MIME).toContain('image/webp');
  });
});
