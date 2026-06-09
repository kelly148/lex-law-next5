/**
 * DraftingTargetHeader — DOC-CLIENT-TARGET-1 Inc 2.
 *
 * Sticky, non-collapsible banner on the document page that shows WHO an individual document is for, so
 * paired instruments (Sarah's POA vs Greg's POA) are never confused at a glance. Renders only for
 * individual_subject documents; shows the bound principal (or a warning when none is bound yet), the
 * matter (when provided), and a link to OTHER clients' existing same-type instances ("Open <name>'s
 * version"). The targeting structure + role label come from the shared doc-type config (the single
 * accessor).
 *
 * [Change principal] (rebind) is a small noted fast-follow — the malpractice-critical pick happens at
 * create (the mandatory selector); this banner is the always-visible confirmation of that pick.
 *
 * All hooks run unconditionally before any early return (Rules of Hooks / ci-gotchas #10); the queries
 * are `enabled` only for individual types so non-individual docs pay nothing.
 */
import React from 'react';
import { Link } from 'react-router-dom';
import { trpc } from '../trpc.js';
import { getDocTypeConfig } from '../../shared/docTypes/docTypeConfig.js';

interface DraftingTargetHeaderProps {
  documentId: string;
  matterId: string;
  documentType: string;
  documentTitle: string;
  /** Optional matter title (the page breadcrumb already shows it; the banner is about the principal). */
  matterTitle?: string;
}

export function DraftingTargetHeader({
  documentId,
  matterId,
  documentType,
  documentTitle,
  matterTitle,
}: DraftingTargetHeaderProps): React.ReactElement | null {
  const config = getDocTypeConfig(documentType);
  const isIndividualSubject = config?.targetStructure === 'individual_subject';

  const { data: bindings } = trpc.document.listParties.useQuery({ documentId }, { enabled: isIndividualSubject });
  const { data: parties } = trpc.matterIntake.listParties.useQuery({ matterId }, { enabled: isIndividualSubject });
  const { data: instances } = trpc.document.instancesForType.useQuery(
    { matterId, documentType },
    { enabled: isIndividualSubject },
  );

  if (!isIndividualSubject) return null;

  const subjectBinding = (bindings ?? []).find((b) => b.roleKey === 'subject');
  const subject = subjectBinding ? (parties ?? []).find((p) => p.id === subjectBinding.partyId) : undefined;
  const principalLabel = config?.requiredRoles.find((r) => r.roleKey === 'subject')?.renderLabel ?? 'Principal';
  // Other clients who already have their own instance of this type (the open-the-other-version links).
  const otherInstances = (instances ?? []).filter((i) => i.partyId !== subjectBinding?.partyId && i.documentId);

  return (
    <div
      data-testid="drafting-target-header"
      className="sticky top-0 z-20 flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line bg-surface px-4 py-2 text-sm"
    >
      <span className="font-semibold tracking-wide text-ink">DRAFTING: {documentTitle}</span>
      {subject ? (
        <span className="text-ink">
          <span className="font-medium">{principalLabel}:</span> {subject.displayName}
        </span>
      ) : (
        <span data-testid="drafting-target-unbound" className="font-medium text-wa-attention">
          No {principalLabel.toLowerCase()} bound — choose one before generating.
        </span>
      )}
      {matterTitle ? <span className="text-ink-secondary">· Matter: {matterTitle}</span> : null}
      {otherInstances.map((i) => (
        <Link
          key={i.documentId}
          to={`/matters/${matterId}/documents/${i.documentId}`}
          className="text-accent underline-offset-2 hover:underline"
        >
          Open {i.displayName}&apos;s version
        </Link>
      ))}
    </div>
  );
}
