/**
 * MatterRecitalBand — Whereas RELAYOUT-2 (MatterDetail recital band v2).
 *
 * Replaces the R2 #3 chip strip (MatterReadinessStrip) with a single banded row of seven
 * two-line state blocks separated by vertical hairlines — NOT cards. The "established record"
 * you re-orient to on opening a matter, read in one glance. Spec: _analytical/phase2/reviews/
 * RELAYOUT_design_spec_2026-06-07.md §2 (operator-signed v1.1).
 *
 * STATUS-ONLY (spec §2.3): the band REPORTS; it is not interactive. No buttons, hover cards,
 * menus, or inline actions — fixing acts stay deliberate in their own panels. (Setting the
 * jurisdiction moved to the Edit-matter modal so the band can be pure status.)
 *
 * Emphasis grammar (spec §2.3): small leading dot + same-color value text, weight unchanged;
 * no badges, pills, or count bubbles; NEVER oxblood (oxblood = action only). Amber = needs-you /
 * precondition; the reserved conflict-severity tint is for an undispositioned conflict hit ONLY
 * (rendered as severity, never an alert badge); muted green sparing (resolved); neutral for
 * just-not-started. A fully-clear matter reads near-monochrome.
 *
 * Gate dispositions wired (operator rulings 2026-06-07):
 *  - G3: the Document block binds to operativeDocument.workflowState (authoritative), NOT the
 *    sendability posture (the MatterStateDashboard "unknown" badge is posture, handled in #7).
 *  - G4: the Sendability block reads safeToSend.posture (band-wording-only) and NEVER asserts
 *    green; unknown -> "Not checked" (neutral), blocked/clear -> "Advisory - review" (amber).
 *  - G5: the Client block reuses matterIntake.listParties (no new endpoint); lead confirmed
 *    role='client' party + count of others + unconfirmed count, derived client-side.
 *
 * Rules of Hooks (the phase-3 #310 lesson): ALL hooks run every render, before any early return.
 * No blue (R1-CLEANUP-1) — semantic --wa- tints only.
 */
import React from 'react';
import clsx from 'clsx';
import { trpc } from '../trpc.js';

interface MatterRecitalBandProps {
  matterId: string;
}

type Tone = 'good' | 'attention' | 'severity' | 'neutral';

// same-color value text + leading dot, per tone (no pills, no badges, never oxblood)
const VALUE_CLS: Record<Tone, string> = {
  good: 'text-success',
  attention: 'text-warning',
  severity: 'text-danger',
  neutral: 'text-ink',
};
const DOT_CLS: Record<Tone, string> = {
  good: 'bg-success',
  attention: 'bg-warning',
  severity: 'bg-danger',
  neutral: 'bg-line-strong',
};

interface BlockData {
  key: string;
  label: string;
  value: string;
  tone: Tone;
  /** matter-identity values (jurisdiction, client) render in serif (Fraunces) per spec §2.2 */
  identity?: boolean;
}

function Block({ block }: { block: BlockData }): React.ReactElement {
  return (
    <div className="flex-1 min-w-[116px] px-3 py-2 border-l border-line first:border-l-0" data-testid={`band-block-${block.key}`}>
      <div className="text-[11px] leading-tight text-ink-secondary">{block.label}</div>
      <div className="mt-0.5 flex items-center gap-1.5">
        <span className={clsx('inline-block w-1.5 h-1.5 rounded-full flex-shrink-0', DOT_CLS[block.tone])} aria-hidden="true" />
        <span
          className={clsx('text-[13px] leading-tight truncate', VALUE_CLS[block.tone], block.identity && 'font-serif')}
          title={block.value}
          data-testid={`band-value-${block.key}`}
        >
          {block.value}
        </span>
      </div>
    </div>
  );
}

const JURISDICTION_LABEL: Record<string, string> = { VA: 'Virginia', MD: 'Maryland' };

const WORKFLOW_LABEL: Record<string, string> = {
  drafting: 'Drafting',
  substantively_accepted: 'In review',
  finalizing: 'Finalizing',
  complete: 'Final',
  archived: 'Archived',
};

/** Conflicts — NEVER "No conflicts" (legal conservatism, spec §2.2 #3). */
function conflictBlock(state: string, reasons: string[]): { value: string; tone: Tone } {
  if (state === 'CLEARED') return { value: 'Cleared', tone: 'good' };
  if (state === 'BLOCKED') return { value: 'Hit awaiting disposition', tone: 'severity' };
  switch (reasons[0]) {
    case 'no_conflict_check': return { value: 'Not yet run', tone: 'attention' };
    case 'no_client_party': return { value: 'No client party', tone: 'attention' };
    case 'unconfirmed_client_party': return { value: 'Client unconfirmed', tone: 'attention' };
    case 'check_stale_parties_changed': return { value: 'Re-check needed', tone: 'attention' };
    default: return { value: 'Not established', tone: 'attention' };
  }
}

/** Sendability — band-wording-only (G4): NEVER green until a real checked-signal exists. */
function sendabilityBlock(posture: string): { value: string; tone: Tone } {
  if (posture === 'unknown') return { value: 'Not checked', tone: 'neutral' };
  // blocked | clear both render conservatively as advisory-amber (no green from open_items alone)
  return { value: 'Advisory — review', tone: 'attention' };
}

export default function MatterRecitalBand({ matterId }: MatterRecitalBandProps): React.ReactElement {
  const dash = trpc.matterState.dashboard.useQuery({ matterId });
  // G5: reuse the existing parties query (no new endpoint); derive client-side.
  const partiesQ = trpc.matterIntake.listParties.useQuery({ matterId });
  // S13 (UI-ATTORNEY-SWEEP-1): when conflicts enforcement is OFF, the conflicts block is noise — quiet
  // it. Display only; the server still enforces whatever the policy dictates. Default (undefined/loading)
  // = SHOWN so the band never flickers the block out during load; only an explicit disabled omits it.
  const conflictPolicyQ = trpc.conflictPolicy.isEnabled.useQuery();

  // After all hooks: a boundary-safe skeleton until the reads resolve. Never blank (anti-#310).
  if (dash.isLoading || !dash.data || dash.data.full.mode !== 'full') {
    return <div className="mb-5 h-[60px] rounded-lg border border-line bg-surface animate-pulse" data-testid="recital-band-loading" />;
  }

  const { full, conflictClearance } = dash.data;
  const counts = full.counts;
  const parties = partiesQ.data ?? [];

  // 1) Jurisdiction
  const jurisdiction = dash.data.jurisdiction ?? null;
  const jurisdictionBlock: BlockData = {
    key: 'jurisdiction',
    label: 'Jurisdiction',
    value: jurisdiction ? (JURISDICTION_LABEL[jurisdiction] ?? jurisdiction) : 'Not set',
    tone: jurisdiction ? 'neutral' : 'attention',
    identity: true,
  };

  // 2) Client / parties (G5) — name-first; lead confirmed client + count of others + unconfirmed
  const clientParties = parties.filter((p) => p.role === 'client');
  const leadClient = clientParties.find((p) => p.confirmed) ?? clientParties[0] ?? null;
  const otherCount = leadClient ? parties.length - 1 : parties.length;
  const unconfirmedCount = parties.filter((p) => !p.confirmed).length;
  let clientValue: string;
  let clientTone: Tone;
  if (parties.length === 0) {
    clientValue = 'None yet';
    clientTone = 'attention'; // precondition-empty (conflicts need a client)
  } else if (!leadClient) {
    clientValue = `No client · ${parties.length} part${parties.length === 1 ? 'y' : 'ies'}`;
    clientTone = 'attention';
  } else {
    clientValue =
      `${leadClient.displayName}` +
      (otherCount > 0 ? ` +${otherCount}` : '') +
      (unconfirmedCount > 0 ? ` · ${unconfirmedCount} unconfirmed` : '');
    clientTone = leadClient.confirmed && unconfirmedCount === 0 ? 'neutral' : 'attention';
  }
  const clientBlock: BlockData = { key: 'client', label: 'Client / parties', value: clientValue, tone: clientTone, identity: true };

  // 3) Conflicts
  const conflict = conflictBlock(conflictClearance.state, conflictClearance.reasons);
  const conflictsBlock: BlockData = { key: 'conflicts', label: 'Conflicts', value: conflict.value, tone: conflict.tone };

  // 4) Sources — current vs stale (lifecycle 'superseded' = stale); 'None yet' when empty
  const sourceTotal = counts.sourceAuthorities;
  const staleCount = full.sourceAuthorities.filter((s) => s.lifecycle === 'superseded').length;
  const sourcesBlock: BlockData = {
    key: 'sources',
    label: 'Sources',
    value: sourceTotal === 0 ? 'None yet' : staleCount > 0 ? `${sourceTotal} · ${staleCount} stale` : `${sourceTotal} · current`,
    tone: staleCount > 0 ? 'attention' : 'neutral',
  };

  // 5) Open items — the dominant pending act names itself in the value; no eighth block
  const hasDivergent = full.openItems.some((i) => i.status === 'open' && i.category === 'divergent_reviewer_feedback');
  const openOpen = counts.openItemsOpen;
  let openValue: string;
  if (openOpen === 0) {
    openValue = 'None';
  } else {
    const tail = hasDivergent
      ? ' · review divergences'
      : counts.openBlockers > 0
        ? ` · ${counts.openBlockers} blocker${counts.openBlockers === 1 ? '' : 's'}`
        : '';
    openValue = `${openOpen} open${tail}`;
  }
  const openItemsBlock: BlockData = { key: 'open-items', label: 'Open items', value: openValue, tone: openOpen === 0 ? 'neutral' : 'attention' };

  // 6) Document — G3: authoritative = operativeDocument.workflowState (NOT sendability posture)
  const workflow = full.operativeDocument?.workflowState ?? null;
  const documentBlock: BlockData = {
    key: 'document',
    label: 'Document',
    value: workflow ? (WORKFLOW_LABEL[workflow] ?? workflow.replace(/_/g, ' ')) : 'No document yet',
    tone: 'neutral',
  };

  // 7) Sendability — G4 band-wording-only
  const send = sendabilityBlock(full.safeToSend.posture);
  const sendabilityBlockData: BlockData = { key: 'sendability', label: 'Sendability', value: send.value, tone: send.tone };

  // S13: omit the conflicts block only when enforcement is explicitly OFF (undefined/loading -> shown).
  const conflictsEnabled = conflictPolicyQ.data?.enabled !== false;

  const blocks: BlockData[] = [
    jurisdictionBlock,
    clientBlock,
    ...(conflictsEnabled ? [conflictsBlock] : []),
    sourcesBlock,
    openItemsBlock,
    documentBlock,
    sendabilityBlockData,
  ];

  return (
    <div
      className="flex flex-wrap items-stretch bg-surface border border-line rounded-lg overflow-hidden mb-5"
      data-testid="recital-band"
    >
      {blocks.map((b) => (
        <Block key={b.key} block={b} />
      ))}
    </div>
  );
}
