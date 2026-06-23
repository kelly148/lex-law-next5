/**
 * GiftDraftForm — DEED-DRAFT-AGENT-1 Inc-1c-UI: the attorney entry point that invokes
 * `deedDraftAgent.createGiftDraft`. Collects the gift facts the document text cannot supply (donor/donee
 * identities + matter facts), submits them, and (on success) hands the created documentId back so the matter
 * page navigates the attorney to the standard document review/finalize/export surface.
 *
 * Flag-dark: mounted only when `deedDraftAgent.isEnabled` is true (the matter page gates the entry button).
 * The server is the authority on every gate (flag, ownership, conflicts-at-intake) and the assembly — this
 * form only collects input and surfaces the server's error message. It never finalizes, records, or sends.
 */
import React, { useState } from 'react';
import { trpc } from '../trpc.js';
import { useGuardedMutation } from '../hooks/useGuardedMutation.js';

interface PartyRow {
  name: string;
  descriptor: string;
}

interface GiftDraftFormProps {
  matterId: string;
  onClose: () => void;
  /** Called with the new documentId on success (the parent navigates to the document review surface). */
  onCreated: (documentId: string) => void;
}

const emptyRow = (): PartyRow => ({ name: '', descriptor: '' });

export function GiftDraftForm({ matterId, onClose, onCreated }: GiftDraftFormProps): React.ReactElement {
  const [grantors, setGrantors] = useState<PartyRow[]>([emptyRow()]);
  const [grantees, setGrantees] = useState<PartyRow[]>([emptyRow()]);
  const [granteesAreMarriedCouple, setGranteesAreMarriedCouple] = useState(false);
  const [fileNumber, setFileNumber] = useState('');
  const [granteeAddress, setGranteeAddress] = useState('');
  const [locality, setLocality] = useState('');
  const [derivationReference, setDerivationReference] = useState('');
  const [vestingOverride, setVestingOverride] = useState('');
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

  const cleanParties = (rows: PartyRow[]): { name: string; descriptor?: string }[] =>
    rows
      .filter((r) => r.name.trim().length > 0)
      .map((r) => {
        const d = r.descriptor.trim();
        return d.length > 0 ? { name: r.name.trim(), descriptor: d } : { name: r.name.trim() };
      });

  const handleSubmit = (e: React.FormEvent): void => {
    e.preventDefault();
    const cleanGrantors = cleanParties(grantors);
    const cleanGrantees = cleanParties(grantees);
    if (cleanGrantors.length === 0) {
      setError('At least one grantor (donor) name is required.');
      return;
    }
    if (cleanGrantees.length === 0) {
      setError('At least one grantee (donee) name is required.');
      return;
    }
    setError(null);
    createMutation.mutate({
      matterId,
      grantors: cleanGrantors,
      grantees: cleanGrantees,
      granteesAreMarriedCouple,
      fileNumber: fileNumber.trim() || null,
      granteeAddress: granteeAddress.trim() || null,
      locality: locality.trim() || null,
      derivationReference: derivationReference.trim() || null,
      vestingOverride: vestingOverride.trim() || null,
      title: 'Deed of Gift',
    });
  };

  const renderPartyRows = (
    rows: PartyRow[],
    setRows: (next: PartyRow[]) => void,
    descriptorPlaceholder: string,
  ): React.ReactElement => (
    <div className="space-y-2">
      {rows.map((row, idx) => (
        <div key={idx} className="flex gap-2">
          <input
            type="text"
            value={row.name}
            onChange={(e) => setRows(rows.map((r, i) => (i === idx ? { ...r, name: e.target.value } : r)))}
            className="flex-1 border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-firm-navy"
            placeholder="Full legal name"
          />
          <input
            type="text"
            value={row.descriptor}
            onChange={(e) => setRows(rows.map((r, i) => (i === idx ? { ...r, descriptor: e.target.value } : r)))}
            className="flex-1 border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-firm-navy"
            placeholder={descriptorPlaceholder}
          />
          {rows.length > 1 && (
            <button
              type="button"
              onClick={() => setRows(rows.filter((_, i) => i !== idx))}
              className="px-2 text-gray-400 hover:text-red-600 text-sm"
              title="Remove"
            >
              ×
            </button>
          )}
        </div>
      ))}
      <button
        type="button"
        onClick={() => setRows([...rows, emptyRow()])}
        className="text-sm text-firm-navy hover:underline"
      >
        + Add another
      </button>
    </div>
  );

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl p-6 max-h-[90vh] overflow-auto">
        <h2 className="text-lg font-semibold text-firm-navy mb-1">Generate Deed of Gift draft</h2>
        <p className="text-sm text-gray-500 mb-4">
          The property facts (legal description, parcel, assessed value) are read from this matter&apos;s
          uploaded documents. Genuinely-missing facts become bracketed placeholders for you to fill. The draft
          is never auto-recorded or sent — you review and finalize it.
        </p>
        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Grantor(s) — donor(s) <span className="text-red-500">*</span>
            </label>
            {renderPartyRows(grantors, setGrantors, "Descriptor (e.g. 'husband and wife')")}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Grantee(s) — donee(s) <span className="text-red-500">*</span>
            </label>
            {renderPartyRows(grantees, setGrantees, "Relationship (e.g. “the Grantors’ daughter”)")}
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={granteesAreMarriedCouple}
              onChange={(e) => setGranteesAreMarriedCouple(e.target.checked)}
              className="rounded"
            />
            Grantees are a married couple (→ tenancy by the entirety)
          </label>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">File number</label>
              <input
                type="text"
                value={fileNumber}
                onChange={(e) => setFileNumber(e.target.value)}
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-firm-navy"
                placeholder="36-YYYY-NNNN"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Recording locality</label>
              <input
                type="text"
                value={locality}
                onChange={(e) => setLocality(e.target.value)}
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-firm-navy"
                placeholder="County / City (else read from the packet)"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Grantee&apos;s address</label>
            <input
              type="text"
              value={granteeAddress}
              onChange={(e) => setGranteeAddress(e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-firm-navy"
              placeholder="Mailing address for tax bills / notices"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Derivation (&ldquo;Being&rdquo;) reference</label>
            <input
              type="text"
              value={derivationReference}
              onChange={(e) => setDerivationReference(e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-firm-navy"
              placeholder="e.g. in Deed Book 5500 at Page 12 (where the prior deed is recorded)"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Vesting override (optional)</label>
            <input
              type="text"
              value={vestingOverride}
              onChange={(e) => setVestingOverride(e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-firm-navy"
              placeholder="Defaults from grantee count + marital status"
            />
          </div>
          {error && <p className="text-red-600 text-sm">{error}</p>}
          <div className="flex justify-end gap-3 pt-1">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">
              Cancel
            </button>
            <button
              type="submit"
              disabled={createMutation.isPending}
              className="px-4 py-2 text-sm bg-firm-navy text-white rounded hover:opacity-90 disabled:opacity-50"
            >
              {createMutation.isPending ? 'Generating…' : 'Generate draft'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default GiftDraftForm;
