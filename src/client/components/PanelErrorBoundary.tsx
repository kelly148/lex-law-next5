/**
 * PanelErrorBoundary — FOLD-DRAFT-1 / FOLD-ORCH-1 hardening; Whereas R2-1 survivability.
 *
 * A render-error boundary for the review pane. A bug ANYWHERE it wraps (a hooks violation, a bad
 * render, a thrown error) is CONTAINED here and degrades to a designed notice — it can never blank
 * the review view again. (Root-caused after a React #310 in a newly-added panel blanked the
 * document review view on the first phase-3 deploy.)
 *
 * Two variants:
 *   - "inline" (default) — a small notice for a SIDE PANEL; the rest of the review keeps working.
 *   - "pane" — a full, centered notice for the WHOLE review-pane body (ActiveSessionView /
 *     CreateSessionView). It names what is still intact (draft + matter record; nothing sent) and
 *     gives a way out, so a crash in the view body degrades gracefully instead of white-screening.
 */
import React from 'react';

interface PanelErrorBoundaryProps {
  label: string;
  children: React.ReactNode;
  /** "inline" (default): small side-panel notice. "pane": full review-pane fallback. */
  variant?: 'inline' | 'pane';
  /** pane variant only — a way out of the failed pane (e.g. close + abandon the session). */
  onClose?: () => void;
}

interface PanelErrorBoundaryState {
  hasError: boolean;
}

export default class PanelErrorBoundary extends React.Component<
  PanelErrorBoundaryProps,
  PanelErrorBoundaryState
> {
  constructor(props: PanelErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): PanelErrorBoundaryState {
    return { hasError: true };
  }

  override componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // Surface to the console for diagnosis; never rethrow (containment).
    // eslint-disable-next-line no-console
    console.error(`[PanelErrorBoundary:${this.props.label}]`, error, info.componentStack);
  }

  override render(): React.ReactNode {
    if (this.state.hasError) {
      if (this.props.variant === 'pane') {
        return (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
            <p className="text-sm font-medium text-ink">
              This review view hit a display problem and was paused.
            </p>
            <p className="text-sm text-ink-secondary mt-2 max-w-sm">
              Your draft and the matter record are unaffected, and nothing has been sent — export stays
              blocked until a review is completed and adopted. Close this panel and reopen it to continue.
            </p>
            {this.props.onClose && (
              <button
                onClick={this.props.onClose}
                className="mt-5 px-4 py-2 text-sm border border-line text-ink rounded hover:bg-surface"
              >
                Close
              </button>
            )}
          </div>
        );
      }
      return (
        <div className="border-t border-gray-200 px-4 py-3 text-[11px] text-amber-800 bg-amber-50">
          The “{this.props.label}” panel hit an error and was hidden. The rest of this review is unaffected.
        </div>
      );
    }
    return this.props.children;
  }
}
