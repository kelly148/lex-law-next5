/**
 * ClosurePackagePanel — FOLD-DRAFT-1 / package (Increment 3: closing-package UI).
 *
 * Matter-scoped surface to assemble a named CLOSING PACKAGE — gather the documents / materials /
 * sources + checklist items, mark each required-vs-optional and present / missing / not-applicable,
 * and SEE an advisory completeness check (which required items are still missing). Recording an
 * item is an explicit attorney act (the server tags recordedBy='attorney', validates the
 * itemType/refId pairing, and audits it). DEFAULT-SAFE / ADVISORY: it surfaces what is missing —
 * it never finalizes, sends, or locks the package (sending is FOLD-SEND-1). The attorney is the
 * decision-maker. No business logic in React (Ch 35.3); the server owns the completeness engine +
 * invariant + audit.
 *
 * Rules of Hooks (the phase-3 #310 lesson): ALL hooks run every render, before any early return.
 */
import React, { useState } from 'react';
import { Package, ChevronDown, ChevronUp, Plus, CheckCircle2, AlertTriangle, MinusCircle } from 'lucide-react';
import { trpc } from '../trpc.js';
import { useGuardedMutation } from '../hooks/useGuardedMutation.js';
import type {
  ClosurePackageItemType,
  ClosurePackageRequirement,
  ClosurePackageItemStatus,
} from '../../shared/schemas/closurePackage.js';

interface ClosurePackagePanelProps {
  matterId: string;
}

const ITEM_TYPES: ClosurePackageItemType[] = ['document', 'material', 'source', 'checklist'];
// Artifact-referencing types require a refId (mirrors the server invariant in closurePackageRules.ts).
const ITEM_TYPES_REQUIRING_REF: ClosurePackageItemType[] = ['document', 'material', 'source'];
const REQUIREMENTS: ClosurePackageRequirement[] = ['required', 'optional'];
const STATUSES: ClosurePackageItemStatus[] = ['present', 'missing', 'not_applicable'];

export default function ClosurePackagePanel({ matterId }: ClosurePackagePanelProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [packageName, setPackageName] = useState('Closing Package');
  const [label, setLabel] = useState('');
  const [itemType, setItemType] = useState<ClosurePackageItemType>('document');
  const [refId, setRefId] = useState('');
  const [requirement, setRequirement] = useState<ClosurePackageRequirement>('required');
  const [status, setStatus] = useState<ClosurePackageItemStatus>('present');
  const [notes, setNotes] = useState('');

  const utils = trpc.useUtils();
  const nameReady = packageName.trim() !== '';
  const items = trpc.closurePackage.listForPackage.useQuery(
    { matterId, packageName: packageName.trim() },
    { enabled: open && nameReady },
  );
  const check = trpc.closurePackage.getClosureCheck.useQuery(
    { matterId, packageName: packageName.trim() },
    { enabled: open && nameReady },
  );

  const record = useGuardedMutation(
    (input: {
      matterId: string;
      packageName: string;
      itemType: ClosurePackageItemType;
      refId?: string | null;
      label: string;
      requirement: ClosurePackageRequirement;
      status: ClosurePackageItemStatus;
      notes?: string | null;
    }) => utils.client.closurePackage.record.mutate(input),
    {
      onSuccess: () => {
        setLabel('');
        setRefId('');
        setNotes('');
        void utils.closurePackage.listForPackage.invalidate({ matterId, packageName: packageName.trim() });
        void utils.closurePackage.getClosureCheck.invalidate({ matterId, packageName: packageName.trim() });
      },
    },
  );

  // All hooks above run every render (stable order). Derivations + gating below.
  const rows = items.data ?? [];
  const summary = check.data ?? { total: 0, requiredTotal: 0, requiredPresent: 0, requiredMissing: 0, complete: true, missingLabels: [] };

  const needsRef = ITEM_TYPES_REQUIRING_REF.includes(itemType);
  const refProvided = refId.trim() !== '';
  const refValid = needsRef ? refProvided : !refProvided;
  const canRecord = nameReady && label.trim() !== '' && refValid && !record.isPending;

  const submit = (): void => {
    if (!canRecord) return;
    record.mutate({
      matterId,
      packageName: packageName.trim(),
      itemType,
      refId: needsRef ? refId.trim() : null,
      label: label.trim(),
      requirement,
      status,
      notes: notes.trim() !== '' ? notes.trim() : null,
    });
  };

  const statusChip = (s: ClosurePackageItemStatus): React.ReactElement => {
    if (s === 'present') {
      return (
        <span className="inline-flex items-center gap-1 text-[10px] text-green-700">
          <CheckCircle2 className="w-3 h-3" /> present
        </span>
      );
    }
    if (s === 'missing') {
      return (
        <span className="inline-flex items-center gap-1 text-[10px] text-amber-700">
          <AlertTriangle className="w-3 h-3" /> missing
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 text-[10px] text-gray-400">
        <MinusCircle className="w-3 h-3" /> n/a
      </span>
    );
  };

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden mb-4">
      <button onClick={() => setOpen(!open)} className="flex items-center gap-2 w-full px-4 py-3 bg-gray-50 hover:bg-gray-100">
        <Package className="w-4 h-4 text-firm-navy" />
        <h3 className="text-sm font-semibold text-firm-navy flex-1 text-left">Closing package</h3>
        {open && nameReady && summary.requiredMissing > 0 && (
          <span className="text-xs px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">{summary.requiredMissing} missing</span>
        )}
        {open && nameReady && summary.requiredMissing === 0 && summary.requiredTotal > 0 && (
          <span className="text-xs px-1.5 py-0.5 rounded bg-green-100 text-green-800">complete</span>
        )}
        {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>

      {open && (
        <div className="p-4 space-y-4">
          <p className="text-[11px] text-gray-500">
            Assemble a self-contained closing package — the documents, materials, sources, and checklist items needed to
            wrap this matter. The completeness check below is advisory; it surfaces what&apos;s missing and never finalizes,
            sends, or locks anything. You are always the decision-maker.
          </p>

          <div className="flex items-center gap-2">
            <label className="text-[11px] text-gray-600">Package</label>
            <input
              value={packageName}
              onChange={(e) => setPackageName(e.target.value)}
              placeholder="Package name"
              className="flex-1 text-xs border border-gray-300 rounded px-2 py-1"
            />
          </div>

          {nameReady && (
            <div className="text-[11px] text-gray-600">
              {summary.requiredTotal === 0 ? (
                <span>No required items yet — add the items this package must contain.</span>
              ) : summary.complete ? (
                <span className="text-green-700">All {summary.requiredTotal} required item(s) in hand.</span>
              ) : (
                <span className="text-amber-700">
                  {summary.requiredMissing} of {summary.requiredTotal} required item(s) missing: {summary.missingLabels.join(', ')}
                </span>
              )}
            </div>
          )}

          {rows.length > 0 && (
            <ul className="space-y-1">
              {rows.map((r) => (
                <li key={r.id} className="px-2 py-1.5 border border-gray-200 rounded text-[11px] text-gray-600">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-gray-800">{r.label}</span>
                    {statusChip(r.status)}
                  </div>
                  <div className="text-gray-400 mt-0.5">
                    {r.itemType}
                    {r.requirement === 'required' ? ' · required' : ' · optional'}
                    {r.refId ? ` · ${r.refId}` : ''}
                  </div>
                </li>
              ))}
            </ul>
          )}

          {/* Add-item form */}
          <div className="border border-gray-200 rounded p-2 space-y-2">
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Item (e.g. Executed Durable POA)"
              className="w-full text-xs border border-gray-300 rounded px-2 py-1"
            />
            <div className="flex gap-2">
              <select
                value={itemType}
                onChange={(e) => setItemType(e.target.value as ClosurePackageItemType)}
                className="text-xs border border-gray-300 rounded px-2 py-1"
              >
                {ITEM_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
              <input
                value={refId}
                onChange={(e) => setRefId(e.target.value)}
                placeholder={needsRef ? 'ref id (required)' : 'no ref id'}
                disabled={!needsRef}
                className="flex-1 text-xs border border-gray-300 rounded px-2 py-1 disabled:bg-gray-100"
              />
            </div>
            <div className="flex gap-2">
              <select
                value={requirement}
                onChange={(e) => setRequirement(e.target.value as ClosurePackageRequirement)}
                className="flex-1 text-xs border border-gray-300 rounded px-2 py-1"
              >
                {REQUIREMENTS.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as ClosurePackageItemStatus)}
                className="flex-1 text-xs border border-gray-300 rounded px-2 py-1"
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Notes (optional)"
              rows={2}
              className="w-full text-xs border border-gray-300 rounded px-2 py-1"
            />
            <button
              onClick={submit}
              disabled={!canRecord}
              className="flex items-center gap-1 px-2.5 py-1 text-[11px] bg-firm-navy text-white rounded hover:bg-firm-navy/90 disabled:opacity-50"
            >
              <Plus className="w-3 h-3" />
              {record.isPending ? 'Adding…' : 'Add item'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
