/**
 * ChatDeliverable — CHAT-UI-1 the focused deliverable's posture strip + acts (live + backend-wired).
 *
 * Holds the deliverable's resolved {issuer, privilege, recipient} triple as surface state and routes
 * every consequential change through useConsequence(). BACKEND WIRING (BA): a PASSED confirm now runs
 * the real backend mutation — strictly inside `if (outcome.confirmed)`, never before the await, so the
 * hard-stop floor (HARD-block / cancel) prevents any mutation. BA-0 binds a real matter source
 * (chatUi.listSources); BA-1 tiers it via the audited re-tier (chatUi.setSourceTier ->
 * setSourceAuthorityTier: in-place UPDATE + transactional audit). Posture (surface state) + cosmetic
 * (silent) are unchanged; send/lock backend wiring lands in BA-2/BA-3.
 */
import React, { useState } from 'react';
import type { inferRouterOutputs } from '@trpc/server';
import {
  type Posture,
  type Issuer,
  type RecipientClass,
  type Privilege,
  issuerRequiresConfirm,
} from '../../shared/posture/postureCoherence.js';
import { planUndo } from '../../shared/posture/undoBands.js';
import { interpretFormattingRequest } from '../../shared/posture/formattingRequest.js';
import { trpc } from '../trpc.js';
import type { AppRouter } from '../../server/router.js';
import { useConsequence } from './ConsequenceProvider.js';

type Source = inferRouterOutputs<AppRouter>['chatUi']['listSources'][number];

const DEFAULT_POSTURE: Posture = {
  issuer: { entity: 'the firm', capacity: 'counsel' },
  privilege: null,
  recipient: 'internal_client',
};

const privilegeLabel = (p: Privilege): string => (p === true ? 'Privileged' : p === false ? 'Not privileged' : 'Undetermined');

export default function ChatDeliverable({ matterId }: { matterId: string }): React.ReactElement {
  const { requestConfirm } = useConsequence();
  const utils = trpc.useUtils();
  const sourcesQuery = trpc.chatUi.listSources.useQuery({ matterId });
  const sources: Source[] = sourcesQuery.data ?? [];
  const documentsQuery = trpc.document.list.useQuery({ matterId, includeArchived: false });
  const documents = documentsQuery.data ?? [];

  const [documentId, setDocumentId] = useState('');
  const [lastLockId, setLastLockId] = useState<string | null>(null);
  const [posture, setPosture] = useState<Posture>(DEFAULT_POSTURE);
  const [cosmetic, setCosmetic] = useState({ firmStyle: false, branding: true });
  const [actLog, setActLog] = useState<string[]>([]);
  const [request, setRequest] = useState('');
  const [sourceId, setSourceId] = useState('');
  const [tierOrigin, setTierOrigin] = useState<Source['authorityOrigin']>('operative');
  const [tierLifecycle, setTierLifecycle] = useState<Source['lifecycle']>('operative');
  const [lastTier, setLastTier] = useState<{ sourceId: string; documentId: string | null; origin: Source['authorityOrigin']; lifecycle: Source['lifecycle'] } | null>(null);

  // ── posture (surface state; unchanged) ──
  const proposePosture = async (act: 'issuer' | 'privilege' | 'recipient', next: Posture): Promise<void> => {
    const outcome = await requestConfirm({ act, title: `Confirm ${act}`, posture: { prior: posture, next }, triggerSource: `posture:${act}` });
    if (outcome.confirmed) setPosture(next);
  };
  const proposeIssuer = (issuer: Issuer): void => {
    if (issuerRequiresConfirm(posture.issuer, issuer)) void proposePosture('issuer', { ...posture, issuer });
    else setPosture((p) => ({ ...p, issuer }));
  };
  const applyFormatting = (text: string): void => {
    for (const intent of interpretFormattingRequest(text)) {
      if (intent.kind === 'cosmetic') setCosmetic((c) => ({ ...c, [intent.field]: intent.value }));
      else proposeIssuer(intent.issuer);
    }
  };
  const setRecipient = (recipient: RecipientClass): Promise<void> => proposePosture('recipient', { ...posture, recipient });
  const setPrivilege = (privilege: Privilege): Promise<void> => proposePosture('privilege', { ...posture, privilege });
  const setCapacity = (capacity: Issuer['capacity']): void => proposeIssuer({ ...posture.issuer, capacity });

  // ── BA-2 lock / BA-3 send — real backend mutation on a PASSED confirm (egress check on the triple) ──
  const doAct = async (act: 'send' | 'lock', label: string): Promise<void> => {
    const outcome = await requestConfirm({
      act,
      title: `Confirm ${label}`,
      subject: { type: act, id: documentId || null, label, detail: null },
      posture: { next: posture, atEgress: true },
      triggerSource: `act:${act}`,
    });
    if (!outcome.confirmed) return; // HARD-block / cancel -> NO mutation
    const summary = `${label} (${posture.issuer.capacity} / ${privilegeLabel(posture.privilege)} / ${posture.recipient})`;
    if (act === 'lock' && documentId) {
      // BA-2: no-suggestion deliverable lock; capture the id so a hard-stop undo can unlock it.
      const res = await utils.client.chatUi.lockDeliverable.mutate({ matterId, documentId, summary });
      setLastLockId(res.lockedDecisionId);
      setActLog((l) => [...l, `Locked ${documentId.slice(0, 8)}`]);
    } else if (act === 'send' && documentId) {
      // BA-3: internal sendability disposition (audited 'sent') — NO export, NO transmission.
      await utils.client.chatUi.recordSend.mutate({ matterId, documentId, decision: 'sent', summary });
      setActLog((l) => [...l, `Send disposition ${documentId.slice(0, 8)}`]);
    } else {
      setActLog((l) => [...l, label]); // no document bound -> surface-only
    }
  };

  const doLockUndo = async (): Promise<void> => {
    if (!lastLockId) return;
    const plan = planUndo({ band: 'hard_stop', act: 'lock', entryId: lastLockId });
    const outcome = await requestConfirm({
      act: 'lock',
      title: 'Undo lock (reversal)',
      ...(plan.subject ? { subject: plan.subject } : {}),
      triggerSource: 'undo:lock',
    });
    if (outcome.confirmed) {
      await utils.client.chatUi.unlockDeliverable.mutate({ matterId, lockedDecisionId: lastLockId });
      setActLog((l) => [...l, 'Lock reversed']);
      setLastLockId(null);
    }
  };

  // ── BA-1: tier a bound source via the audited re-tier (real backend mutation on a passed confirm) ──
  const selectedSource = sources.find((s) => s.id === sourceId) ?? null;

  const doTier = async (): Promise<void> => {
    if (!selectedSource) return;
    const outcome = await requestConfirm({
      act: 'tier_source',
      title: 'Confirm tier',
      subject: { type: 'tier_source', id: selectedSource.id, label: selectedSource.label ?? selectedSource.subjectId, detail: `${tierOrigin} / ${tierLifecycle}` },
      triggerSource: 'act:tier_source',
    });
    if (outcome.confirmed) {
      // Capture the prior tier so a W3 hard-stop undo can re-tier back, THEN run the audited re-tier.
      setLastTier({ sourceId: selectedSource.id, documentId: selectedSource.documentId, origin: selectedSource.authorityOrigin, lifecycle: selectedSource.lifecycle });
      await utils.client.chatUi.setSourceTier.mutate({ sourceId: selectedSource.id, matterId, documentId: selectedSource.documentId, authorityOrigin: tierOrigin, lifecycle: tierLifecycle, rationale: null });
      void utils.chatUi.listSources.invalidate({ matterId });
      setActLog((l) => [...l, `Tier ${selectedSource.id.slice(0, 8)} -> ${tierOrigin}/${tierLifecycle}`]);
    }
  };

  const undoTier = async (): Promise<void> => {
    if (!lastTier) return;
    const plan = planUndo({ band: 'hard_stop', act: 'tier_source', entryId: lastTier.sourceId });
    const outcome = await requestConfirm({
      act: 'tier_source',
      title: 'Undo tier (reversal)',
      ...(plan.subject ? { subject: plan.subject } : {}),
      triggerSource: 'undo:tier',
    });
    if (outcome.confirmed) {
      // Compensating re-tier back to the captured prior tier (no delete path exists).
      await utils.client.chatUi.setSourceTier.mutate({ sourceId: lastTier.sourceId, matterId, documentId: lastTier.documentId, authorityOrigin: lastTier.origin, lifecycle: lastTier.lifecycle, rationale: 'undo' });
      void utils.chatUi.listSources.invalidate({ matterId });
      setActLog((l) => [...l, 'Tier reversed']);
      setLastTier(null);
    }
  };

  return (
    <div data-testid="chat-deliverable" className="mt-4 rounded border border-line p-3 text-sm">
      <h3 className="text-xs font-medium uppercase tracking-wide text-ink-hint">Deliverable posture</h3>
      <dl data-testid="deliverable-triple" className="mt-2 space-y-0.5 text-xs text-ink">
        <div data-testid="dt-issuer">Issuer: {posture.issuer.entity} — {posture.issuer.capacity === 'counsel' ? 'as counsel' : 'as a party'}</div>
        <div data-testid="dt-privilege">Privilege: {privilegeLabel(posture.privilege)}</div>
        <div data-testid="dt-recipient">Recipient: {posture.recipient}</div>
        <div data-testid="dt-cosmetic" className="text-ink-hint">Style: {cosmetic.firmStyle ? 'firm' : 'default'} · branding: {cosmetic.branding ? 'on' : 'off'}</div>
        <div data-testid="dt-actlog" className="text-ink-hint">Acts: {actLog.join(', ') || '—'}</div>
      </dl>

      <div className="mt-3 flex flex-wrap gap-1">
        <button data-testid="ctl-recipient-adverse" className="rounded border border-line px-2 py-1 text-xs" onClick={() => void setRecipient('adverse')}>Recipient → adverse</button>
        <button data-testid="ctl-recipient-internal" className="rounded border border-line px-2 py-1 text-xs" onClick={() => void setRecipient('internal_client')}>Recipient → internal</button>
        <button data-testid="ctl-priv-yes" className="rounded border border-line px-2 py-1 text-xs" onClick={() => void setPrivilege(true)}>Privilege → on</button>
        <button data-testid="ctl-priv-no" className="rounded border border-line px-2 py-1 text-xs" onClick={() => void setPrivilege(false)}>Privilege → off</button>
        <button data-testid="ctl-issuer-principal" className="rounded border border-line px-2 py-1 text-xs" onClick={() => setCapacity('principal')}>Issuer → as a party</button>
      </div>

      <div className="mt-2">
        <button data-testid="ctl-cosmetic-firmstyle" className="rounded border border-line px-2 py-1 text-xs" onClick={() => setCosmetic((c) => ({ ...c, firmStyle: !c.firmStyle }))}>Toggle firm style (cosmetic)</button>
      </div>

      <div className="mt-2 flex gap-1">
        <input data-testid="formatting-input" value={request} onChange={(e) => setRequest(e.target.value)} placeholder="e.g. firm style, no branding, from the owners" className="flex-1 rounded border border-line px-2 py-1 text-xs" />
        <button data-testid="formatting-apply" className="rounded border border-line px-2 py-1 text-xs" onClick={() => applyFormatting(request)}>Apply</button>
      </div>

      {/* BA-0/BA-1 — bind a real source + the audited re-tier (real backend mutation). */}
      <div className="mt-3 border-t border-line pt-2">
        <div className="text-[10px] uppercase tracking-wide text-ink-hint">Tier a source (audited)</div>
        <div className="mt-1 flex flex-wrap items-center gap-1">
          <select data-testid="tier-source-select" value={sourceId} onChange={(e) => setSourceId(e.target.value)} className="rounded border border-line px-1 py-1 text-xs">
            <option value="">{sources.length ? 'select a source…' : 'no sources'}</option>
            {sources.map((s) => (
              <option key={s.id} value={s.id}>{(s.label ?? s.subjectId).slice(0, 24)} ({s.authorityOrigin}/{s.lifecycle})</option>
            ))}
          </select>
          <select data-testid="tier-origin-select" value={tierOrigin} onChange={(e) => setTierOrigin(e.target.value as Source['authorityOrigin'])} className="rounded border border-line px-1 py-1 text-xs">
            {['operative', 'counterparty', 'firm', 'client', 'model_derived', 'reference'].map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
          <select data-testid="tier-lifecycle-select" value={tierLifecycle} onChange={(e) => setTierLifecycle(e.target.value as Source['lifecycle'])} className="rounded border border-line px-1 py-1 text-xs">
            {['current_draft', 'operative', 'superseded'].map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
          <button data-testid="act-tier" disabled={!selectedSource} className="rounded border border-line px-2 py-1 text-xs disabled:opacity-40" onClick={() => void doTier()}>Tier source</button>
          <button data-testid="act-tier-undo" disabled={!lastTier} className="rounded border border-line px-2 py-1 text-xs disabled:opacity-40" onClick={() => void undoTier()}>Undo tier</button>
        </div>
      </div>

      {/* BA-2/BA-3 — bind a real document, then lock / send (real backend mutations). */}
      <div className="mt-3 border-t border-line pt-2">
        <div className="text-[10px] uppercase tracking-wide text-ink-hint">Document acts (lock / send)</div>
        <div className="mt-1 flex flex-wrap items-center gap-1">
          <select data-testid="doc-select" value={documentId} onChange={(e) => setDocumentId(e.target.value)} className="rounded border border-line px-1 py-1 text-xs">
            <option value="">{documents.length ? 'select a document…' : 'no documents'}</option>
            {documents.map((d) => (
              <option key={d.id} value={d.id}>{(d.title ?? d.id).slice(0, 24)}</option>
            ))}
          </select>
          <button data-testid="act-send" className="rounded bg-accent px-2 py-1 text-xs text-on-accent" onClick={() => void doAct('send', 'Send')}>Send</button>
          <button data-testid="act-lock" className="rounded border border-line px-2 py-1 text-xs" onClick={() => void doAct('lock', 'Lock')}>Lock</button>
          <button data-testid="act-lock-undo" disabled={!lastLockId} className="rounded border border-line px-2 py-1 text-xs disabled:opacity-40" onClick={() => void doLockUndo()}>Undo lock</button>
        </div>
      </div>
    </div>
  );
}
