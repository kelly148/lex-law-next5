/**
 * GiftDraftForm — DEED-DRAFT-AGENT-1 Inc-1c-UI, restructured by DEED-INTAKE-REDESIGN-1 into a thin modal
 * wrapper around the shared <DeedIntake> experience (the SAME component the standalone Quick Deed page uses,
 * so the two surfaces never drift). The wrapper owns only the matter-scoped concerns: the modal chrome, the
 * matterId (already known — no lazy create), the createGiftDraft mutation, and the post-create navigation.
 *
 * Flag-dark: mounted only when `deedDraftAgent.isEnabled` is true (the matter page gates the entry button).
 * The server is the authority on every gate (flag, ownership, conflicts-at-intake) and the assembly — this
 * form only collects input and surfaces the server's error message. It never finalizes, records, or sends.
 */
import React, { useState } from 'react';
import { trpc } from '../trpc.js';
import { useGuardedMutation } from '../hooks/useGuardedMutation.js';
import DeedIntake, { type DeedGiftIntakePayload } from './DeedIntake.js';

interface GiftDraftFormProps {
  matterId: string;
  onClose: () => void;
  /** Called with the new documentId on success (the parent navigates to the document review surface). */
  onCreated: (documentId: string) => void;
}

export function GiftDraftForm({ matterId, onClose, onCreated }: GiftDraftFormProps): React.ReactElement {
  const [error, setError] = useState<string | null>(null);
  const utils = trpc.useUtils();

  const createMutation = useGuardedMutation(
    (input: Parameters<typeof utils.client.deedDraftAgent.createGiftDraft.mutate>[0]) =>
      utils.client.deedDraftAgent.createGiftDraft.mutate(input),
    {
      onSuccess: (result) => {
        void utils.document.list.invalidate({ matterId });
        onCreated(result.documentId);
      },
      onError: (err) => setError(err.message),
    },
  );

  const handleSubmit = (p: DeedGiftIntakePayload): void => {
    setError(null);
    createMutation.mutate({
      matterId,
      grantors: p.grantors,
      grantees: p.grantees,
      granteesAreMarriedCouple: p.granteesAreMarriedCouple,
      fileNumber: p.fileNumber,
      granteeAddress: p.granteeAddress,
      locality: p.locality,
      derivationReference: p.derivationReference,
      vestingOverride: p.vestingOverride,
      title: 'Deed of Gift',
    });
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl p-6 max-h-[90vh] overflow-auto">
        <div className="flex items-start justify-between mb-1">
          <h2 className="text-lg font-semibold text-firm-navy">Generate Deed of Gift draft</h2>
          <button type="button" onClick={onClose} className="text-sm text-gray-500 hover:text-gray-800">
            Cancel
          </button>
        </div>
        <p className="text-sm text-gray-500 mb-4">
          Drop the prior vesting deed and tax record (or describe the deal), confirm the facts, and generate the
          house-style draft. The property facts (legal description, parcel, assessed value) are read from this
          matter&apos;s uploaded documents. The draft is never auto-recorded or sent — you review and finalize it.
        </p>
        <DeedIntake
          matterId={matterId}
          resolveMatterId={() => Promise.resolve(matterId)}
          onSubmit={handleSubmit}
          submitting={createMutation.isPending}
          submitError={error}
          submitLabel="Generate draft"
        />
      </div>
    </div>
  );
}

export default GiftDraftForm;
