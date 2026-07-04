/**
 * deedManualForm — DEED-INTAKE-PARITY-1.
 *
 * The ONE shared collapse affordance so every Quick Deed lane (gift / seller / the five categories) presents the
 * SAME intake-first UX the gift DeedIntake has always had: the structured "manual field wall" starts COLLAPSED
 * behind this toggle, the drop zone + describe box are primary, and a generate attempt with gaps EXPANDS the form
 * and rings the missing required fields (never a silent block). Lifted into one place so the copy + behavior are
 * byte-identical across lanes.
 *
 * Flag-dark: only reachable from the flag-gated /deed surfaces (QuickDeedPage self-guards on deedDraftAgent.isEnabled).
 */
import React from 'react';

/** The Tailwind classes applied to a required input whose value is missing on a generate attempt (a red ring —
 *  the same treatment the gift DeedIntake uses for a missing grantor/grantee). Replaces the neutral border so the
 *  two border-color utilities never collide. */
export const MISSING_RING_CLASS = 'border-red-400 ring-1 ring-red-300';

/**
 * The "Fill in all fields manually" / "Hide the deed facts" toggle. Identical copy + styling to the gift lane's
 * deed-intake-form-toggle so all lanes read as one surface. Each lane passes a lane-scoped testId so a test can
 * target the right toggle when more than one lane could be mounted.
 */
export function ManualFieldsToggle({
  expanded,
  onToggle,
  testId = 'quick-deed-form-toggle',
}: {
  expanded: boolean;
  onToggle: () => void;
  testId?: string;
}): React.ReactElement {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onToggle}
      className="text-sm text-firm-navy hover:underline"
    >
      {expanded ? 'Hide the deed facts' : 'Fill in all fields manually'}
    </button>
  );
}
