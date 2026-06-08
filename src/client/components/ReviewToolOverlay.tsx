/**
 * ReviewToolOverlay — REVIEW-UX-REDESIGN-1
 *
 * A lightweight floating overlay for the review session's on-demand REFERENCE tools (provision
 * provenance, LOI-vs-draft, adopt ledger, prior-feedback history, reviewer convergence detail,
 * locked-decision management). Per disposition §G the review pane keeps its full width — nothing is
 * docked — so these tools float OVER the content with ZERO permanent width, open from a header icon
 * button, and close on Escape or a backdrop click. Sync-only and presentational: it owns no data,
 * rendering whatever tool content is passed as children.
 *
 * Accessibility: role="dialog" + aria-modal, an accessible name from the title, initial focus moved
 * to the panel, and a labeled close control.
 */
import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

interface ReviewToolOverlayProps {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}

export default function ReviewToolOverlay({ title, onClose, children }: ReviewToolOverlayProps): React.ReactElement {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    // Move focus onto the panel so Escape works immediately and the overlay is announced.
    panelRef.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-ink/30"
      data-testid="review-tool-overlay"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="h-full w-full max-w-md bg-paper border-l border-line shadow-xl flex flex-col outline-none"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-line bg-surface-2 flex-shrink-0">
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="text-ink-secondary hover:text-ink">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
