/**
 * ProvenanceLedgerPanel — CHAT-UI-1 W2 query/export surface (brief W2 §3).
 *
 * Renders the matter's chronological posture-provenance ledger and a portable JSON export. Read-only
 * audit view; ships its empty / loading / error states (W5 discipline). Mounted only inside the
 * flag-gated conversation surface, so it is inert when CHAT_UI_1_ENABLED is off.
 */
import React, { useState } from 'react';
import { Download, ShieldAlert } from 'lucide-react';
import { usePostureProvenance } from '../hooks/usePostureProvenance.js';
import { serializeProvenanceExport } from '../../shared/posture/provenanceExport.js';

export default function ProvenanceLedgerPanel({ matterId }: { matterId: string }): React.ReactElement {
  const { entries, isLoading, isError, exportBundle } = usePostureProvenance(matterId);
  const [exporting, setExporting] = useState(false);

  const onExport = async (): Promise<void> => {
    setExporting(true);
    try {
      const json = serializeProvenanceExport(await exportBundle());
      // Best-effort download; guarded so a non-browser/test environment simply no-ops.
      if (typeof document !== 'undefined' && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
        const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = `provenance-${matterId}.json`;
        a.click();
        URL.revokeObjectURL(url);
      }
    } finally {
      setExporting(false);
    }
  };

  return (
    <div data-testid="provenance-ledger" className="mt-4 flex flex-col rounded border border-line">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <h3 className="text-xs font-medium uppercase tracking-wide text-ink-hint">Provenance ledger</h3>
        <button
          data-testid="provenance-export"
          onClick={() => void onExport()}
          disabled={isLoading || entries.length === 0 || exporting}
          className="ml-auto flex items-center gap-1 rounded btn-secondary px-2 py-1 text-xs"
        >
          <Download className="h-3 w-3" /> Export
        </button>
      </div>

      {isLoading && (
        <p data-testid="provenance-loading" className="px-3 py-3 text-xs text-ink-hint">
          Loading…
        </p>
      )}
      {!isLoading && isError && (
        <p data-testid="provenance-error" className="px-3 py-3 text-xs text-red-600">
          Could not load the provenance ledger.
        </p>
      )}
      {!isLoading && !isError && entries.length === 0 && (
        <p data-testid="provenance-empty" className="px-3 py-3 text-xs text-ink-hint">
          No recorded posture decisions yet.
        </p>
      )}
      {!isLoading && !isError && entries.length > 0 && (
        <ul data-testid="provenance-list" className="divide-y divide-line">
          {entries.map((e) => (
            <li key={e.id} data-testid="provenance-row" className="px-3 py-2 text-xs">
              <div className="flex items-center gap-2">
                <span className="font-medium text-ink">{e.act}</span>
                <span className="text-ink-hint">{e.eventClass === 'meaningful_accept' ? 'accept' : 'transition'}</span>
                {e.verdictSeverity === 'hard' && (
                  <span className="inline-flex items-center gap-0.5 text-red-700">
                    <ShieldAlert className="h-3 w-3" />
                    blocked
                  </span>
                )}
                {e.verdictSeverity === 'soft' && <span className="text-amber-700">warned</span>}
                <span className="ml-auto text-ink-hint">{e.confirmedAt}</span>
              </div>
              {e.recipient && <div className="mt-0.5 text-ink-secondary">to {e.recipient}</div>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
