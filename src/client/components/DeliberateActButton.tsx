/**
 * DeliberateActButton — Whereas R2-2 Inc B; tone added in R2 primary-CTA-oxblood sweep.
 *
 * The standardized "deliberate act" affordance for MATERIAL acts (adopt / lock / confirm a group /
 * record disagreements). It carries the ✦ recital mark, a heavier 2px border, and a soft ring so a
 * material, record-producing act never looks like a routine button. This is the deliberate-act
 * thesis: the weight of the control matches the weight of the decision.
 *
 * Color and friction are ORTHOGONAL (R2 primary-CTA decision §2). Friction = the ✦ mark + the
 * heavier border/ring + the deliberate click; it is carried in BOTH tones. Prominence (the oxblood
 * fill) is reserved for the one act that is its view's single dominant CTA:
 *   - tone="primary" (default): filled oxblood — use ONLY when this act is the view's single primary.
 *   - tone="ghost": outline + ink, ✦ glyph stays oxblood — for a deliberate act that is NOT the
 *     view's primary. Keeps every bit of its friction; just not the scarce oxblood fill.
 * "No oxblood confetti": a dense surface (e.g. MatterDetail) renders its ✦ acts as ghost.
 *
 * Reusable by design: R2 #4 (export-safety override), #6 (KB adoption), and #7-adjacent commit
 * acts reuse this exact affordance. No keyboard shortcuts are wired on material acts (per the
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
  /**
   * Visual prominence. 'primary' = oxblood fill (the view's single dominant CTA); 'ghost' = outline
   * + ink with the oxblood ✦ glyph (a deliberate act that is NOT the view's primary). Friction is
   * identical in both. Default 'primary' preserves every pre-existing call site unchanged.
   */
  tone?: 'primary' | 'ghost';
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
  tone = 'primary',
  className,
  type = 'button',
  title,
}: DeliberateActButtonProps): React.ReactElement {
  const sizeCls = size === 'sm' ? 'px-2.5 py-1 text-[11px]' : 'px-3.5 py-2 text-sm';
  // Both tones keep the deliberate-act WEIGHT (2px border + ring); only the fill differs.
  const toneCls =
    tone === 'ghost'
      ? 'bg-transparent text-ink border-2 border-line ring-1 ring-line hover:bg-surface'
      : 'bg-accent text-on-accent border-2 border-accent-hover ring-1 ring-accent-tint hover:bg-accent-hover';
  // The ✦ recital mark stays oxblood in ghost tone — the brand/friction cue, on paper instead of fill.
  const glyphCls = tone === 'ghost' ? 'text-accent' : 'text-on-accent';
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      data-deliberate-act="true"
      data-tone={tone}
      className={clsx(
        'inline-flex items-center gap-1.5 rounded font-medium',
        sizeCls,
        toneCls,
        'disabled:opacity-50 disabled:cursor-not-allowed transition-colors',
        className,
      )}
    >
      <span aria-hidden className={clsx(glyphCls, 'leading-none')}>✦</span>
      <span>{children}</span>
    </button>
  );
}
