/**
 * VersionComparePanel — REVIEW-LOOP-UX-1 / R3 (document version history + compare view).
 *
 * Document-scoped, READ-ONLY surface that lists every version of THIS document (newest-first,
 * owner-scoped via version.list) and compares any two of them. It REUSES the already-built LDD
 * compare engine: version.compare diffs each version's curated key-term DICTIONARY (added / removed /
 * value-changed / unchanged) and flags each version's content drift against its own key terms. The
 * default selection is the two newest versions (vN vs its predecessor vN-1).
 *
 * DEFAULT-SAFE: the comparison surfaces what changed between two versions for the attorney to review —
 * it never edits a draft and never asserts a version is wrong. No business logic in React (Ch 35.3);
 * the server owns the diff engine. The attorney is always the decision-maker.
 *
 * Rules of Hooks (the phase-3 #310 lesson): ALL hooks run every render, before any early return.
 * Selection is held as a (versionId | '') pair that FALLS BACK to the derived default at use-time —
 * no useEffect+setState, so the hook order is stable across the open/load lifecycle.
 */
import React, { useState } from 'react';
import { GitCompare, GitCompareArrows, ChevronDown, ChevronUp, Plus, MinusCircle, CheckCircle2 } from 'lucide-react';
import { trpc } from '../trpc.js';

interface VersionComparePanelProps {
  documentId: string;
}

export default function VersionComparePanel({ documentId }: VersionComparePanelProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  // '' = "use the derived default" (newest / newest-1). A real versionId overrides it.
  const [selectedA, setSelectedA] = useState('');
  const [selectedB, setSelectedB] = useState('');

  const versionsQuery = trpc.version.list.useQuery({ documentId }, { enabled: open });

  // All hooks above run every render (stable order). Derivations + gating below — never via a
  // conditional mount or a hook after an early return.
  const versions = versionsQuery.data ?? [];
  // version.list returns newest-first (desc versionNumber). Default B = newest, A = its predecessor.
  const defaultBId = versions[0]?.id ?? '';
  const defaultAId = versions[1]?.id ?? versions[0]?.id ?? '';
  const versionAId = selectedA !== '' ? selectedA : defaultAId;
  const versionBId = selectedB !== '' ? selectedB : defaultBId;

  const canCompare = versionAId !== '' && versionBId !== '' && versionAId !== versionBId;

  const compareQuery = trpc.version.compare.useQuery(
    { documentId, versionAId, versionBId },
    { enabled: open && canCompare },
  );

  const diff = compareQuery.data?.dictionaryDiff ?? null;

  const changeChip = (change: 'added' | 'removed' | 'changed' | 'unchanged'): React.ReactElement => {
    if (change === 'added') {
      return (
        <span className="inline-flex items-center gap-1 text-[10px] text-green-700">
          <Plus className="w-3 h-3" /> added
        </span>
      );
    }
    if (change === 'removed') {
      return (
        <span className="inline-flex items-center gap-1 text-[10px] text-red-700">
          <MinusCircle className="w-3 h-3" /> removed
        </span>
      );
    }
    if (change === 'changed') {
      return (
        <span className="inline-flex items-center gap-1 text-[10px] text-amber-700">
          <GitCompareArrows className="w-3 h-3" /> value changed
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 text-[10px] text-gray-400">
        <CheckCircle2 className="w-3 h-3" /> unchanged
      </span>
    );
  };

  return (
    <div className="border-t border-gray-200">
      <button onClick={() => setOpen(!open)} className="flex items-center gap-2 w-full px-4 py-3 bg-gray-50 hover:bg-gray-100">
        <GitCompare className="w-4 h-4 text-firm-navy" />
        <h3 className="text-sm font-semibold text-firm-navy flex-1 text-left">Version compare</h3>
        {versions.length > 0 && (
          <span className="text-xs px-1.5 py-0.5 rounded bg-gray-200 text-gray-700">{versions.length}</span>
        )}
        {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>

      {open && (
        <div className="p-4 space-y-4">
          <p className="text-[11px] text-gray-500">
            Every version of this document, newest first. Pick two versions to see what changed in the curated
            key-term dictionary between them. This is surfaced for your review and is never used to edit a draft.
            You are always the decision-maker.
          </p>

          {versionsQuery.isLoading && <p className="text-xs text-gray-400">Loading version history…</p>}

          {versionsQuery.data && versions.length === 0 && (
            <p className="text-[11px] text-amber-700">This document has no versions yet — generate a draft first.</p>
          )}

          {versions.length === 1 && (
            <p className="text-[11px] text-amber-700">Only one version exists — generate a new draft to compare against it.</p>
          )}

          {versions.length > 1 && (
            <>
              {/* Version history + the two-version selector. */}
              <ul className="space-y-1">
                {versions.map((v) => (
                  <li key={v.id} className="px-2 py-1.5 border border-gray-200 rounded text-[11px] text-gray-600 flex items-center justify-between gap-2">
                    <span className="font-medium text-gray-800">v{v.versionNumber}</span>
                    <span className="text-gray-400">{new Date(v.createdAt).toLocaleString()}</span>
                  </li>
                ))}
              </ul>

              <div className="flex items-center gap-2 text-[11px] text-gray-600">
                <label className="flex items-center gap-1">
                  <span>Base (A)</span>
                  <select
                    value={versionAId}
                    onChange={(e) => setSelectedA(e.target.value)}
                    className="text-xs border border-gray-300 rounded px-2 py-1"
                  >
                    {versions.map((v) => (
                      <option key={v.id} value={v.id}>v{v.versionNumber}</option>
                    ))}
                  </select>
                </label>
                <GitCompareArrows className="w-3 h-3 text-gray-400" />
                <label className="flex items-center gap-1">
                  <span>Compared (B)</span>
                  <select
                    value={versionBId}
                    onChange={(e) => setSelectedB(e.target.value)}
                    className="text-xs border border-gray-300 rounded px-2 py-1"
                  >
                    {versions.map((v) => (
                      <option key={v.id} value={v.id}>v{v.versionNumber}</option>
                    ))}
                  </select>
                </label>
              </div>

              {!canCompare && (
                <p className="text-[11px] text-amber-700">Pick two different versions to compare.</p>
              )}

              {canCompare && compareQuery.isLoading && (
                <p className="text-xs text-gray-400">Comparing the two versions…</p>
              )}

              {canCompare && diff && (
                <>
                  <div className="text-[11px] text-gray-600">
                    {diff.summary.total === 0 ? (
                      <span>No key terms recorded on either version — nothing to compare.</span>
                    ) : (
                      <span>
                        {diff.summary.added} added · {diff.summary.removed} removed · {diff.summary.changed} changed ·{' '}
                        {diff.summary.unchanged} unchanged · of {diff.summary.total}
                      </span>
                    )}
                  </div>
                  {diff.terms.length > 0 && (
                    <ul className="space-y-1">
                      {diff.terms.map((t) => (
                        <li key={t.termLabel} className="px-2 py-1.5 border border-gray-200 rounded text-[11px] text-gray-600">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium text-gray-800">{t.termLabel}</span>
                            {changeChip(t.change)}
                          </div>
                          {t.change === 'changed' && (
                            <div className="text-gray-500 mt-0.5">
                              <span className="line-through text-red-600">{t.valueA}</span>
                              {' → '}
                              <span className="text-green-700">{t.valueB}</span>
                            </div>
                          )}
                          {t.change === 'added' && t.valueB !== null && (
                            <div className="text-gray-500 mt-0.5">value: {t.valueB}</div>
                          )}
                          {t.change === 'removed' && t.valueA !== null && (
                            <div className="text-gray-500 mt-0.5">was: {t.valueA}</div>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
