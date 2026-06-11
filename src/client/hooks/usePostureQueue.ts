/**
 * usePostureQueue — CHAT-UI-1 W1 Auto-Act posture-confirm queue + provenance ledger (brief §2.5/§2.6).
 *
 * Holds the stacked posture confirms ("N posture confirms waiting") and the in-memory provenance
 * ledger (meaningful accepts). Batch-clear honors the ratified D1 carve-out — adverse / third-party
 * confirms never clear in a batch (they stay for individual handling), enforced in the pure
 * clearBatch logic. Durable, exportable provenance is W2 (PROVENANCE-LEDGER-1).
 */
import { useCallback, useState } from 'react';
import type { Posture } from '../../shared/posture/postureCoherence.js';
import {
  type PostureConfirmRequest,
  type QueueSummary,
  makePostureConfirmRequest,
  summarizeQueue,
  clearBatch,
} from '../../shared/posture/postureQueue.js';
import type { ProvenanceEntry } from '../../shared/posture/provenance.js';

export interface EnqueueArgs {
  id: string;
  prior?: Posture | null;
  next: Posture;
  atEgress?: boolean;
}

export interface PostureQueue {
  requests: readonly PostureConfirmRequest[];
  summary: QueueSummary;
  ledger: readonly ProvenanceEntry[];
  enqueue: (args: EnqueueArgs) => void;
  /** Clear one confirm (individual path — the only path for carve-out requests), recording its entry. */
  clearOne: (id: string, entry: ProvenanceEntry) => void;
  /** Batch-clear every batchable, non-blocked confirm; carve-out + HARD requests remain. Records each. */
  clearBatchable: (makeEntry: (req: PostureConfirmRequest) => ProvenanceEntry) => void;
}

export function usePostureQueue(): PostureQueue {
  const [requests, setRequests] = useState<PostureConfirmRequest[]>([]);
  const [ledger, setLedger] = useState<ProvenanceEntry[]>([]);

  const enqueue = useCallback((args: EnqueueArgs) => {
    const req = makePostureConfirmRequest(args);
    // A re-trigger for the same id replaces the pending request (latest posture wins).
    setRequests((prev) => [...prev.filter((r) => r.id !== req.id), req]);
  }, []);

  const clearOne = useCallback((id: string, entry: ProvenanceEntry) => {
    setRequests((prev) => prev.filter((r) => r.id !== id));
    setLedger((prev) => [...prev, entry]);
  }, []);

  const clearBatchable = useCallback(
    (makeEntry: (req: PostureConfirmRequest) => ProvenanceEntry) => {
      const { cleared, remaining } = clearBatch(requests);
      setRequests(remaining);
      setLedger((prev) => [...prev, ...cleared.map(makeEntry)]);
    },
    [requests],
  );

  return { requests, summary: summarizeQueue(requests), ledger, enqueue, clearOne, clearBatchable };
}
