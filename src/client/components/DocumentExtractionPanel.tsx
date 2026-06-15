/**
 * DocumentExtractionPanel — FOLD-PM-2 (document-type structured extraction surface).
 *
 * A flag-gated, per-material panel: runs / shows the deterministic document-type
 * extraction (title commitment / deed / survey / settlement). Surfaces the classified
 * type + per-field values + confidence, and honestly flags low-confidence extractions
 * and withheld (below-floor) field values. Renders nothing when DOCUMENT_EXTRACTION
 * is OFF (default). Read-mostly: the only action is re-running the PURE no-egress parser.
 */
import React from 'react';
import { FileSearch, AlertTriangle } from 'lucide-react';
import { trpc } from '../trpc.js';
import { useGuardedMutation } from '../hooks/useGuardedMutation.js';

const TYPE_LABELS: Record<string, string> = {
  title_commitment: 'Title commitment',
  deed: 'Deed',
  survey: 'Survey',
  settlement_statement: 'Settlement statement',
  unknown: 'Unrecognized',
};

export function DocumentExtractionPanel({ materialId }: { materialId: string }): React.ReactElement | null {
  // Hooks run before any early return (Rules of Hooks).
  const { data: flag } = trpc.materialExtraction.isEnabled.useQuery();
  const enabled = flag?.enabled === true;
  const utils = trpc.useUtils();
  const extractionQuery = trpc.materialExtraction.getForMaterial.useQuery({ materialId }, { enabled });

  const extractMutation = useGuardedMutation(
    (input: { materialId: string }) => utils.client.materialExtraction.extract.mutate(input),
    {
      onSuccess: () => {
        void utils.materialExtraction.getForMaterial.invalidate({ materialId });
      },
    },
  );

  if (!enabled) return null;

  const extraction = extractionQuery.data;

  return (
    <div data-testid="document-extraction-panel" className="border-t border-gray-100 pt-2">
      <div className="flex items-center justify-between mb-1.5">
        <span className="flex items-center gap-1.5 text-xs font-medium text-ink-secondary">
          <FileSearch className="w-3.5 h-3.5" />
          Document extraction
        </span>
        <button
          type="button"
          data-testid="extraction-run-button"
          disabled={extractMutation.isPending}
          onClick={() => extractMutation.mutate({ materialId })}
          className="text-xs px-2 py-0.5 rounded border border-line text-ink-secondary hover:text-ink disabled:opacity-50"
        >
          {extraction ? 'Re-run' : 'Extract'}
        </button>
      </div>

      {!extraction ? (
        <p className="text-xs text-ink-hint italic">Not yet extracted.</p>
      ) : (
        <div data-testid="extraction-result" className="space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-ink">
              {TYPE_LABELS[extraction.documentType] ?? extraction.documentType}
            </span>
            <span className="text-xs text-ink-hint">{extraction.overallConfidence}% confidence</span>
          </div>

          {extraction.lowConfidence && (
            <div
              data-testid="extraction-low-confidence"
              className="flex items-start gap-1.5 text-xs text-amber-700 bg-amber-50 rounded px-2 py-1"
            >
              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
              <span>Low-confidence extraction — verify against the source document before relying on it.</span>
            </div>
          )}

          {extraction.fields.length > 0 && (
            <ul className="space-y-0.5">
              {extraction.fields.map((f) => (
                <li key={f.key} data-testid="extraction-field" className="flex justify-between gap-3 text-xs">
                  <span className="text-ink-hint flex-shrink-0">{f.label}</span>
                  <span className="text-ink text-right truncate">
                    {f.value !== null ? (
                      f.value
                    ) : f.withheld ? (
                      <span className="text-amber-700 italic">withheld (low confidence)</span>
                    ) : (
                      <span className="text-ink-hint italic">not found</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
