/**
 * LddDiffPanel — FOLD-DRAFT-1 / LDD (Increment 3: LOI-vs-draft UI).
 *
 * Document-scoped surface to curate the KEY-TERM DICTIONARY (the defined terms whose agreed value
 * must stay consistent between the operative source/LOI and the draft) and SEE the LOI-vs-draft
 * comparison: each term's agreed value flagged present / absent (drift) / indeterminate in the
 * current draft. Recording a term is an explicit attorney act (the server tags recordedBy='attorney',
 * validates the sourceType/sourceId pairing, and audits it). DEFAULT-SAFE: the comparison FLAGS
 * drift for review — it never edits the draft and never auto-justifies an outbound assertion. No
 * business logic in React (Ch 35.3); the server owns the compare engine + invariant + audit.
 *
 * Rules of Hooks (the phase-3 #310 lesson): ALL hooks run every render, before any early return.
 */
import React, { useState } from 'react';
import { GitCompareArrows, ChevronDown, ChevronUp, Plus, CheckCircle2, AlertTriangle, MinusCircle } from 'lucide-react';
import { trpc } from '../trpc.js';
import { useGuardedMutation } from '../hooks/useGuardedMutation.js';
import type { LddKeyTermSourceType } from '../../shared/schemas/lddKeyTerm.js';

interface LddDiffPanelProps {
  documentId: string;
}

const SOURCE_TYPES: LddKeyTermSourceType[] = ['loi', 'operative_source', 'material', 'attorney_specified'];
// Source-referencing types require a sourceId (mirrors the server invariant in lddKeyTermRules.ts).
const SOURCE_TYPES_REQUIRING_ID: LddKeyTermSourceType[] = ['loi', 'operative_source', 'material'];

export default function LddDiffPanel({ documentId }: LddDiffPanelProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [termLabel, setTermLabel] = useState('');
  const [expectedValue, setExpectedValue] = useState('');
  const [sourceType, setSourceType] = useState<LddKeyTermSourceType>('loi');
  const [sourceId, setSourceId] = useState('');
  const [notes, setNotes] = useState('');

  const utils = trpc.useUtils();
  const comparison = trpc.lddKeyTerm.getComparison.useQuery({ documentId }, { enabled: open });

  const record = useGuardedMutation(
    (input: {
      documentId: string;
      versionId: string;
      termLabel: string;
      expectedValue: string;
      sourceType: LddKeyTermSourceType;
      sourceId?: string | null;
      notes?: string | null;
    }) => utils.client.lddKeyTerm.record.mutate(input),
    {
      onSuccess: () => {
        setTermLabel('');
        setExpectedValue('');
        setSourceId('');
        setNotes('');
        void utils.lddKeyTerm.getComparison.invalidate({ documentId });
      },
    },
  );

  // All hooks above run every render (stable order). Derivations + gating below — never via a
  // conditional mount or a hook after an early return.
  const data = comparison.data;
  const versionId = data?.versionId ?? null;
  const terms = data?.terms ?? [];
  const summary = data?.summary ?? { total: 0, present: 0, absent: 0, indeterminate: 0 };

  const needsId = SOURCE_TYPES_REQUIRING_ID.includes(sourceType);
  const idProvided = sourceId.trim() !== '';
  // Mirror the server invariant so the button is enabled only for a valid record.
  const sourceValid = needsId ? idProvided : !idProvided;
  const canRecord =
    versionId !== null && termLabel.trim() !== '' && expectedValue.trim() !== '' && sourceValid && !record.isPending;

  const submit = (): void => {
    if (!canRecord || versionId === null) return;
    record.mutate({
      documentId,
      versionId,
      termLabel: termLabel.trim(),
      expectedValue: expectedValue.trim(),
      sourceType,
      sourceId: needsId ? sourceId.trim() : null,
      notes: notes.trim() !== '' ? notes.trim() : null,
    });
  };

  const statusChip = (status: 'present' | 'absent' | 'indeterminate'): React.ReactElement => {
    if (status === 'present') {
      return (
        <span className="inline-flex items-center gap-1 text-[10px] text-green-700">
          <CheckCircle2 className="w-3 h-3" /> present
        </span>
      );
    }
    if (status === 'absent') {
      return (
        <span className="inline-flex items-center gap-1 text-[10px] text-amber-700">
          <AlertTriangle className="w-3 h-3" /> not found — review
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 text-[10px] text-gray-400">
        <MinusCircle className="w-3 h-3" /> no value to check
      </span>
    );
  };

  return (
    <div className="border-t border-gray-200">
      <button onClick={() => setOpen(!open)} className="flex items-center gap-2 w-full px-4 py-3 bg-gray-50 hover:bg-gray-100">
        <GitCompareArrows className="w-4 h-4 text-firm-navy" />
        <h3 className="text-sm font-semibold text-firm-navy flex-1 text-left">LOI-vs-draft check</h3>
        {summary.absent > 0 && (
          <span className="text-xs px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">{summary.absent} to review</span>
        )}
        {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>

      {open && (
        <div className="p-4 space-y-4">
          <p className="text-[11px] text-gray-500">
            Track the defined terms whose agreed value must stay consistent between the LOI / operative source and
            this draft. Each term&apos;s value is checked against the current draft and flagged — this is surfaced for
            your review and is never used to edit or auto-justify the draft. You are always the decision-maker.
          </p>

          {comparison.isLoading && <p className="text-xs text-gray-400">Comparing the draft to the key terms…</p>}

          {data && versionId === null && (
            <p className="text-[11px] text-amber-700">This document has no current draft version yet — generate a draft first.</p>
          )}

          {data && versionId !== null && (
            <>
              <div className="text-[11px] text-gray-600">
                {summary.total === 0 ? (
                  <span>No key terms recorded yet — add the agreed terms below to check them against the draft.</span>
                ) : (
                  <span>
                    {summary.present} present · {summary.absent} not found · {summary.indeterminate} no value · of {summary.total}
                  </span>
                )}
              </div>
              {terms.length > 0 && (
                <ul className="space-y-1">
                  {terms.map((t) => (
                    <li key={t.id} className="px-2 py-1.5 border border-gray-200 rounded text-[11px] text-gray-600">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-gray-800">{t.termLabel}</span>
                        {statusChip(t.status)}
                      </div>
                      <div className="text-gray-500 mt-0.5">expected: {t.expectedValue}</div>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}

          {/* Record form */}
          <div className="border border-gray-200 rounded p-2 space-y-2">
            <input
              value={termLabel}
              onChange={(e) => setTermLabel(e.target.value)}
              placeholder="Key term (e.g. Governing Law)"
              className="w-full text-xs border border-gray-300 rounded px-2 py-1"
            />
            <input
              value={expectedValue}
              onChange={(e) => setExpectedValue(e.target.value)}
              placeholder="Agreed value (e.g. Commonwealth of Virginia)"
              className="w-full text-xs border border-gray-300 rounded px-2 py-1"
            />
            <div className="flex gap-2">
              <select
                value={sourceType}
                onChange={(e) => setSourceType(e.target.value as LddKeyTermSourceType)}
                className="text-xs border border-gray-300 rounded px-2 py-1"
              >
                {SOURCE_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
              <input
                value={sourceId}
                onChange={(e) => setSourceId(e.target.value)}
                placeholder={needsId ? 'source id (required)' : 'no source id'}
                disabled={!needsId}
                className="flex-1 text-xs border border-gray-300 rounded px-2 py-1 disabled:bg-gray-100"
              />
            </div>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Notes (optional)"
              rows={2}
              className="w-full text-xs border border-gray-300 rounded px-2 py-1"
            />
            {versionId === null && (
              <p className="text-[11px] text-amber-700">No current draft version — generate a draft before recording key terms.</p>
            )}
            <button
              onClick={submit}
              disabled={!canRecord}
              className="flex items-center gap-1 px-2.5 py-1 text-[11px] bg-firm-navy text-white rounded hover:bg-firm-navy/90 disabled:opacity-50"
            >
              <Plus className="w-3 h-3" />
              {record.isPending ? 'Recording…' : 'Add key term'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
