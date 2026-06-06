/**
 * MatterRecordLedger — Whereas R2 #7 (Matter Record ledger).
 *
 * A read-only, chronological projection of the matter's audit_events (newest first) — every recorded
 * act on the matter (locks, adoptions, dispositions, confirmations, conflict acts, etc.). A PLAIN
 * LEDGER per the disposition keep-list: no analytics, no editing, no charts. Re-presents existing data
 * via the new matter.auditLog read; it writes nothing.
 *
 * Collapsible matter panel (the disposition's recommended placement — a matter panel, not a standalone
 * screen, not buried). Rules of Hooks (#310 lesson): all hooks run before any return. No blue.
 */
import React, { useState } from 'react';
import { ScrollText, ChevronDown, ChevronUp } from 'lucide-react';
import { trpc } from '../trpc.js';

interface MatterRecordLedgerProps {
  matterId: string;
}

export default function MatterRecordLedger({ matterId }: MatterRecordLedgerProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const events = trpc.matter.auditLog.useQuery({ matterId }, { enabled: open });

  const rows = events.data ?? [];

  return (
    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden mb-6">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 w-full px-4 py-3 bg-gray-50 border-b border-gray-200 hover:bg-gray-100"
      >
        <ScrollText className="w-4 h-4 text-firm-navy" />
        <h3 className="text-sm font-semibold text-firm-navy flex-1 text-left">Matter Record</h3>
        {open && rows.length > 0 && <span className="text-xs text-gray-400">{rows.length} event{rows.length === 1 ? '' : 's'}</span>}
        {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>

      {open && (
        <div className="p-4" data-testid="matter-record-ledger">
          <p className="text-[11px] text-gray-400 mb-2">A read-only, chronological record of recorded acts on this matter (newest first).</p>
          {events.isLoading && <p className="text-xs text-gray-400">Loading record…</p>}
          {!events.isLoading && rows.length === 0 && <p className="text-xs text-gray-400">No recorded acts yet.</p>}
          <div className="space-y-1">
            {rows.map((e) => (
              <div key={e.id} className="text-xs border-b border-gray-100 py-1.5 last:border-b-0" data-testid="matter-record-row">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-gray-400">{new Date(e.createdAt).toLocaleString()}</span>
                  <span className="px-1 rounded text-[10px] bg-gray-100 text-gray-600">
                    {e.actor}{e.actorModel ? ` · ${e.actorModel}` : ''}
                  </span>
                  {e.action && <span className="px-1 rounded text-[10px] bg-accent-tint text-accent">{e.action}</span>}
                  <span className="flex-1 text-gray-700">{e.summary}</span>
                </div>
                {e.rationale && <p className="text-[11px] text-gray-500 mt-0.5 pl-2 border-l border-gray-200">{e.rationale}</p>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
