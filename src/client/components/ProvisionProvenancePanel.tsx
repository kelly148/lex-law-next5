/**
 * ProvisionProvenancePanel — FOLD-DRAFT-1 Increment 3 (provision-provenance UI).
 *
 * Document-scoped surface to RECORD and SEE where each draft section (provision) came from.
 * Recording is an explicit attorney act (the server tags recordedBy='attorney', validates the
 * origin pairing, and audits it). DEFAULT-SAFE: provenance is recorded + surfaced only — it never
 * auto-justifies outbound assertions. No business logic in React (Ch 35.3); the server owns the
 * invariant + audit. Records anchor to the document's CURRENT version.
 */
import React, { useState } from 'react';
import { GitBranch, ChevronDown, ChevronUp, Plus } from 'lucide-react';
import { trpc } from '../trpc.js';
import { useGuardedMutation } from '../hooks/useGuardedMutation.js';
import type { ProvisionOriginType } from '../../shared/schemas/provisionProvenance.js';

interface ProvisionProvenancePanelProps {
  documentId: string;
}

const ORIGIN_TYPES: ProvisionOriginType[] = [
  'operative_source',
  'material',
  'adopted_suggestion',
  'template',
  'attorney_authored',
  'model_generated',
  'loi',
];
// Source-referencing types require an originId (mirrors the server invariant in provenanceRules.ts).
const ORIGIN_TYPES_REQUIRING_ID: ProvisionOriginType[] = [
  'operative_source',
  'material',
  'adopted_suggestion',
  'template',
  'loi',
];

export default function ProvisionProvenancePanel({ documentId }: ProvisionProvenancePanelProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [sectionTitle, setSectionTitle] = useState('');
  const [orderIndex, setOrderIndex] = useState('0');
  const [originType, setOriginType] = useState<ProvisionOriginType>('operative_source');
  const [originId, setOriginId] = useState('');
  const [originLabel, setOriginLabel] = useState('');
  const [notes, setNotes] = useState('');

  const utils = trpc.useUtils();
  const rows = trpc.provisionProvenance.listForDocument.useQuery({ documentId }, { enabled: open });
  const doc = trpc.document.get.useQuery({ documentId }, { enabled: open });

  const record = useGuardedMutation(
    (input: {
      documentId: string;
      versionId: string;
      orderIndex: number;
      sectionTitle: string;
      originType: ProvisionOriginType;
      originId?: string | null;
      originLabel?: string | null;
      notes?: string | null;
    }) => utils.client.provisionProvenance.record.mutate(input),
    {
      onSuccess: () => {
        setSectionTitle('');
        setOriginId('');
        setOriginLabel('');
        setNotes('');
        void utils.provisionProvenance.listForDocument.invalidate({ documentId });
      },
    },
  );

  const recorded = rows.data ?? [];
  const currentVersionId = doc.data?.currentVersionId ?? null;
  const needsId = ORIGIN_TYPES_REQUIRING_ID.includes(originType);
  const idProvided = originId.trim() !== '';
  const parsedOrder = Number.parseInt(orderIndex, 10);
  const orderValid = Number.isInteger(parsedOrder) && parsedOrder >= 0;
  // Mirror the server invariant so the button is enabled only for a valid record.
  const originValid = needsId ? idProvided : !idProvided;
  const canRecord =
    currentVersionId !== null && sectionTitle.trim() !== '' && orderValid && originValid && !record.isPending;

  const submit = () => {
    if (!canRecord || currentVersionId === null) return;
    record.mutate({
      documentId,
      versionId: currentVersionId,
      orderIndex: parsedOrder,
      sectionTitle: sectionTitle.trim(),
      originType,
      originId: needsId ? originId.trim() : null,
      originLabel: originLabel.trim() !== '' ? originLabel.trim() : null,
      notes: notes.trim() !== '' ? notes.trim() : null,
    });
  };

  return (
    <div className="border-t border-gray-200">
      <button onClick={() => setOpen(!open)} className="flex items-center gap-2 w-full px-4 py-3 bg-gray-50 hover:bg-gray-100">
        <GitBranch className="w-4 h-4 text-firm-navy" />
        <h3 className="text-sm font-semibold text-firm-navy flex-1 text-left">Provision provenance</h3>
        {recorded.length > 0 && <span className="text-xs px-1.5 py-0.5 rounded bg-gray-200 text-gray-700">{recorded.length}</span>}
        {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>

      {open && (
        <div className="p-4 space-y-4">
          <p className="text-[11px] text-gray-500">
            Record where each section of this draft came from. This is surfaced for your reference and audit — it is never used to auto-justify the draft. You are always the decision-maker.
          </p>

          {/* Recorded provenance, by section order */}
          {recorded.length === 0 ? (
            <p className="text-xs text-gray-400">No provenance recorded yet.</p>
          ) : (
            <ul className="space-y-1">
              {recorded.map((r) => (
                <li key={r.id} className="px-2 py-1.5 border border-gray-200 rounded text-[11px] text-gray-600">
                  <span className="font-medium text-gray-800">#{r.orderIndex} {r.sectionTitle}</span>
                  {' — '}
                  {r.originType}
                  {r.originLabel ? `: ${r.originLabel}` : r.originId ? ` (${r.originId})` : ''}
                  <span className="text-gray-400"> · {r.recordedBy}</span>
                  {r.notes ? <div className="text-gray-500 mt-0.5">{r.notes}</div> : null}
                </li>
              ))}
            </ul>
          )}

          {/* Record form */}
          <div className="border border-gray-200 rounded p-2 space-y-2">
            <div className="flex gap-2">
              <input
                value={orderIndex}
                onChange={(e) => setOrderIndex(e.target.value)}
                type="number"
                min={0}
                className="w-16 text-xs border border-gray-300 rounded px-2 py-1"
                aria-label="Section order index"
              />
              <input
                value={sectionTitle}
                onChange={(e) => setSectionTitle(e.target.value)}
                placeholder="Section title"
                className="flex-1 text-xs border border-gray-300 rounded px-2 py-1"
              />
            </div>
            <div className="flex gap-2">
              <select
                value={originType}
                onChange={(e) => setOriginType(e.target.value as ProvisionOriginType)}
                className="text-xs border border-gray-300 rounded px-2 py-1"
              >
                {ORIGIN_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
              <input
                value={originId}
                onChange={(e) => setOriginId(e.target.value)}
                placeholder={needsId ? 'origin id (required)' : 'no origin id'}
                disabled={!needsId}
                className="flex-1 text-xs border border-gray-300 rounded px-2 py-1 disabled:bg-gray-100"
              />
            </div>
            <input
              value={originLabel}
              onChange={(e) => setOriginLabel(e.target.value)}
              placeholder="Origin label (optional)"
              className="w-full text-xs border border-gray-300 rounded px-2 py-1"
            />
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Notes (optional)"
              rows={2}
              className="w-full text-xs border border-gray-300 rounded px-2 py-1"
            />
            {currentVersionId === null && (
              <p className="text-[11px] text-amber-700">This document has no current version yet — generate a draft first.</p>
            )}
            <button
              onClick={submit}
              disabled={!canRecord}
              className="flex items-center gap-1 px-2.5 py-1 text-[11px] bg-firm-navy text-white rounded hover:bg-opacity-90 disabled:opacity-50"
            >
              <Plus className="w-3 h-3" />
              {record.isPending ? 'Recording…' : 'Record provenance'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
