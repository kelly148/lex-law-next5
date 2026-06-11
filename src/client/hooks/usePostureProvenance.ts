/**
 * usePostureProvenance — CHAT-UI-1 W2 client wiring for the durable posture audit ledger.
 *
 * Persists a confirm (record), reads the matter's chronological ledger (entries), and produces a
 * portable export bundle. The W1 ConsequenceConfirm emits a ProvenanceEntry on confirm; the live
 * surface routes that into record() so every confirm is durably recorded (brief W2 §1). All three
 * server procedures are gated behind CHAT_UI_1_ENABLED, so this hook is inert when the flag is off.
 */
import { useCallback } from 'react';
import type { inferRouterOutputs } from '@trpc/server';
import { trpc } from '../trpc.js';
import type { AppRouter } from '../../server/router.js';
import type { ProvenanceEntry } from '../../shared/posture/provenance.js';
import type { ProvenanceExportEnvelopeInput } from '../../shared/posture/provenanceExport.js';

/** The wire (serialized) shape of a ledger row as the client receives it (createdAt is a string). */
export type ProvenanceLedgerEntry = inferRouterOutputs<AppRouter>['chatUi']['listProvenance'][number];

export interface UsePostureProvenance {
  entries: ProvenanceLedgerEntry[];
  isLoading: boolean;
  isError: boolean;
  record: (entry: ProvenanceEntry, documentId?: string | null) => void;
  exportBundle: () => Promise<ProvenanceExportEnvelopeInput>;
}

export function usePostureProvenance(matterId: string): UsePostureProvenance {
  const utils = trpc.useUtils();
  const list = trpc.chatUi.listProvenance.useQuery({ matterId }, { enabled: matterId.length > 0 });
  const recordMutation = trpc.chatUi.recordProvenance.useMutation({
    onSuccess: () => {
      void utils.chatUi.listProvenance.invalidate({ matterId });
    },
  });

  const record = useCallback(
    (entry: ProvenanceEntry, documentId?: string | null) => {
      recordMutation.mutate({ matterId, documentId: documentId ?? null, entry });
    },
    [matterId, recordMutation],
  );

  const exportBundle = useCallback(
    (): Promise<ProvenanceExportEnvelopeInput> => utils.client.chatUi.exportProvenance.query({ matterId }),
    [matterId, utils],
  );

  return {
    entries: list.data ?? [],
    isLoading: list.isLoading,
    isError: list.isError,
    record,
    exportBundle,
  };
}
