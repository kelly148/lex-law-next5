/**
 * ProvenanceBadge — Whereas R2 #5 (provenance / currency visual system).
 *
 * ONE badge component, a small FIXED state grammar across four facets — origin · verification ·
 * currency · severity — each rendered as a compact tone-coded chip. Density varies by surface (pass
 * only the facets that apply). Click/focus EXPANDS an inline plain-English detail block — disclosure
 * is never hover-only (the disposition's accessibility rule), and the trigger is a real <button> so
 * keyboard focus + Enter/Space work.
 *
 * No blue (R1-CLEANUP-1) — semantic --wa- tints only. Rolled out low-risk surfaces first (KB,
 * source authorities); draft body + review pane come in a later increment.
 */
import React, { useState } from 'react';
import { ShieldCheck, Tag, Clock, AlertTriangle, Info } from 'lucide-react';
import clsx from 'clsx';

export type ProvenanceOrigin = 'operative' | 'counterparty' | 'firm' | 'client' | 'model_derived' | 'reference';
export type ProvenanceVerification = 'unverified' | 'verified' | 'stale' | 'attorney_verified_current' | 'superseded' | 'not_legal_authority';
export type ProvenanceCurrency = 'current_draft' | 'operative' | 'superseded';
export type ProvenanceSeverity = 'blocker' | 'review';

type Tone = 'good' | 'attention' | 'alert' | 'neutral' | 'muted';
const TONE_CLS: Record<Tone, string> = {
  good: 'bg-success-tint text-success',
  attention: 'bg-warning-tint text-warning',
  alert: 'bg-danger-tint text-danger',
  neutral: 'bg-surface text-ink-secondary border border-line',
  muted: 'bg-surface text-ink-hint',
};

export interface ProvenanceFacet {
  kind: 'origin' | 'verification' | 'currency' | 'severity';
  tone: Tone;
  label: string;
  detail: string;
}

// ── Pure facet resolvers (exported for unit tests) ────────────────────────────
export function originFacet(o: ProvenanceOrigin): ProvenanceFacet {
  const map: Record<ProvenanceOrigin, { tone: Tone; label: string; detail: string }> = {
    operative: { tone: 'neutral', label: 'Operative', detail: 'An operative source for this matter.' },
    firm: { tone: 'neutral', label: 'Firm', detail: 'A firm-internal source.' },
    client: { tone: 'neutral', label: 'Client', detail: 'Provided by the client.' },
    reference: { tone: 'neutral', label: 'Reference', detail: 'A reference source.' },
    counterparty: { tone: 'attention', label: 'Counterparty', detail: 'From the counterparty — treat with caution; it advances their interests, not your client’s.' },
    model_derived: { tone: 'attention', label: 'AI-derived', detail: 'Derived by an AI model — verify before relying on it.' },
  };
  return { kind: 'origin', ...map[o] };
}

export function verificationFacet(v: ProvenanceVerification): ProvenanceFacet {
  const map: Record<ProvenanceVerification, { tone: Tone; label: string; detail: string }> = {
    verified: { tone: 'good', label: 'Verified', detail: 'Attorney-verified.' },
    attorney_verified_current: { tone: 'good', label: 'Verified current', detail: 'Attorney-verified against current law.' },
    unverified: { tone: 'attention', label: 'Unverified', detail: 'Not attorney-verified — re-verify against current law before relying on it.' },
    stale: { tone: 'attention', label: 'Stale', detail: 'Verification is stale — re-verify against current law.' },
    superseded: { tone: 'muted', label: 'Superseded', detail: 'Superseded by a newer version.' },
    not_legal_authority: { tone: 'muted', label: 'Not legal authority', detail: 'Flagged as not a legal authority.' },
  };
  return { kind: 'verification', ...map[v] };
}

export function currencyFacet(c: ProvenanceCurrency): ProvenanceFacet {
  const map: Record<ProvenanceCurrency, { tone: Tone; label: string; detail: string }> = {
    current_draft: { tone: 'neutral', label: 'Current', detail: 'Reflects the current draft.' },
    operative: { tone: 'neutral', label: 'Operative', detail: 'The operative version.' },
    superseded: { tone: 'muted', label: 'Superseded', detail: 'No longer current — superseded.' },
  };
  return { kind: 'currency', ...map[c] };
}

export function severityFacet(s: ProvenanceSeverity): ProvenanceFacet {
  const map: Record<ProvenanceSeverity, { tone: Tone; label: string; detail: string }> = {
    blocker: { tone: 'alert', label: 'Blocker', detail: 'A blocker — requires an attorney decision.' },
    review: { tone: 'attention', label: 'Review', detail: 'Flagged for attorney review.' },
  };
  return { kind: 'severity', ...map[s] };
}

const FACET_ICON: Record<ProvenanceFacet['kind'], React.ReactNode> = {
  origin: <Tag className="w-2.5 h-2.5" aria-hidden />,
  verification: <ShieldCheck className="w-2.5 h-2.5" aria-hidden />,
  currency: <Clock className="w-2.5 h-2.5" aria-hidden />,
  severity: <AlertTriangle className="w-2.5 h-2.5" aria-hidden />,
};

interface ProvenanceBadgeProps {
  origin?: ProvenanceOrigin;
  verification?: ProvenanceVerification;
  currency?: ProvenanceCurrency;
  severity?: ProvenanceSeverity;
}

export default function ProvenanceBadge({ origin, verification, currency, severity }: ProvenanceBadgeProps): React.ReactElement | null {
  const [expanded, setExpanded] = useState(false);

  const facets: ProvenanceFacet[] = [];
  if (origin) facets.push(originFacet(origin));
  if (verification) facets.push(verificationFacet(verification));
  if (currency) facets.push(currencyFacet(currency));
  if (severity) facets.push(severityFacet(severity));
  if (facets.length === 0) return null;

  return (
    <span className="inline-flex flex-col gap-0.5" data-testid="provenance-badge">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        title="Show provenance detail"
        className="inline-flex items-center gap-1"
      >
        {facets.map((f) => (
          <span
            key={f.kind}
            className={clsx('inline-flex items-center gap-0.5 px-1 rounded text-[10px] leading-tight', TONE_CLS[f.tone], f.tone === 'muted' && 'line-through')}
          >
            {FACET_ICON[f.kind]}
            {f.label}
          </span>
        ))}
        <Info className="w-2.5 h-2.5 text-ink-hint" aria-hidden />
      </button>
      {expanded && (
        <span className="flex flex-col gap-0.5 mt-0.5 pl-1 border-l border-line">
          {facets.map((f) => (
            <span key={f.kind} className="text-[10px] text-ink-secondary">
              <span className="font-medium">{f.label}:</span> {f.detail}
            </span>
          ))}
        </span>
      )}
    </span>
  );
}
