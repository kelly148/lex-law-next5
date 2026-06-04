/**
 * PanelErrorBoundary — FOLD-DRAFT-1 / FOLD-ORCH-1 hardening.
 *
 * A render-error boundary for the review-pane side panels. A bug in ANY single panel (a hooks
 * violation, a bad render, a thrown error) is CONTAINED here and degrades to a small inline
 * notice — it can never blank the whole review view again. The rest of the review pane keeps
 * working. (Root-caused after a React #310 in a newly-added panel blanked the document review
 * view on the first phase-3 deploy.)
 */
import React from 'react';

interface PanelErrorBoundaryProps {
  label: string;
  children: React.ReactNode;
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
      return (
        <div className="border-t border-gray-200 px-4 py-3 text-[11px] text-amber-800 bg-amber-50">
          The “{this.props.label}” panel hit an error and was hidden. The rest of this review is unaffected.
        </div>
      );
    }
    return this.props.children;
  }
}
