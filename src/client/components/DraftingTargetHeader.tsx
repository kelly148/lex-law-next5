/**
 * DraftingTargetHeader — DOC-CLIENT-TARGET-1 Inc 2/3.
 *
 * Sticky, non-collapsible banner on the document page that shows WHO a targeted document is for, so
 * paired/joint instruments are never confused at a glance. For an individual_subject doc it shows the
 * bound principal (or a warning when none is bound) + links to OTHER clients' existing same-type
 * instances ("Open <name>'s version"). For a party_set (joint) doc it shows "Applies to: <client set>".
 * Renders nothing for non-targeted types. The structure + role label come from the shared doc-type
 * config (the single accessor).
 *
 * [Change principal] / [Change parties] (rebind) is a small noted fast-follow — the malpractice-critical
 * binding happens at create; this banner is the always-visible confirmation of it.
 *
 * All hooks run unconditionally before any early return (Rules of Hooks / ci-gotchas #10); the queries
 * are `enabled` only for targeted types so non-targeted docs pay nothing.
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
  /** Optional matter title (the page breadcrumb already shows it; the banner is about the target). */
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
  const isPartySet = config?.targetStructure === 'party_set';
  const isTargeted = isIndividualSubject || isPartySet;

  const { data: bindings } = trpc.document.listParties.useQuery({ documentId }, { enabled: isTargeted });
  const { data: parties } = trpc.matterIntake.listParties.useQuery({ matterId }, { enabled: isTargeted });
  const { data: instances } = trpc.document.instancesForType.useQuery(
    { matterId, documentType },
    { enabled: isIndividualSubject },
  );

  if (!isTargeted) return null;

  const nameOf = (partyId: string): string | undefined => (parties ?? []).find((p) => p.id === partyId)?.displayName;
  const wrapperClass =
    'sticky top-0 z-20 flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line bg-surface px-4 py-2 text-sm';
  const matterSuffix = matterTitle ? <span className="text-ink-secondary">· Matter: {matterTitle}</span> : null;

  if (isPartySet) {
    const roleKey = config?.requiredRoles[0]?.roleKey;
    const roleLabel = config?.requiredRoles[0]?.renderLabel ?? 'Party';
    const boundNames = (bindings ?? [])
      .filter((b) => roleKey !== undefined && b.roleKey === roleKey)
      .map((b) => nameOf(b.partyId))
      .filter((n): n is string => n !== undefined);
    return (
      <div data-testid="drafting-target-header" className={wrapperClass}>
        <span className="font-semibold tracking-wide text-ink">DRAFTING: {documentTitle}</span>
        {boundNames.length > 0 ? (
          <span className="text-ink">
            <span className="font-medium">Applies to:</span> {boundNames.join(' and ')}
          </span>
        ) : (
          <span data-testid="drafting-target-unbound" className="font-medium text-wa-attention">
            No {roleLabel.toLowerCase()}s bound.
          </span>
        )}
        {matterSuffix}
      </div>
    );
  }

  // individual_subject
  const subjectBinding = (bindings ?? []).find((b) => b.roleKey === 'subject');
  const subjectName = subjectBinding ? nameOf(subjectBinding.partyId) : undefined;
  const principalLabel = config?.requiredRoles.find((r) => r.roleKey === 'subject')?.renderLabel ?? 'Principal';
  const otherInstances = (instances ?? []).filter((i) => i.partyId !== subjectBinding?.partyId && i.documentId);

  return (
    <div data-testid="drafting-target-header" className={wrapperClass}>
      <span className="font-semibold tracking-wide text-ink">DRAFTING: {documentTitle}</span>
      {subjectName ? (
        <span className="text-ink">
          <span className="font-medium">{principalLabel}:</span> {subjectName}
        </span>
      ) : (
        <span data-testid="drafting-target-unbound" className="font-medium text-wa-attention">
          No {principalLabel.toLowerCase()} bound — choose one before generating.
        </span>
      )}
      {matterSuffix}
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
