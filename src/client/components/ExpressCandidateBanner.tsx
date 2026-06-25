/**
 * ExpressCandidateBanner — EXPRESS-AUTO-REVIEW-LOOP-1 E7a: the "NOT FINAL" disclosure banner.
 *
 * A prominent, non-dismissible disclosure for an Express loop candidate: it is NOT final, sendable, fileable,
 * or recordable, and the attorney must review and AFFIRMATIVELY approve every escalation before the draft can
 * proceed. The banner shows the count of unresolved (risk-ranked) escalations and reflects the structural
 * can't-approve-yet vs. approve-enabled state derived by the E7a server guard (evaluateExpressApproval).
 *
 * PURE PRESENTATIONAL — props-driven only. It makes NO trpc call, holds NO state, persists NOTHING, and never
 * decides approval itself; the SERVER guard (approvalGate.ts) is the structural truth and supplies canApprove +
 * the unresolved escalations. This component only DISCLOSES that truth. Mirrors the house Tailwind banner style
 * (cf. ConflictPostureChip's standing banner). Flag-dark: the parent only renders it for an Express candidate.
 */
import React from 'react';
import { ShieldAlert, ShieldCheck } from 'lucide-react';

/** One unresolved escalation, as the banner needs to LIST it (a presentational subset of the E4a LedgerEntry). */
export interface ExpressBannerEscalation {
  /** The stable ledger-entry id (audit linkage; also the React list key). */
  id: string;
  /** The coarse risk bucket for the at-a-glance triage colour. */
  riskBucket: 'high' | 'medium' | 'low';
  /** A short human label for the escalation (e.g. the locus reason) — display only. */
  reason: string;
}

export interface ExpressCandidateBannerProps {
  /**
   * Whether the attorney is STRUCTURALLY permitted to mark the candidate ready — straight from the E7a server
   * guard (evaluateExpressApproval). FALSE while any escalation is unresolved. The banner renders the
   * can't-approve-yet state when false, the approve-enabled state when true.
   */
  canApprove: boolean;
  /** The unresolved escalations, already risk-ranked by the server (E4a order). The banner shows the count + list. */
  unresolvedEscalations: readonly ExpressBannerEscalation[];
  /**
   * Optional approve handler. Wired by a parent in a later increment; in E7a the banner is a reusable disclosure
   * component and the button is inert unless a handler is supplied. The button is ALWAYS disabled while
   * !canApprove — the structural inertness is reflected in the UI, not just the server.
   */
  onApprove?: (() => void) | undefined;
}

/** Per-bucket dot colour for the escalation list (at-a-glance triage; display only). */
const BUCKET_DOT: Record<ExpressBannerEscalation['riskBucket'], string> = {
  high: 'bg-red-500',
  medium: 'bg-amber-500',
  low: 'bg-gray-400',
};

/**
 * The Express candidate "NOT FINAL" disclosure banner. Pure presentational; the structural truth comes from the
 * E7a server guard via props. Always discloses non-final status; reflects can't-approve-yet vs approve-enabled.
 */
export function ExpressCandidateBanner({
  canApprove,
  unresolvedEscalations,
  onApprove,
}: ExpressCandidateBannerProps): React.ReactElement {
  const count = unresolvedEscalations.length;

  return (
    <div
      data-testid="express-candidate-banner"
      role="alert"
      className="rounded-lg border border-amber-300 bg-amber-50 p-4 space-y-3 text-sm text-amber-900"
    >
      <div className="flex items-start gap-2">
        <ShieldAlert className="w-5 h-5 shrink-0 text-amber-700" aria-hidden="true" />
        <div className="space-y-1">
          <p className="font-semibold">
            Express produced a candidate draft. It is{' '}
            <span className="underline">NOT final, sendable, fileable, or recordable.</span>
          </p>
          <p data-testid="express-candidate-banner-instruction">
            {count > 0 ? (
              <>
                Review the <span className="font-semibold">{count}</span> escalation{count === 1 ? '' : 's'} below
                and approve each before this draft can proceed. Attorney review and approval are required —
                silence, timeout, or loop-completion is not approval.
              </>
            ) : (
              <>
                No escalations remain. Attorney review and an affirmative approval are still required before this
                draft can proceed — it is a non-final Express candidate.
              </>
            )}
          </p>
        </div>
      </div>

      {count > 0 && (
        <ul data-testid="express-candidate-banner-escalations" className="space-y-1 pl-7">
          {unresolvedEscalations.map((esc) => (
            <li key={esc.id} data-testid="express-escalation-item" className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className={`inline-block w-2 h-2 rounded-full shrink-0 ${BUCKET_DOT[esc.riskBucket]}`}
              />
              <span className="uppercase text-xs font-semibold tracking-wide">{esc.riskBucket}</span>
              <span className="text-amber-900/90">{esc.reason}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center gap-2 pl-7" data-testid="express-candidate-approval-state">
        {canApprove ? (
          <>
            <ShieldCheck className="w-4 h-4 text-green-700" aria-hidden="true" />
            <span data-testid="express-approve-enabled" className="text-green-800">
              All escalations dispositioned — the attorney may now affirmatively approve this candidate.
            </span>
          </>
        ) : (
          <span data-testid="express-approve-blocked" className="font-medium text-amber-900">
            Approval is blocked until every escalation has an explicit attorney decision.
          </span>
        )}
        <button
          type="button"
          data-testid="express-approve-button"
          disabled={!canApprove}
          onClick={canApprove ? onApprove : undefined}
          aria-disabled={!canApprove}
          className={`ml-auto rounded border px-3 py-1 text-sm font-medium ${
            canApprove
              ? 'border-green-300 bg-green-50 text-green-800 hover:bg-green-100'
              : 'cursor-not-allowed border-gray-300 bg-gray-100 text-gray-400'
          }`}
        >
          Approve as reviewed
        </button>
      </div>
    </div>
  );
}
