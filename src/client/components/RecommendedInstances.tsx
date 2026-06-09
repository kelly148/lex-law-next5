/**
 * RecommendedInstances — DOC-CLIENT-TARGET-1 Inc 4.
 *
 * Renders the assessment's recommended documents as per-client INSTANCES, not bare types: an
 * individual type in a multi-client matter expands to one row per client (with per-instance status from
 * the existing state engine), a joint (party_set) type shows one "both clients" row, everything else
 * shows the type as-is. The SAME taxonomy (the shared doc-type config) that drives the drafting flow
 * drives this enumeration — single source of truth — so completeness is counted by instance, never by
 * type ("POA — done" is meaningless; the question is "POA for whom").
 *
 * Status is the document's workflowState (the existing per-instance vocabulary — no parallel one).
 */
import React from 'react';
import { trpc } from '../trpc.js';
import { getDocTypeConfig } from '../../shared/docTypes/docTypeConfig.js';

interface RecommendedDoc {
  documentType?: string;
  title?: string;
  rationale?: string;
}

interface RecommendedInstancesProps {
  matterId: string;
  recommendedDocuments: RecommendedDoc[];
}

function statusLabel(workflowState: string | null): string {
  if (workflowState === null) return 'Not started';
  if (workflowState === 'complete') return 'Complete';
  if (workflowState === 'finalizing') return 'Finalizing';
  if (workflowState === 'substantively_accepted') return 'Accepted';
  if (workflowState === 'drafting') return 'In drafting';
  return workflowState;
}

export function RecommendedInstances({ matterId, recommendedDocuments }: RecommendedInstancesProps): React.ReactElement {
  const { data: parties } = trpc.matterIntake.listParties.useQuery({ matterId });
  const clients = (parties ?? []).filter((p) => p.role === 'client');
  return (
    <ul className="space-y-1">
      {recommendedDocuments.map((d, i) => (
        <RecommendedDocRow key={i} matterId={matterId} doc={d} clients={clients} />
      ))}
    </ul>
  );
}

function RecommendedDocRow({
  matterId,
  doc,
  clients,
}: {
  matterId: string;
  doc: RecommendedDoc;
  clients: Array<{ id: string; displayName: string }>;
}): React.ReactElement {
  const documentType = doc.documentType ?? '';
  const config = getDocTypeConfig(documentType);
  // instancesForType is subject-keyed (works for individual types); party_set is shown structurally.
  const { data: instances } = trpc.document.instancesForType.useQuery(
    { matterId, documentType },
    { enabled: documentType !== '' && config?.targetStructure === 'individual_subject' },
  );

  const heading = (
    <>
      <span className="font-medium">{doc.title}</span>
      {doc.rationale ? <span className="text-gray-500"> — {doc.rationale}</span> : null}
    </>
  );

  // individual_subject in a multi-client matter -> one row per client (the "two POAs" enumeration).
  if (config?.targetStructure === 'individual_subject' && clients.length >= 2) {
    return (
      <li className="text-gray-700" data-testid="recommended-instances">
        {heading}
        <ul className="ml-4 mt-0.5 space-y-0.5">
          {clients.map((c) => {
            const inst = (instances ?? []).find((x) => x.partyId === c.id);
            return (
              <li key={c.id} className="flex justify-between text-sm text-gray-600">
                <span>{c.displayName}</span>
                <span className="text-gray-400">{statusLabel(inst?.workflowState ?? null)}</span>
              </li>
            );
          })}
        </ul>
      </li>
    );
  }

  // party_set (joint) -> one row naming the whole client set.
  if (config?.targetStructure === 'party_set' && clients.length > 0) {
    return (
      <li className="text-gray-700" data-testid="recommended-joint">
        {heading}
        <span className="ml-2 text-sm text-gray-600">{clients.map((c) => c.displayName).join(' and ')}</span>
      </li>
    );
  }

  // everything else (single-client, non-targeted, custom) -> the type as-is.
  return (
    <li className="text-gray-700">
      {heading}
      {documentType ? <span className="text-gray-400"> ({documentType})</span> : null}
    </li>
  );
}
