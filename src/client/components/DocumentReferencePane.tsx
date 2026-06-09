/**
 * DocumentReferencePane — RELAYOUT-3 (Scope A).
 *
 * The READ-ONLY document reference shown beside the review pane at desktop width. It REUSES the
 * shipped DocumentCanvas renderer (never forked) at a compact ~600-620px measure (container-
 * constrained), current-version only, with ZERO actions — no version switcher, no Accept, no
 * oxblood. It is a reference surface: the provision under review, one gesture away.
 *
 * Anchoring (disposition §2): when a feedback item is focused in the review pane, the workspace
 * passes the focused provision's quote down as `anchorQuote`; this pane scrolls it into view and
 * briefly highlights it. This is a DOC-PANE-ONLY side effect — it never touches review state.
 * Best-effort text match (the review tree stays byte-identical, so no anchor ids are emitted).
 *
 * Rules of Hooks: all hooks run every render before any early return.
 */
import React, { useEffect, useRef } from 'react';
import DocumentCanvas from './DocumentCanvas.js';

interface DocumentReferencePaneProps {
  documentId: string;
  /** The verbatim quote of the currently focused feedback item, or null. Doc-pane-only. */
  anchorQuote: string | null;
  /** Injected query results (the workspace owns the reads so the pane stays presentational). */
  version: { id: string; versionNumber: number; content: string; createdAt: string | Date } | null;
  hasAnyVersion: boolean;
  isLoading: boolean;
}

/** Normalize a string for loose substring matching (collapse whitespace, lowercase). */
function norm(s: string): string {
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

export default function DocumentReferencePane({
  documentId: _documentId,
  anchorQuote,
  version,
  hasAnyVersion,
  isLoading,
}: DocumentReferencePaneProps): React.ReactElement {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Anchoring: scroll the matching provision into view + flash a highlight. Doc-pane-only; never
  // mutates review state. Best-effort substring match over the rendered text nodes.
  useEffect(() => {
    const root = scrollRef.current;
    if (!root || !anchorQuote) return;
    const needle = norm(anchorQuote).slice(0, 48);
    if (needle.length < 8) return;
    const candidates = root.querySelectorAll<HTMLElement>('p, li, h1, h2, h3, div');
    let target: HTMLElement | null = null;
    for (const el of candidates) {
      if (el.children.length === 0 && norm(el.textContent ?? '').includes(needle)) {
        target = el;
        break;
      }
    }
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target.setAttribute('data-anchor-highlight', 'true');
    const t = window.setTimeout(() => target?.removeAttribute('data-anchor-highlight'), 1600);
    return () => window.clearTimeout(t);
  }, [anchorQuote]);

  return (
    <div
      ref={scrollRef}
      className="h-full overflow-y-auto bg-paper px-4 py-6 [&_[data-anchor-highlight]]:bg-warning-tint [&_[data-anchor-highlight]]:transition-colors"
      data-testid="review-doc-pane"
      aria-label="Document under review (read-only reference)"
    >
      {/* REVIEW-UX-REDESIGN-1-FIX: the document FILLS its pane (no centered max-width column) — use all the
          space we gave it; the body is already the darkest ink (text-ink). */}
      <div className="w-full">
        <DocumentCanvas
          version={version}
          hasAnyVersion={hasAnyVersion}
          isGenerating={false}
          isLoading={isLoading}
          statusLabel="current"
          isViewingCurrent={true}
          currentVersionNumber={version?.versionNumber ?? null}
          onReturnToCurrent={() => {}}
        />
      </div>
    </div>
  );
}
