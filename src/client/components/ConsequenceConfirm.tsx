/**
 * ConsequenceConfirm — CHAT-UI-1 W1 shared consequence-tier confirm (brief §3 law-6, the spine).
 *
 * The SINGLE component every hard-stop act and every posture change routes through. It renders a
 * visibly distinct, deliberate, RECORDED confirm — unreachable by clerical inference or chat phrasing.
 * For posture acts it forces the FULL {issuer, privilege, recipient} triple display (brief §2.2) and
 * runs the operator-ratified coherence table: HARD findings BLOCK the confirm; SOFT findings require
 * an explicit acknowledgement. On confirm it emits a provenance entry (brief §2.5).
 *
 * Gated behind CHAT_UI_1_ENABLED with the rest of CHAT-UI-1; rendered only inside the (flag-gated)
 * conversation surface. This component does not manage its own open/close — the caller mounts it.
 */
import React, { useState } from 'react';
import { AlertTriangle, ShieldAlert, Check, X } from 'lucide-react';
import {
  type Posture,
  type RecipientClass,
  type CoherenceFinding,
  evaluateCoherence,
  hasHardBlock,
  posturePropertyTriggers,
} from '../../shared/posture/postureCoherence.js';
import {
  type HardStopAct,
  type ProvenanceEntry,
  type ProvenanceSubject,
  isPostureAct,
  buildProvenanceEntry,
} from '../../shared/posture/provenance.js';

const RECIPIENT_LABELS: Record<RecipientClass, string> = {
  internal_client: 'Internal / client',
  co_counsel_agent: 'Co-counsel / agent',
  neutral_third_party: 'Neutral third party',
  regulator_court: 'Regulator / court',
  adverse: 'Adverse party',
  public: 'Public',
};

function privilegeLabel(p: Posture['privilege']): string {
  if (p === true) return 'Privileged';
  if (p === false) return 'Not privileged';
  return 'Undetermined';
}

export interface ConsequenceConfirmProps {
  act: HardStopAct;
  title: string;
  description?: string;
  /** Present for posture acts (and the send/lock egress check). `atEgress` enables the egress-only rows. */
  posture?: { prior?: Posture; next: Posture; atEgress?: boolean };
  /** The target of a non-posture hard-stop act (W3): the bound matter, the undo target, etc. */
  subject?: ProvenanceSubject;
  actor: string;
  sliderPosition: string;
  triggerSource: string;
  onConfirm: (entry: ProvenanceEntry) => void;
  onCancel: () => void;
}

export default function ConsequenceConfirm(props: ConsequenceConfirmProps): React.ReactElement {
  const { act, title, description, posture, subject, actor, sliderPosition, triggerSource, onConfirm, onCancel } = props;
  const [softAck, setSoftAck] = useState(false);

  const next = posture?.next;
  const showsTriple = (posture !== undefined || isPostureAct(act)) && next !== undefined;
  const findings: CoherenceFinding[] = next
    ? evaluateCoherence(next, { atEgress: posture?.atEgress ?? false })
    : [];
  const hard = findings.filter((f) => f.severity === 'HARD');
  const soft = findings.filter((f) => f.severity === 'SOFT');
  const blocked = hasHardBlock(findings);
  const needsAck = soft.length > 0;
  const canConfirm = !blocked && (!needsAck || softAck);

  const changed = posture?.prior && next ? posturePropertyTriggers(posture.prior, next) : null;

  const handleConfirm = (): void => {
    if (!canConfirm) return;
    onConfirm(
      buildProvenanceEntry({
        act,
        actor,
        sliderPosition,
        triggerSource,
        at: new Date().toISOString(),
        subject: subject ?? null,
        priorTriple: posture?.prior ?? null,
        nextTriple: next ?? null,
        acknowledged: findings,
      }),
    );
  };

  return (
    <div
      data-testid="consequence-confirm"
      data-act={act}
      role="dialog"
      aria-modal="true"
      className="max-w-lg rounded-lg border-2 border-accent bg-surface p-5 shadow-lg"
    >
      <div className="flex items-center gap-2">
        <ShieldAlert className="h-5 w-5 text-accent" />
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        <span className="ml-auto text-[10px] uppercase tracking-wide text-ink-hint">Recorded confirm</span>
      </div>
      {description && <p className="mt-2 text-sm text-ink-secondary">{description}</p>}

      {subject && (
        <div data-testid="confirm-subject" className="mt-3 rounded border border-line bg-surface-2 p-3 text-sm">
          <div className="text-[10px] uppercase tracking-wide text-ink-hint">{subject.type}</div>
          <div className="mt-1 text-ink">{subject.label ?? subject.id ?? '—'}</div>
          {subject.detail && <div className="mt-0.5 text-xs text-ink-hint">{subject.detail}</div>}
        </div>
      )}

      {showsTriple && next && (
        <div data-testid="confirm-triple" className="mt-4 rounded border border-line bg-surface-2 p-3 text-sm">
          <div className="text-[10px] uppercase tracking-wide text-ink-hint">Posture — full triple</div>
          <dl className="mt-2 space-y-1">
            <TripleRow
              label="Issuer"
              testid="triple-issuer"
              changed={Boolean(changed?.issuer)}
              value={`${next.issuer.display ?? next.issuer.entity} — ${next.issuer.capacity === 'counsel' ? 'as counsel' : 'as a party'}`}
            />
            <TripleRow
              label="Privilege"
              testid="triple-privilege"
              changed={Boolean(changed?.privilege)}
              value={privilegeLabel(next.privilege)}
            />
            <TripleRow
              label="Recipient"
              testid="triple-recipient"
              changed={Boolean(changed?.recipient)}
              value={RECIPIENT_LABELS[next.recipient]}
            />
          </dl>
        </div>
      )}

      {hard.length > 0 && (
        <div data-testid="confirm-hard" className="mt-3 rounded border border-red-300 bg-red-50 p-3">
          <div className="flex items-center gap-1.5 text-sm font-medium text-red-700">
            <ShieldAlert className="h-4 w-4" /> Blocked — must be resolved
          </div>
          <ul className="mt-1 list-disc pl-5 text-xs text-red-700">
            {hard.map((f) => (
              <li key={f.id} data-testid={`hard-${f.id}`}>
                {f.summary}. {f.rationale}
              </li>
            ))}
          </ul>
        </div>
      )}

      {soft.length > 0 && (
        <div data-testid="confirm-soft" className="mt-3 rounded border border-amber-300 bg-amber-50 p-3">
          <div className="flex items-center gap-1.5 text-sm font-medium text-amber-800">
            <AlertTriangle className="h-4 w-4" /> Warnings
          </div>
          <ul className="mt-1 list-disc pl-5 text-xs text-amber-800">
            {soft.map((f) => (
              <li key={f.id} data-testid={`soft-${f.id}`}>
                {f.summary}. {f.rationale}
              </li>
            ))}
          </ul>
          <label className="mt-2 flex items-center gap-2 text-xs text-amber-900">
            <input
              type="checkbox"
              data-testid="confirm-soft-ack"
              checked={softAck}
              onChange={(e) => setSoftAck(e.target.checked)}
            />
            I have reviewed these warnings.
          </label>
        </div>
      )}

      <div className="mt-5 flex items-center justify-end gap-2">
        <button
          data-testid="confirm-cancel"
          onClick={onCancel}
          className="flex items-center gap-1.5 rounded border border-line px-3 py-1.5 text-sm text-ink-secondary hover:bg-surface-2"
        >
          <X className="h-4 w-4" /> Cancel
        </button>
        <button
          data-testid="confirm-accept"
          onClick={handleConfirm}
          disabled={!canConfirm}
          className="flex items-center gap-1.5 rounded bg-accent px-3 py-1.5 text-sm text-on-accent hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Check className="h-4 w-4" /> Confirm
        </button>
      </div>
    </div>
  );
}

function TripleRow(props: { label: string; value: string; changed: boolean; testid: string }): React.ReactElement {
  const { label, value, changed, testid } = props;
  return (
    <div className="flex items-baseline gap-2" data-testid={testid} data-changed={changed ? 'true' : 'false'}>
      <dt className="w-20 flex-shrink-0 text-xs text-ink-hint">{label}</dt>
      <dd className="text-ink">
        {value}
        {changed && <span className="ml-1 text-[10px] text-accent">changed</span>}
      </dd>
    </div>
  );
}
