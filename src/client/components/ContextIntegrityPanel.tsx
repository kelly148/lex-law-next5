/**
 * ContextIntegrityPanel — CHAT-UI-1 (live wiring) W3 context integrity on the live surface.
 *
 * Wires the three W3 guards through the WIRE-1 orchestrator (useConsequence):
 *  1. Matter-identity ingestion confirm: a resolved matter identity that is set / changed / ambiguous
 *     surfaces a confirm (act 'matter_identity', {type:'matter'} subject) BEFORE it binds; an
 *     unambiguous same-matter re-ingest binds silently (no over-prompt).
 *  2. Undo-by-band: a cosmetic undo is silent; a hard-stop undo routes through confirm and records a
 *     {type:'undo'} reversal.
 *  3. Stale-preview guard: acting on a preview whose triple drifted re-confirms against the CURRENT
 *     resolved triple — surfacing the danger a silently-moved field created (privilege left "on" while
 *     recipient moved to adverse -> HARD on re-confirm).
 *
 * Minimal controls that exercise each behavior end-to-end on the running surface; behind CHAT_UI_1_ENABLED.
 */
import React, { useState } from 'react';
import type { Posture } from '../../shared/posture/postureCoherence.js';
import {
  type MatterIdentity,
  type MatterResolution,
  matterIdentityRequiresConfirm,
} from '../../shared/posture/matterIdentity.js';
import { planUndo } from '../../shared/posture/undoBands.js';
import { capturePreview, resolveStaleAction } from '../../shared/posture/stalePreview.js';
import { useConsequence } from './ConsequenceProvider.js';

const COUNSEL_INTERNAL: Posture = { issuer: { entity: 'the firm', capacity: 'counsel' }, privilege: true, recipient: 'internal_client' };

export default function ContextIntegrityPanel(): React.ReactElement {
  const { requestConfirm } = useConsequence();
  const [boundMatter, setBoundMatter] = useState<MatterIdentity | null>(null);
  const [undoLog, setUndoLog] = useState<string[]>([]);
  const [staleResult, setStaleResult] = useState('');

  const bind = (resolution: MatterResolution): void => {
    if (resolution.matterId === null) return;
    setBoundMatter({ matterId: resolution.matterId, ...(resolution.label !== undefined ? { label: resolution.label } : {}) });
  };

  const ingest = async (resolution: MatterResolution): Promise<void> => {
    if (matterIdentityRequiresConfirm(boundMatter, resolution)) {
      const outcome = await requestConfirm({
        act: 'matter_identity',
        title: 'Confirm matter identity',
        subject: {
          type: 'matter',
          id: resolution.matterId,
          label: resolution.label ?? null,
          detail: boundMatter ? `was ${boundMatter.matterId}` : null,
        },
        triggerSource: 'ingestion',
      });
      if (outcome.confirmed) bind(resolution);
    } else {
      bind(resolution); // unambiguous same-matter re-ingest -> bind silently
    }
  };

  const undoHardStop = async (): Promise<void> => {
    const plan = planUndo({ band: 'hard_stop', act: 'lock', entryId: 'demo-lock-entry' });
    if (plan.requiresConfirm && plan.confirmAct) {
      const outcome = await requestConfirm({
        act: plan.confirmAct,
        title: 'Confirm undo (reversal)',
        ...(plan.subject ? { subject: plan.subject } : {}),
        triggerSource: 'undo',
      });
      if (outcome.confirmed) setUndoLog((l) => [...l, 'lock reversed']);
    }
  };

  const undoCosmetic = (): void => {
    if (!planUndo({ band: 'cosmetic' }).requiresConfirm) setUndoLog((l) => [...l, 'cosmetic undone (silent)']);
  };

  const actOnStalePreview = async (): Promise<void> => {
    const snapshot = capturePreview(COUNSEL_INTERNAL);
    // The underlying triple drifted: recipient -> adverse; privilege UNCHANGED ("still on").
    const current: Posture = { ...COUNSEL_INTERNAL, recipient: 'adverse' };
    const r = resolveStaleAction(snapshot, current, { atEgress: true });
    setStaleResult(`stale=${r.stale} blocked=${r.blocked}`);
    if (r.stale) {
      await requestConfirm({
        act: 'send',
        title: 'Re-confirm against current state',
        posture: { prior: snapshot.triple, next: r.reConfirmTriple, atEgress: true },
        subject: { type: 'stale_reconfirm', id: null, label: 'preview drifted', detail: null },
        triggerSource: 'stale-preview',
      });
    }
  };

  const R = (id: string): MatterResolution =>
    id === 'AMBIGUOUS'
      ? { matterId: null, candidates: ['A', 'C'], ambiguous: true }
      : { matterId: id, candidates: [id], ambiguous: false, label: `Matter ${id}` };

  return (
    <div data-testid="context-integrity" className="mt-4 rounded border border-line p-3 text-xs">
      <h3 className="text-xs font-medium uppercase tracking-wide text-ink-hint">Context integrity</h3>

      <div className="mt-2">
        <div data-testid="ci-bound" className="text-ink-hint">Bound matter: {boundMatter ? boundMatter.matterId : '—'}</div>
        <div className="mt-1 flex flex-wrap gap-1">
          <button data-testid="ci-ingest-a" className="rounded border border-line px-2 py-1" onClick={() => void ingest(R('A'))}>Ingest A</button>
          <button data-testid="ci-reingest-a" className="rounded border border-line px-2 py-1" onClick={() => void ingest(R('A'))}>Re-ingest A</button>
          <button data-testid="ci-ingest-b" className="rounded border border-line px-2 py-1" onClick={() => void ingest(R('B'))}>Ingest B</button>
          <button data-testid="ci-ingest-ambiguous" className="rounded border border-line px-2 py-1" onClick={() => void ingest(R('AMBIGUOUS'))}>Ingest ambiguous</button>
        </div>
      </div>

      <div className="mt-2">
        <div data-testid="ci-undolog" className="text-ink-hint">Undo: {undoLog.join(', ') || '—'}</div>
        <div className="mt-1 flex flex-wrap gap-1">
          <button data-testid="ci-undo-cosmetic" className="rounded border border-line px-2 py-1" onClick={undoCosmetic}>Undo cosmetic</button>
          <button data-testid="ci-undo-hardstop" className="rounded border border-line px-2 py-1" onClick={() => void undoHardStop()}>Undo a lock</button>
        </div>
      </div>

      <div className="mt-2">
        <div data-testid="ci-stale-result" className="text-ink-hint">Stale check: {staleResult || '—'}</div>
        <button data-testid="ci-act-stale" className="mt-1 rounded border border-line px-2 py-1" onClick={() => void actOnStalePreview()}>Act on a drifted preview</button>
      </div>
    </div>
  );
}
