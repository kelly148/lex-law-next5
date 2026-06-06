// @vitest-environment jsdom
/**
 * R1-CLEANUP-1 — UploadFormatPage control retheme render test (ci-gotchas #10: render, don't trust tsc).
 *
 * Asserts the off-palette/off-spec controls are gone in the actual rendered DOM:
 *   - "Format Document" (the download-docx primary) renders as the oxblood primary (bg-accent /
 *     text-on-accent), not the old navy/blue fill;
 *   - the Upload/Paste segmented active state is a SUBTLE surface card (bg-surface / text-ink), not a
 *     heavy navy/black fill ("no loud highlight" — the app-shell rule).
 * UploadFormatPage depends only on React + lucide (no tRPC/router), so it renders with no mocks.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import UploadFormatPage from '../../pages/UploadFormatPage.js';

afterEach(() => cleanup());

describe('UploadFormatPage — R1-CLEANUP-1 control colors', () => {
  it('Format Document is the oxblood primary (accent), not navy/blue', () => {
    const { getByTestId } = render(<UploadFormatPage />);
    const btn = getByTestId('upload-format-button');
    expect(btn.className).toContain('bg-accent');
    expect(btn.className).toContain('text-on-accent');
    expect(btn.className).not.toContain('bg-firm-navy');
    expect(btn.className).not.toMatch(/bg-blue/);
  });

  it('segmented active state is a subtle surface card, not a heavy navy/black fill', () => {
    const { getByTestId } = render(<UploadFormatPage />);
    // default usePaste=false -> "Upload File" is the active segment
    const active = getByTestId('upload-mode-button');
    expect(active.className).toContain('bg-surface');
    expect(active.className).toContain('text-ink');
    expect(active.className).not.toContain('bg-firm-navy');
    expect(active.className).not.toContain('bg-black');
    expect(active.className).not.toContain('text-white');
  });

  it('toggling to Paste keeps the subtle-card active treatment (no navy/black)', () => {
    const { getByTestId, getByText } = render(<UploadFormatPage />);
    fireEvent.click(getByText('Paste Text / Markdown'));
    // now Upload File is inactive: muted, no surface fill
    const uploadBtn = getByTestId('upload-mode-button');
    expect(uploadBtn.className).toContain('text-ink-secondary');
    expect(uploadBtn.className).not.toContain('bg-firm-navy');
  });
});
