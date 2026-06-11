/**
 * ChatDeliverable — CHAT-UI-1 (live wiring) the focused deliverable's posture strip + acts.
 *
 * Holds the deliverable's resolved {issuer, privilege, recipient} triple as surface state (acts are
 * surface-level this increment) and routes every consequential change through useConsequence():
 *  - posture controls (issuer / privilege / recipient) propose the change, run the incoherence table
 *    via ConsequenceConfirm, and apply only on confirm (or queue in Auto-Act);
 *  - the cosmetic styling toggle + the cosmetic part of a formatting request apply SILENTLY;
 *  - "from the owners" (a formatting request) proposes an issuer change -> a recorded full-triple confirm;
 *  - send / lock run the egress coherence check (atEgress) on the resolved triple; tier records its act.
 * Every confirmed act writes durable W2/W3 provenance via the provider.
 */
import React, { useState } from 'react';
import {
  type Posture,
  type Issuer,
  type RecipientClass,
  type Privilege,
  issuerRequiresConfirm,
} from '../../shared/posture/postureCoherence.js';
import { interpretFormattingRequest } from '../../shared/posture/formattingRequest.js';
import { useConsequence } from './ConsequenceProvider.js';

const DEFAULT_POSTURE: Posture = {
  issuer: { entity: 'the firm', capacity: 'counsel' },
  privilege: null,
  recipient: 'internal_client',
};

const privilegeLabel = (p: Privilege): string => (p === true ? 'Privileged' : p === false ? 'Not privileged' : 'Undetermined');

export default function ChatDeliverable(): React.ReactElement {
  const { requestConfirm } = useConsequence();
  const [posture, setPosture] = useState<Posture>(DEFAULT_POSTURE);
  const [cosmetic, setCosmetic] = useState({ firmStyle: false, branding: true });
  const [actLog, setActLog] = useState<string[]>([]);
  const [request, setRequest] = useState('');

  const proposePosture = async (act: 'issuer' | 'privilege' | 'recipient', next: Posture): Promise<void> => {
    const outcome = await requestConfirm({
      act,
      title: `Confirm ${act}`,
      posture: { prior: posture, next },
      triggerSource: `posture:${act}`,
    });
    if (outcome.confirmed) setPosture(next);
  };

  const proposeIssuer = (issuer: Issuer): void => {
    if (issuerRequiresConfirm(posture.issuer, issuer)) {
      void proposePosture('issuer', { ...posture, issuer });
    } else {
      setPosture((p) => ({ ...p, issuer })); // provably cosmetic issuer change -> silent
    }
  };

  const applyFormatting = (text: string): void => {
    for (const intent of interpretFormattingRequest(text)) {
      if (intent.kind === 'cosmetic') {
        setCosmetic((c) => ({ ...c, [intent.field]: intent.value })); // silent
      } else {
        proposeIssuer(intent.issuer);
      }
    }
  };

  const doAct = async (act: 'send' | 'lock' | 'tier_source', label: string): Promise<void> => {
    const egress = act === 'send' || act === 'lock';
    const outcome = await requestConfirm({
      act,
      title: `Confirm ${label}`,
      subject: { type: act, id: null, label, detail: null },
      ...(egress ? { posture: { next: posture, atEgress: true } } : {}),
      triggerSource: `act:${act}`,
    });
    if (outcome.confirmed) setActLog((l) => [...l, label]);
  };

  const setRecipient = (recipient: RecipientClass): Promise<void> => proposePosture('recipient', { ...posture, recipient });
  const setPrivilege = (privilege: Privilege): Promise<void> => proposePosture('privilege', { ...posture, privilege });
  const setCapacity = (capacity: Issuer['capacity']): void => proposeIssuer({ ...posture.issuer, capacity });

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

      {/* Posture controls (each routes through the orchestrator). */}
      <div className="mt-3 flex flex-wrap gap-1">
        <button data-testid="ctl-recipient-adverse" className="rounded border border-line px-2 py-1 text-xs" onClick={() => void setRecipient('adverse')}>Recipient → adverse</button>
        <button data-testid="ctl-recipient-internal" className="rounded border border-line px-2 py-1 text-xs" onClick={() => void setRecipient('internal_client')}>Recipient → internal</button>
        <button data-testid="ctl-priv-yes" className="rounded border border-line px-2 py-1 text-xs" onClick={() => void setPrivilege(true)}>Privilege → on</button>
        <button data-testid="ctl-priv-no" className="rounded border border-line px-2 py-1 text-xs" onClick={() => void setPrivilege(false)}>Privilege → off</button>
        <button data-testid="ctl-issuer-principal" className="rounded border border-line px-2 py-1 text-xs" onClick={() => setCapacity('principal')}>Issuer → as a party</button>
      </div>

      {/* Cosmetic (applies silently — no confirm). */}
      <div className="mt-2">
        <button data-testid="ctl-cosmetic-firmstyle" className="rounded border border-line px-2 py-1 text-xs" onClick={() => setCosmetic((c) => ({ ...c, firmStyle: !c.firmStyle }))}>Toggle firm style (cosmetic)</button>
      </div>

      {/* Formatting request (hybrid issuer scenario). */}
      <div className="mt-2 flex gap-1">
        <input data-testid="formatting-input" value={request} onChange={(e) => setRequest(e.target.value)} placeholder="e.g. firm style, no branding, from the owners" className="flex-1 rounded border border-line px-2 py-1 text-xs" />
        <button data-testid="formatting-apply" className="rounded border border-line px-2 py-1 text-xs" onClick={() => applyFormatting(request)}>Apply</button>
      </div>

      {/* Hard-stop acts. */}
      <div className="mt-3 flex flex-wrap gap-1 border-t border-line pt-2">
        <button data-testid="act-send" className="rounded bg-accent px-2 py-1 text-xs text-on-accent" onClick={() => void doAct('send', 'Send')}>Send</button>
        <button data-testid="act-lock" className="rounded border border-line px-2 py-1 text-xs" onClick={() => void doAct('lock', 'Lock')}>Lock</button>
        <button data-testid="act-tier" className="rounded border border-line px-2 py-1 text-xs" onClick={() => void doAct('tier_source', 'Tier source')}>Tier source</button>
      </div>
    </div>
  );
}
