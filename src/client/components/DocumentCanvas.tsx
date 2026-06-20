/**
 * RELAYOUT-1 — DocumentCanvas + VersionSwitcher (pure presentational; no tRPC).
 *
 * The page-first remediation for the twice-blank DocumentDetail surface (#310 class).
 *
 * CARDINAL RULE (anti-#310, RELAYOUT spec v1.1 §1.3): the page sheet ALWAYS renders.
 * Only the body inside the sheet changes between states — there is NO state in which the
 * canvas collapses to blank. State precedence inside the sheet:
 *   generating -> no-version (empty) -> (defensive) no-selection -> empty-body -> document body.
 *
 * Typography/measure (§1.1): Fraunces 16px / 1.65, ink-black, block text; 720px TEXT measure
 * inside a sheet whose total width is text + generous side padding (~832px), centered, capped on
 * wide screens. Page edge = 1px warm hairline, radius <=2px, NO shadow (identity law). The
 * renderer does NOT invent legal formatting — it preserves the model's own line structure
 * (whitespace-pre-wrap) and only applies the page type tokens.
 */
import React from 'react';
import clsx from 'clsx';
import { FileText, ChevronDown, ArrowUp, Check } from 'lucide-react';
import {
  deriveVersionStatus,
  formatVersionLabel,
  type VersionStatusDoc,
} from '../utils/versionStatus.js';

// ============================================================
// VersionSwitcher — compact dropdown on the header version line.
// The visible label always reflects what the canvas is rendering (the SELECTED version),
// not the header counters (§1.2). Reading is never gated; selection swaps the canvas.
// ============================================================
export interface VersionSwitcherVersion {
  id: string;
  versionNumber: number;
  createdAt: string | Date;
}

export interface VersionSwitcherProps {
  /** Versions newest-first (version.list order). */
  versions: VersionSwitcherVersion[];
  selectedVersionId: string | null;
  doc: VersionStatusDoc;
  disabled?: boolean;
  onSelect: (versionId: string) => void;
}

export function VersionSwitcher(
  props: VersionSwitcherProps,
): React.ReactElement | null {
  const { versions, selectedVersionId, doc, disabled, onSelect } = props;
  const [open, setOpen] = React.useState(false);

  if (versions.length === 0) return null;
  const selected =
    versions.find((v) => v.id === selectedVersionId) ?? versions[0]!;

  return (
    <div className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        data-testid="version-switcher-button"
        aria-haspopup="listbox"
        aria-expanded={open}
        className="inline-flex items-center gap-1 text-xs text-ink-secondary hover:text-ink disabled:opacity-50"
      >
        {formatVersionLabel(selected, doc)}
        <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />
      </button>
      {open && !disabled && (
        <div
          role="listbox"
          data-testid="version-switcher-menu"
          className="absolute left-0 top-full mt-1 z-20 w-72 max-h-80 overflow-auto bg-surface border border-line rounded-[2px] shadow-sm"
        >
          {versions.map((v) => {
            const s = deriveVersionStatus(v, doc);
            const isSel = v.id === selected.id;
            return (
              <button
                key={v.id}
                role="option"
                aria-selected={isSel}
                onClick={() => {
                  onSelect(v.id);
                  setOpen(false);
                }}
                className={clsx(
                  'flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-surface-2 transition-colors',
                  isSel && 'bg-surface-2',
                )}
              >
                <span className="w-3.5 flex-shrink-0" aria-hidden="true">
                  {s.isCurrent && <Check className="w-3.5 h-3.5 text-success" />}
                </span>
                <span className="font-medium text-ink">v{v.versionNumber}</span>
                <span className="text-ink-hint">
                  {new Date(v.createdAt).toLocaleDateString()}
                </span>
                <span className="ml-auto text-ink-secondary">{s.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ============================================================
// DocumentCanvas — the always-present page sheet.
// ============================================================
export interface DocumentCanvasVersion {
  id: string;
  versionNumber: number;
  content: string;
  createdAt: string | Date;
}

export interface DocumentCanvasProps {
  /** The version selected to render. null when none is selected / none exist. */
  version: DocumentCanvasVersion | null;
  /** versions.length > 0 — distinguishes "no draft yet" from "a version is selected". */
  hasAnyVersion: boolean;
  /** True while a first-draft generation job is in flight (nothing to show yet). */
  isGenerating: boolean;
  /** True while version.list is still loading with nothing to show yet — renders the skeleton,
   *  never the empty state (a real draft must not flash "No draft yet" while its versions load). */
  isLoading?: boolean;
  /** Status label for the selected version (deriveVersionStatus). */
  statusLabel: string;
  /** True when the selected version is documents.currentVersionId. */
  isViewingCurrent: boolean;
  /** Current (latest) version number — for the not-current ribbon. */
  currentVersionNumber: number | null;
  /** Return-to-current handler (ribbon ghost link). */
  onReturnToCurrent: () => void;
  /** Retry handler for the error / empty-body state (ghost; never oxblood). */
  onRetry?: () => void;
  /**
   * No-version state: the mode-appropriate SINGLE oxblood primary (e.g. "Generate draft").
   * Promoting it here keeps one-oxblood-per-state and beats burying the only next act
   * in a collapsed strip (RELAYOUT spec v1.1 D1).
   */
  emptyStatePrimaryAction?: React.ReactNode;
  /** No-version state: optional outline headings, rendered as a faint, clearly-labeled scaffold. */
  outlineHeadings?: string[] | null;
  /**
   * F3 token streaming (DRAFT-STREAMING-1 Inc 2): the draft-so-far streamed text. When `isGenerating` and
   * this is non-empty, the sheet renders the progressive text in place of the bare skeleton. Display-only
   * — the persisted version still takes over on completion (poll/refetch). Empty/undefined = no stream
   * (the existing skeleton renders), so the non-streaming experience is unchanged.
   */
  streamingContent?: string;
  /** True while deltas are actively arriving — drives the streaming caret. */
  streamingActive?: boolean;
}

// Sheet: text measure + generous padding, centered, capped on wide screens; hairline, no shadow.
const SHEET =
  'mx-auto w-full max-w-[832px] bg-surface border border-line rounded-[2px] ' +
  'px-6 sm:px-10 lg:px-14 py-8 lg:py-12';
const MEASURE = 'mx-auto max-w-[720px]';

export default function DocumentCanvas(
  props: DocumentCanvasProps,
): React.ReactElement {
  const {
    version,
    hasAnyVersion,
    isGenerating,
    isLoading,
    statusLabel,
    isViewingCurrent,
    currentVersionNumber,
    onReturnToCurrent,
    onRetry,
    emptyStatePrimaryAction,
    outlineHeadings,
    streamingContent,
    streamingActive,
  } = props;

  let body: React.ReactElement;

  // F3 (DRAFT-STREAMING-1): once tokens are streaming for a generating draft, render the draft-so-far in
  // place of the bare skeleton (with a caret while deltas arrive). Empty/no-stream -> the skeleton below.
  const isStreamingDraft = isGenerating && typeof streamingContent === 'string' && streamingContent.length > 0;

  if (isStreamingDraft) {
    body = (
      <div className={MEASURE} data-testid="canvas-streaming">
        <div className="font-serif text-[16px] leading-[1.65] text-ink whitespace-pre-wrap">
          {streamingContent}
          {streamingActive && (
            <span
              data-testid="canvas-streaming-caret"
              className="inline-block w-[2px] h-[1.05em] -mb-[0.12em] ml-px bg-ink/70 animate-pulse"
              aria-hidden="true"
            />
          )}
        </div>
        <p className="mt-6 text-sm text-ink-secondary">Generating draft…</p>
      </div>
    );
  } else if (isGenerating || isLoading) {
    // Skeleton for BOTH the first-draft generating state and the version.list-loading window —
    // never blank, and never the "No draft yet" empty state while a real draft may still load.
    body = (
      <div className={MEASURE} data-testid={isGenerating ? 'canvas-generating' : 'canvas-loading'}>
        <div className="space-y-3 animate-pulse" aria-hidden="true">
          {[0, 1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className={clsx('h-4 rounded bg-line', i % 3 === 2 ? 'w-2/3' : 'w-full')}
            />
          ))}
        </div>
        <p className="mt-6 text-sm text-ink-secondary">
          {isGenerating ? 'Generating draft…' : 'Loading…'}
        </p>
      </div>
    );
  } else if (!hasAnyVersion) {
    body = (
      <div className={clsx(MEASURE, 'text-center')} data-testid="canvas-empty">
        <FileText
          className="w-8 h-8 text-ink-hint mx-auto mb-3"
          aria-hidden="true"
        />
        <p className="text-base text-ink-secondary mb-5">No draft yet.</p>
        {emptyStatePrimaryAction && (
          <div className="flex flex-col items-center gap-2">
            {emptyStatePrimaryAction}
          </div>
        )}
        {outlineHeadings && outlineHeadings.length > 0 && (
          <div className="mt-8 text-left" data-testid="canvas-outline-scaffold">
            <p className="text-xs uppercase tracking-wide text-ink-hint mb-2">
              Outline preview — not yet a draft
            </p>
            <ol className="space-y-1.5 opacity-50">
              {outlineHeadings.map((h, i) => (
                <li key={i} className="font-serif text-[15px] text-ink-secondary">
                  {i + 1}. {h}
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
    );
  } else if (!version) {
    // hasAnyVersion but nothing selected — defensive; the parent default-selects current.
    body = (
      <div className={clsx(MEASURE, 'text-center')} data-testid="canvas-noselection">
        <p className="text-sm text-ink-secondary">Loading the current version…</p>
      </div>
    );
  } else if (version.content.trim() === '') {
    // Error / empty-body version — never a page collapse, never an oxblood retry.
    body = (
      <div className={clsx(MEASURE, 'text-center')} data-testid="canvas-empty-body">
        <p className="text-sm text-ink-secondary mb-3">
          Version v{version.versionNumber} has no readable content.
        </p>
        {onRetry && (
          <button
            onClick={onRetry}
            className="px-3 py-1.5 text-xs border border-line text-ink rounded hover:bg-surface-2"
          >
            Retry
          </button>
        )}
      </div>
    );
  } else {
    body = (
      <div data-testid="canvas-body">
        {!isViewingCurrent && (
          <div
            data-testid="canvas-superseded-ribbon"
            className="mb-6 flex items-center justify-between gap-3 px-3 py-2 rounded-[2px] bg-warning-tint text-[13px] text-warning"
          >
            <span>
              Viewing v{version.versionNumber} ({statusLabel})
              {currentVersionNumber !== null && (
                <> — v{currentVersionNumber} is current</>
              )}
            </span>
            <button
              onClick={onReturnToCurrent}
              className="inline-flex items-center gap-1 hover:underline"
            >
              <ArrowUp className="w-3.5 h-3.5" aria-hidden="true" /> Return to current
            </button>
          </div>
        )}
        <div
          className={clsx(
            MEASURE,
            'font-serif text-[16px] leading-[1.65] text-ink whitespace-pre-wrap',
          )}
        >
          {version.content}
        </div>
      </div>
    );
  }

  return (
    <div className={SHEET} data-testid="document-canvas">
      {body}
    </div>
  );
}
