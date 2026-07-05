/**
 * CategoryDescribeBox — EXPRESS-FANOUT-1: the shared AI "describe the deal" box for the non-gift Quick-Deed
 * category forms. Wires a free-text description to a category-aware proposeIntake mutation, then hands the
 * accepted proposal to the caller's onApplyProposal (which pre-fills that category's ROUTINE form fields). The
 * status branches (proposed / needs_clarification / blocked) are handled generically here.
 *
 * SAFETY: this component only surfaces the proposal and delegates the field mapping to the caller's
 * onApplyProposal — and those mappers (quickDeedProposalApply.ts) are pure and structurally never carry an
 * attorney-verbatim recital or the legal description. Flag-dark (only reachable from the flag-gated /deed page).
 */
import React, { useState } from 'react';
import { useGuardedMutation } from '../hooks/useGuardedMutation.js';

export type CategoryProposeResult<P> =
  | { status: 'proposed'; proposal: P }
  | { status: 'needs_clarification'; questions: string[] }
  | { status: 'blocked'; reason: string };

export function CategoryDescribeBox<P>({
  resolveMatterId,
  proposeMutate,
  onApplyProposal,
  placeholder,
  safetyNote,
}: {
  resolveMatterId: () => Promise<string>;
  proposeMutate: (input: { matterId: string; freeText: string }) => Promise<CategoryProposeResult<P>>;
  onApplyProposal: (proposal: P) => void;
  placeholder: string;
  /** Plain-English reminder of what the model will NOT write (the verbatim/extraction-only fields). */
  safetyNote: string;
}): React.ReactElement {
  const [freeText, setFreeText] = useState('');
  const [status, setStatus] = useState<'idle' | 'proposed' | 'needs_clarification' | 'blocked'>('idle');
  const [questions, setQuestions] = useState<string[]>([]);
  const [blockedReason, setBlockedReason] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const propose = useGuardedMutation(
    (input: { matterId: string; freeText: string }) => proposeMutate(input),
    {
      onSuccess: (res: CategoryProposeResult<P>) => {
        setError(null);
        if (res.status === 'proposed') {
          onApplyProposal(res.proposal);
          setQuestions([]);
          setBlockedReason(null);
          setStatus('proposed');
        } else if (res.status === 'needs_clarification') {
          setQuestions(res.questions);
          setBlockedReason(null);
          setStatus('needs_clarification');
        } else {
          setQuestions([]);
          setBlockedReason(res.reason);
          setStatus('blocked');
        }
      },
      onError: (err: Error) => setError(err.message),
    },
  );

  const handlePropose = (): void => {
    const text = freeText.trim();
    if (!text) { setError('Describe the deal first, then propose the facts.'); return; }
    setError(null);
    void resolveMatterId()
      .then((id) => propose.mutate({ matterId: id, freeText: text }))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Could not start the deed record.'));
  };

  return (
    <div data-testid="category-describe" className="rounded border border-firm-navy/20 bg-firm-navy/5 p-3 space-y-2">
      <label htmlFor="category-free-text" className="block text-sm font-medium text-firm-navy">
        Describe the deal <span className="font-normal text-ink-hint">(optional)</span>
      </label>
      <textarea
        id="category-free-text"
        data-testid="category-free-text"
        value={freeText}
        onChange={(e) => setFreeText(e.target.value)}
        rows={3}
        className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-firm-navy"
        placeholder={placeholder}
      />
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-ink-hint">{safetyNote}</span>
        <button
          type="button"
          data-testid="category-propose"
          onClick={handlePropose}
          disabled={propose.isPending}
          className="px-3 py-1.5 text-sm bg-firm-navy text-white rounded hover:opacity-90 disabled:opacity-50 whitespace-nowrap"
        >
          {propose.isPending ? 'Reading…' : 'Propose the facts'}
        </button>
      </div>
      {error && <p data-testid="category-propose-error" className="text-red-600 text-sm">{error}</p>}
      {status === 'proposed' && (
        <p data-testid="category-proposed-note" className="text-xs text-ink-secondary">
          Proposed from your description — the routine facts you stated are filled in below. Review and confirm,
          then Generate.{' '}
          <span className="text-amber-700">
            Grantor (current-owner) names are not proposed from a description — add them from a recorded-deed
            upload or by hand, or Generate will block.
          </span>
        </p>
      )}
      {status === 'needs_clarification' && (
        <div data-testid="category-clarify" className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 space-y-1">
          <p className="font-medium">A few things need clarifying before I can propose the facts:</p>
          <ul className="list-disc list-inside space-y-0.5">
            {questions.map((qn, i) => <li key={i}>{qn}</li>)}
          </ul>
          <p>Restate the deal with those details, or fill the fields in below.</p>
        </div>
      )}
      {status === 'blocked' && (
        <p data-testid="category-blocked" className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          The AI describe-the-deal intake is not available right now ({blockedReason}). Fill the fields in below —
          the rest of the deed flow is unaffected.
        </p>
      )}
    </div>
  );
}
