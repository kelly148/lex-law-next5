/**
 * ContextPreviewPanel — Lex Law Next v1
 *
 * Ch 31 — Context Preview Panel
 *
 * Shows the assembled context for a document/matter, including:
 *   - Token budget usage
 *   - Included materials (pinned and non-pinned)
 *   - Included sibling documents
 *   - Excluded and truncated items
 *
 * Procedures used:
 *   - contextPipeline.preview (query)
 *
 * Phase 5 scope: contextPipeline.preview only (no run/execute).
 */
import React, { useState } from 'react';
import { Eye, ChevronDown, ChevronUp, AlertCircle, CheckCircle, Pin, FileText } from 'lucide-react';
import clsx from 'clsx';
import { trpc } from '../trpc.js';

const OPERATIONS = [
  { value: 'context_preview', label: 'Context Preview' },
  { value: 'draft_generation', label: 'Draft Generation' },
  { value: 'regeneration', label: 'Regeneration' },
  { value: 'review', label: 'Review' },
  { value: 'formatting', label: 'Formatting' },
  { value: 'information_request_generation', label: 'Information Request' },
  { value: 'outline_generation', label: 'Outline Generation' },
] as const;

type OperationType = typeof OPERATIONS[number]['value'];

interface ContextPreviewPanelProps {
  matterId: string;
  documentId?: string;
}

export default function ContextPreviewPanel({ matterId, documentId }: ContextPreviewPanelProps): React.ReactElement {
  const [operation, setOperation] = useState<OperationType>('context_preview');
  const [showIncluded, setShowIncluded] = useState(true);
  const [showExcluded, setShowExcluded] = useState(false);

  const { data, isLoading, error } = trpc.contextPipeline.preview.useQuery(
    {
      matterId,
      ...(documentId ? { documentId } : {}),
      operation,
    },
    { staleTime: 30_000 }
  );

  const budgetPercent = data
    ? Math.min(100, Math.round((data.assembledTokens / data.budgetTokens) * 100))
    : 0;

  const budgetColor =
    budgetPercent >= 90 ? 'bg-red-500' :
    budgetPercent >= 70 ? 'bg-amber-500' :
    'bg-green-500';

  return (
    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 bg-gray-50 border-b border-gray-200">
        <Eye className="w-4 h-4 text-firm-navy" />
        <h3 className="text-sm font-semibold text-firm-navy flex-1">Context Preview</h3>
        <select
          value={operation}
          onChange={(e) => setOperation(e.target.value as OperationType)}
          className="text-xs border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-firm-navy"
        >
          {OPERATIONS.map((op) => (
            <option key={op.value} value={op.value}>{op.label}</option>
          ))}
        </select>
      </div>

      {/* Content */}
      <div className="p-4 space-y-4">
        {isLoading && (
          <p className="text-sm text-gray-400 text-center py-4">Assembling context…</p>
        )}

        {error && (
          <div className="flex items-center gap-2 text-red-600 text-sm">
            <AlertCircle className="w-4 h-4" />
            {error.message === 'PINNED_OVERFLOW'
              ? 'Pinned materials exceed the token budget. Unpin some materials to proceed.'
              : `Error: ${error.message}`}
          </div>
        )}

        {data && (
          <>
            {/* Token budget bar */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium text-gray-600">Token Budget</span>
                <span className="text-xs text-gray-500">
                  {data.assembledTokens.toLocaleString()} / {data.budgetTokens.toLocaleString()} ({budgetPercent}%)
                </span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div
                  className={clsx('h-2 rounded-full transition-all', budgetColor)}
                  style={{ width: `${budgetPercent}%` }}
                />
              </div>
            </div>

            {/* Summary counts */}
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="bg-green-50 rounded p-2">
                <div className="text-lg font-semibold text-green-700">{data.includedMaterials.length}</div>
                <div className="text-xs text-green-600">Materials</div>
              </div>
              <div className="bg-blue-50 rounded p-2">
                <div className="text-lg font-semibold text-blue-700">{data.includedSiblings.length}</div>
                <div className="text-xs text-blue-600">Siblings</div>
              </div>
              <div className="bg-gray-50 rounded p-2">
                <div className="text-lg font-semibold text-gray-700">{data.excluded.length + data.truncated.length}</div>
                <div className="text-xs text-gray-600">Excluded/Truncated</div>
              </div>
            </div>

            {/* Included materials */}
            {data.includedMaterials.length > 0 && (
              <div>
                <button
                  onClick={() => setShowIncluded(!showIncluded)}
                  className="flex items-center gap-2 w-full text-xs font-medium text-gray-700 hover:text-firm-navy mb-2"
                >
                  <CheckCircle className="w-3.5 h-3.5 text-green-600" />
                  <span>Included Materials ({data.includedMaterials.length})</span>
                  {showIncluded ? <ChevronUp className="w-3 h-3 ml-auto" /> : <ChevronDown className="w-3 h-3 ml-auto" />}
                </button>
                {showIncluded && (
                  <div className="space-y-1">
                    {data.includedMaterials.map((m) => (
                      <div key={m.materialId} className="flex items-center gap-2 text-xs px-2 py-1 bg-gray-50 rounded">
                        {m.pinned && <Pin className="w-3 h-3 text-firm-gold flex-shrink-0" />}
                        <span className="flex-1 truncate text-gray-700">
                          {m.filename ?? `Material ${m.materialId.slice(0, 8)}…`}
                        </span>
                        <span className="text-gray-400 flex-shrink-0">
                          Tier {m.tier} · {m.tokenEstimate.toLocaleString()} tok
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Included siblings */}
            {data.includedSiblings.length > 0 && (
              <div>
                <div className="flex items-center gap-2 text-xs font-medium text-gray-700 mb-2">
                  <FileText className="w-3.5 h-3.5 text-blue-600" />
                  <span>Sibling Documents ({data.includedSiblings.length})</span>
                </div>
                <div className="space-y-1">
                  {data.includedSiblings.map((s) => (
                    <div key={s.documentId} className="flex items-center gap-2 text-xs px-2 py-1 bg-blue-50 rounded">
                      <span className="flex-1 truncate text-gray-700">{s.documentTitle}</span>
                      <span className="text-gray-400 flex-shrink-0">
                        v{s.versionNumber} · {s.tokenEstimate.toLocaleString()} tok
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Excluded / truncated */}
            {(data.excluded.length > 0 || data.truncated.length > 0) && (
              <div>
                <button
                  onClick={() => setShowExcluded(!showExcluded)}
                  className="flex items-center gap-2 w-full text-xs font-medium text-gray-700 hover:text-firm-navy mb-2"
                >
                  <AlertCircle className="w-3.5 h-3.5 text-amber-500" />
                  <span>
                    Excluded ({data.excluded.length}) / Truncated ({data.truncated.length})
                  </span>
                  {showExcluded ? <ChevronUp className="w-3 h-3 ml-auto" /> : <ChevronDown className="w-3 h-3 ml-auto" />}
                </button>
                {showExcluded && (
                  <div className="space-y-1">
                    {data.excluded.map((e) => (
                      <div key={e.id} className="flex items-center gap-2 text-xs px-2 py-1 bg-amber-50 rounded">
                        <span className="flex-1 truncate text-gray-600">{e.id.slice(0, 8)}…</span>
                        <span className="text-amber-600 flex-shrink-0">{e.reason.replace(/_/g, ' ')}</span>
                      </div>
                    ))}
                    {data.truncated.map((t) => (
                      <div key={t.id} className="flex items-center gap-2 text-xs px-2 py-1 bg-orange-50 rounded">
                        <span className="flex-1 truncate text-gray-600">{t.id.slice(0, 8)}…</span>
                        <span className="text-orange-600 flex-shrink-0">
                          truncated: {t.originalTokens.toLocaleString()} → {t.truncatedTokens.toLocaleString()} tok
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
