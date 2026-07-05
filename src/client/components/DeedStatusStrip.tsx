/**
 * DeedStatusStrip — DEED-DOC-PAGE-LAYOUT-1 (sweep S1).
 *
 * A single compact, neutral status line for the deed document page. It REPLACES the stacked
 * recordability + sign-off panels that used to sit ABOVE the document (which buried the deed the
 * attorney came to read). The heavy checklist / sign-off / affirmative-acts machinery now lives in a
 * collapsed drawer BELOW the document; this strip is the at-a-glance summary + the entry point.
 *
 * DISPLAY ONLY. It reads the SAME server evaluation the panel reads (deedGate.get) and shows neutral
 * counts — no verdict banners, no teaching prose. Gate SEMANTICS are untouched: what blocks, what is
 * recorded, what D3/sendability enforce all still live in the (relocated) panels. Self-gates on
 * deedGate.isEnabled so it is dark on prod until the gate is activated (mirrors DeedGatePanel), which is
 * also why the isEnabled probe lives here and not in DocumentDetail (uat_m1_deed_gate_mount_1 pins that
 * the page itself never re-implements the flag gate).
 *
 * Audience principle (UI-ATTORNEY-SWEEP-1): the reader is an attorney. Terse facts and counts; the
 * explanations live behind the expansion, once. The machinery is bookkeeping and evidence, not
 * supervision.
 */
import React from 'react';
import { ListChecks, ChevronRight } from 'lucide-react';
import { trpc } from '../trpc.js';

export function DeedStatusStrip({
  documentId,
  onOpenChecklist,
}: {
  documentId: string;
  onOpenChecklist: () => void;
}): React.ReactElement | null {
  const enabledQ = trpc.deedGate.isEnabled.useQuery();
  // Hook called unconditionally above; dark until the deed gate is enabled (prod default OFF).
  if (!enabledQ.data?.enabled) return null;
  return <DeedStatusStripInner documentId={documentId} onOpenChecklist={onOpenChecklist} />;
}

function DeedStatusStripInner({
  documentId,
  onOpenChecklist,
}: {
  documentId: string;
  onOpenChecklist: () => void;
}): React.ReactElement | null {
  const getQ = trpc.deedGate.get.useQuery({ documentId });
  const signoffEnabledQ = trpc.deedSignoff.isEnabled.useQuery();
  const d3On =
    signoffEnabledQ.data?.mode === 'observe' || signoffEnabledQ.data?.mode === 'enforce';
  const signoffQ = trpc.deedSignoff.getComparison.useQuery(
    { documentId },
    { enabled: d3On },
  );

  // Not a deed / not found → the gate doesn't apply; render nothing rather than an error box (the
  // mount is already gated on documentType==='deed', so this is only the transient/edge case).
  if (getQ.error) return null;
  if (!getQ.data) {
    return (
      <div
        data-no-print
        data-testid="deed-status-strip"
        className="mb-3 flex items-center gap-2 rounded-lg border border-line bg-surface px-4 py-2 text-xs text-ink-hint"
      >
        <ListChecks className="w-4 h-4" />
        <span>Recording status…</span>
      </div>
    );
  }

  const ev = getQ.data.evaluation;
  // "Open" = the union of the three gates' distinct blocking reasons (each maps to one checklist
  // line-item). Union, not sum, so a reason shared across gates isn't double-counted.
  const openCount = new Set<string>([
    ...ev.assembly.blockingReasons,
    ...ev.legalReview.blockingReasons,
    ...ev.recordability.blockingReasons,
  ]).size;
  const recordable = ev.recordable;

  const signoffRecorded =
    d3On && !signoffQ.error && signoffQ.data ? signoffQ.data.alreadySignedOff === true : null;

  return (
    <div
      data-no-print
      data-testid="deed-status-strip"
      className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-line bg-surface px-4 py-2 text-xs text-ink-secondary"
    >
      <ListChecks className="w-4 h-4 text-ink-hint shrink-0" />
      <span>
        Recording checklist:{' '}
        <span className="font-medium text-ink">
          {recordable ? 'cleared' : `${openCount} open`}
        </span>
      </span>
      {d3On && signoffRecorded !== null && (
        <>
          <span className="text-ink-hint" aria-hidden>
            ·
          </span>
          <span>
            Source sign-off:{' '}
            <span className="font-medium text-ink">
              {signoffRecorded ? 'recorded' : 'not recorded'}
            </span>
          </span>
        </>
      )}
      <button
        type="button"
        data-testid="deed-status-open-checklist"
        onClick={onOpenChecklist}
        className="ml-auto inline-flex items-center gap-1 rounded border border-line px-2 py-1 text-xs text-ink hover:bg-surface-2"
      >
        Open checklist
        <ChevronRight className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

export default DeedStatusStrip;
