/**
 * ConflictPostureChip — CONFLICT-TOGGLE-1 Inc 3 (anti-silent-off UX, per-matter surface).
 *
 * The per-matter posture surface the disposition mandates (item 8): a CHIP ("Conflicts gate: ENFORCED /
 * ADVISORY / SANDBOX") plus a STANDING, non-dismissible BANNER whenever the matter is anything other than
 * fully ENFORCED — so a relaxed gate can never sit silently. Reads conflictPolicy.matterGate (the server is
 * authoritative; this is display-only). Self-gates on conflictPolicy.isEnabled so it is absent on prod until
 * the conflict gate is activated.
 *
 * Display only — it never changes a gate decision; the server resolves the effective posture.
 */
import React from 'react';
import { ShieldAlert, ShieldCheck, FlaskConical } from 'lucide-react';
import { trpc } from '../trpc.js';

export function ConflictPostureChip({ matterId }: { matterId: string }): React.ReactElement | null {
  const enabledQ = trpc.conflictPolicy.isEnabled.useQuery();
  // Hook called unconditionally above; dark until the conflict gate is enabled (prod default).
  if (!enabledQ.data?.enabled) return null;
  return <ConflictPostureChipInner matterId={matterId} />;
}

function ConflictPostureChipInner({ matterId }: { matterId: string }): React.ReactElement | null {
  const { data } = trpc.conflictPolicy.matterGate.useQuery({ matterId });
  if (!data) return null;

  const posture = data.posture; // 'ENFORCED' | 'ADVISORY' | 'SANDBOX'
  const chip =
    posture === 'ENFORCED'
      ? { label: 'Conflicts gate: ENFORCED', cls: 'border-firm-navy/30 bg-firm-navy/5 text-firm-navy', Icon: ShieldCheck }
      : posture === 'ADVISORY'
        ? { label: 'Conflicts gate: ADVISORY', cls: 'border-amber-300 bg-amber-50 text-amber-900', Icon: ShieldAlert }
        : { label: 'Conflicts gate: SANDBOX', cls: 'border-gray-300 bg-gray-100 text-gray-700', Icon: FlaskConical };

  // The standing banner appears whenever the gate is NOT fully ENFORCED. It is non-dismissible by design.
  const showBanner = posture !== 'ENFORCED';

  return (
    <div data-testid="conflict-posture" className="space-y-2">
      <span
        data-testid="conflict-posture-chip"
        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${chip.cls}`}
      >
        <chip.Icon className="w-3.5 h-3.5" />
        {chip.label}
      </span>

      {showBanner && (
        <div
          data-testid="conflict-posture-banner"
          role="status"
          className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
        >
          {posture === 'SANDBOX' ? (
            <>
              This is a <span className="font-semibold">SANDBOX</span> matter — internal/test only, visibly non-client.
              Conflict clearance is not enforced here; it is not a real client matter.
            </>
          ) : (
            <>
              Conflict clearance is in <span className="font-semibold">ADVISORY</span> posture for this matter. The
              check still runs and a real conflict still blocks, but the absence of affirmative clearance will not stop
              drafting or export.
            </>
          )}
        </div>
      )}
    </div>
  );
}
