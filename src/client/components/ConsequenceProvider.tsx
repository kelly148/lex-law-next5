/**
 * ConsequenceProvider — CHAT-UI-1 (live wiring) confirm orchestration.
 *
 * The single mediator every consequential act on the conversation surface goes through. It holds the
 * autonomy slider + the Auto-Act batch queue, routes each confirm (interrupt vs queue) via
 * routeConfirmDecision, renders the shared W1 ConsequenceConfirm in a modal overlay for interrupts,
 * and writes DURABLE W2/W3 provenance on every confirm/clear (the queue's in-memory state is only the
 * "N waiting" UI; the system of record is the durable ledger). Mounted by ChatSurface (flag-gated).
 *
 * Auto-Act semantics (design, surfaced for operator review): a batchable posture change is deferred to
 * the queue ("N waiting") and recorded as a dirty->confirmed transition when the attorney clears the
 * batch; the hard-stop floor still holds — HARD blocks, the carve-out interrupts individually, and
 * non-posture hard-stop acts (lock/send/tier/matter_identity/undo) always interrupt.
 */
import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { type Posture, evaluateCoherence, hasHardBlock } from '../../shared/posture/postureCoherence.js';
import {
  type HardStopAct,
  type ProvenanceEntry,
  type ProvenanceSubject,
  isPostureAct,
  buildProvenanceEntry,
} from '../../shared/posture/provenance.js';
import {
  type SliderPosition,
  DEFAULT_SLIDER_POSITION,
  SLIDER_LABEL,
  routeConfirmDecision,
} from '../../shared/posture/confirmRouting.js';
import { usePostureProvenance } from '../hooks/usePostureProvenance.js';
import ConsequenceConfirm from './ConsequenceConfirm.js';

export interface ConfirmRequest {
  act: HardStopAct;
  title: string;
  description?: string;
  posture?: { prior?: Posture; next: Posture; atEgress?: boolean };
  subject?: ProvenanceSubject;
  triggerSource: string;
}

export interface ConfirmOutcome {
  /** true if the act may proceed (interrupt-confirmed, or queued in Auto-Act). */
  confirmed: boolean;
  /** true if deferred to the Auto-Act batch queue (the act proceeds; acknowledgement is batched). */
  queued: boolean;
  entry?: ProvenanceEntry;
}

interface ConsequenceContextValue {
  sliderPosition: SliderPosition;
  setSliderPosition: (p: SliderPosition) => void;
  requestConfirm: (req: ConfirmRequest) => Promise<ConfirmOutcome>;
  queueCount: number;
}

const ConsequenceContext = createContext<ConsequenceContextValue | null>(null);

export function useConsequence(): ConsequenceContextValue {
  const ctx = useContext(ConsequenceContext);
  if (!ctx) throw new Error('useConsequence must be used within a ConsequenceProvider');
  return ctx;
}

export function ConsequenceProvider(props: {
  matterId: string;
  actor: string;
  children: React.ReactNode;
}): React.ReactElement {
  const { matterId, actor, children } = props;
  const [sliderPosition, setSliderPosition] = useState<SliderPosition>(DEFAULT_SLIDER_POSITION);
  const [pending, setPending] = useState<{ req: ConfirmRequest } | null>(null);
  const [queued, setQueued] = useState<{ id: string; req: ConfirmRequest }[]>([]);
  const resolverRef = useRef<((o: ConfirmOutcome) => void) | null>(null);
  const idRef = useRef(0);
  const provenance = usePostureProvenance(matterId);

  const requestConfirm = useCallback(
    (req: ConfirmRequest): Promise<ConfirmOutcome> => {
      const next = req.posture?.next ?? null;
      const findings = next ? evaluateCoherence(next, { atEgress: req.posture?.atEgress ?? false }) : [];
      const route = routeConfirmDecision({
        isPostureAct: isPostureAct(req.act),
        hasHard: hasHardBlock(findings),
        recipient: next ? next.recipient : null,
        sliderPosition,
      });
      if (route === 'queue') {
        idRef.current += 1;
        setQueued((q) => [...q, { id: `q${idRef.current}`, req }]);
        return Promise.resolve({ confirmed: true, queued: true });
      }
      return new Promise<ConfirmOutcome>((resolve) => {
        resolverRef.current = resolve;
        setPending({ req });
      });
    },
    [sliderPosition],
  );

  const handleConfirm = useCallback(
    (entry: ProvenanceEntry) => {
      provenance.record(entry);
      resolverRef.current?.({ confirmed: true, queued: false, entry });
      resolverRef.current = null;
      setPending(null);
    },
    [provenance],
  );

  const handleCancel = useCallback(() => {
    resolverRef.current?.({ confirmed: false, queued: false });
    resolverRef.current = null;
    setPending(null);
  }, []);

  const clearQueue = useCallback(() => {
    // Record each batched (dirty) posture confirm as a dirty->confirmed transition, then clear.
    for (const { req } of queued) {
      provenance.record(
        buildProvenanceEntry({
          act: req.act,
          eventClass: 'dirty_confirmed',
          subject: req.subject ?? null,
          actor,
          sliderPosition: SLIDER_LABEL[sliderPosition],
          triggerSource: req.triggerSource,
          at: new Date().toISOString(),
          priorTriple: req.posture?.prior ?? null,
          nextTriple: req.posture?.next ?? null,
          acknowledged: req.posture
            ? evaluateCoherence(req.posture.next, { atEgress: req.posture.atEgress ?? false })
            : [],
        }),
      );
    }
    setQueued([]);
  }, [queued, provenance, sliderPosition, actor]);

  const value = useMemo<ConsequenceContextValue>(
    () => ({ sliderPosition, setSliderPosition, requestConfirm, queueCount: queued.length }),
    [sliderPosition, requestConfirm, queued.length],
  );

  return (
    <ConsequenceContext.Provider value={value}>
      {children}
      {queued.length > 0 && (
        <div
          data-testid="posture-queue-bar"
          className="fixed bottom-4 right-4 z-40 flex items-center gap-3 rounded border border-line bg-surface px-4 py-2 shadow-lg"
        >
          <span className="text-sm text-ink">
            {queued.length} posture {queued.length === 1 ? 'confirm' : 'confirms'} waiting
          </span>
          <button
            data-testid="queue-clear-all"
            onClick={clearQueue}
            className="rounded bg-accent px-2 py-1 text-xs text-on-accent hover:bg-accent-hover"
          >
            Clear all
          </button>
        </div>
      )}
      {pending && (
        <div
          data-testid="confirm-overlay"
          role="presentation"
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4"
        >
          <ConsequenceConfirm
            {...pending.req}
            actor={actor}
            sliderPosition={SLIDER_LABEL[sliderPosition]}
            onConfirm={handleConfirm}
            onCancel={handleCancel}
          />
        </div>
      )}
    </ConsequenceContext.Provider>
  );
}
