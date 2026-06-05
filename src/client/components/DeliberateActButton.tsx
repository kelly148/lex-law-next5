/**
 * DeliberateActButton — Whereas R2-2 Inc B.
 *
 * The standardized "deliberate act" affordance for MATERIAL acts (adopt / lock / confirm a group /
 * record disagreements). It reads visually HEAVIER than an ordinary oxblood primary button — a
 * filled oxblood with a heavier border, a soft ring, and the ✦ recital mark — so a material,
 * record-producing act never looks like a routine button. This is the deliberate-act thesis: the
 * weight of the control matches the weight of the decision.
 *
 * Reusable by design: R2 #4 (export-safety override), #6 (KB adoption), and #7-adjacent commit
 * acts will reuse this exact affordance. No keyboard shortcuts are wired on material acts (per the
 * R2 cut-list) — a deliberate act is a deliberate click.
 */
import React from 'react';
import clsx from 'clsx';

interface DeliberateActButtonProps {
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
  /** Compact ('sm') for dense panels, standard ('md', default) elsewhere. */
  size?: 'sm' | 'md';
  /** Extra classes (e.g. margins) merged after the base affordance — not for sizing (use size). */
  className?: string;
  type?: 'button' | 'submit';
  title?: string;
}

export default function DeliberateActButton({
  onClick,
  disabled = false,
  children,
  size = 'md',
  className,
  type = 'button',
  title,
}: DeliberateActButtonProps): React.ReactElement {
  const sizeCls = size === 'sm' ? 'px-2.5 py-1 text-[11px]' : 'px-3.5 py-2 text-sm';
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      data-deliberate-act="true"
      className={clsx(
        // Heavier than an ordinary oxblood primary: filled oxblood, a 2px border in the hover tone,
        // and a faint accent ring so the control carries visible weight.
        'inline-flex items-center gap-1.5 rounded font-medium',
        sizeCls,
        'bg-accent text-on-accent border-2 border-accent-hover ring-1 ring-accent-tint',
        'hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors',
        className,
      )}
    >
      <span aria-hidden className="text-on-accent leading-none">✦</span>
      <span>{children}</span>
    </button>
  );
}
