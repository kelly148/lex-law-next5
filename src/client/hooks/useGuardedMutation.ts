/**
 * useGuardedMutation — Lex Law Next v1
 *
 * Ch 24.1 / Ch 35.13 — Required on every mutation button.
 *
 * R14 — No Duplicate Primitives: This is the single authoritative implementation.
 * No component may inline its own mutation guard.
 *
 * Purpose: Prevents rapid-fire double-fire mutations.
 * React Query's isPending updates asynchronously after a mutate() call.
 * A user clicking the same button twice within ~50ms can fire two calls before
 * isPending flips to true. The useRef guard is synchronous and fires before
 * the asynchronous pending state is set.
 *
 * Usage:
 *   const mutation = useGuardedMutation(trpc.matter.create);
 *   <button onClick={() => mutation.mutate({ title: 'Smith Trust' })} disabled={mutation.isPending}>
 *     Create Matter
 *   </button>
 *
 * The hook returns isPending for UX purposes (graying out, spinner) AND
 * uses the synchronous ref for correctness (second click is a silent no-op).
 */

import { useRef } from 'react';
import { useMutation } from '@tanstack/react-query';

// ============================================================
// Type helpers
// ============================================================

// A tRPC mutation procedure shape — minimal interface for type inference
type TrpcMutationProcedure<TInput, TOutput> = {
  mutate: (input: TInput) => Promise<TOutput>;
  useMutation: () => ReturnType<typeof useMutation<TOutput, Error, TInput>>;
};

// ============================================================
// Hook signature (per Ch 24.1 spec)
// ============================================================
export interface GuardedMutation<TInput, TOutput> {
  mutate: (input: TInput) => void;
  isPending: boolean;
  error: Error | null;
}

/**
 * useGuardedMutation
 *
 * Wraps a tRPC mutation with a synchronous useRef guard to prevent double-fire.
 *
 * @param mutationFn  An async function that performs the mutation.
 *                    Typically: (input: TInput) => trpc.domain.procedure.mutate(input)
 * @param options     Optional callbacks: onSuccess, onError, onSettled
 */
export function useGuardedMutation<TInput, TOutput>(
  mutationFn: (input: TInput) => Promise<TOutput>,
  options?: {
    onSuccess?: (data: TOutput, input: TInput) => void;
    onError?: (error: Error, input: TInput) => void;
    onSettled?: () => void;
  }
): GuardedMutation<TInput, TOutput> {
  // Synchronous guard — set before React Query's async isPending updates
  const inFlight = useRef(false);

  const mutation = useMutation<TOutput, Error, TInput>({
    mutationFn,
    onSuccess: (data, input) => {
      options?.onSuccess?.(data, input);
    },
    onError: (error, input) => {
      options?.onError?.(error, input);
    },
    onSettled: () => {
      // Reset the synchronous guard when the mutation settles (success or error)
      inFlight.current = false;
      options?.onSettled?.();
    },
  });

  const mutate = (input: TInput): void => {
    // Synchronous check — fires before isPending can update
    if (inFlight.current) {
      // Silent no-op: second click while first is in flight
      return;
    }
    inFlight.current = true;
    mutation.mutate(input);
  };

  return {
    mutate,
    isPending: mutation.isPending,
    error: mutation.error,
  };
}

// ============================================================
// useInFlightJob — companion hook per Ch 24.6 / Ch 35.14
// ============================================================
// NOTE: This hook requires the jobs table (Phase 2) and the
// job.listForDocument procedure. The type stub is defined here
// in Phase 1 to establish the interface; the implementation is
// completed in Phase 2 when the jobs table and procedures exist.
// ============================================================

export interface InFlightJobResult {
  job: { id: string; jobType: string; status: string } | null;
  isPending: boolean;
}

/**
 * useInFlightJob
 *
 * Ch 24.6 / Ch 35.14: Queries the jobs table on mount and disables
 * LLM-job-triggering buttons while a matching job is running.
 *
 * Prevents the refresh-mid-job scenario where an attorney sees a clickable
 * button for an action already in progress.
 *
 * Phase 1 stub: Returns { job: null, isPending: false } until Phase 2
 * wires up the real job.listForDocument procedure.
 *
 * @param _documentId  The document UUID to check for in-flight jobs.
 * @param _jobTypes    The job types to check (e.g., ['regeneration', 'review']).
 */
export function useInFlightJob(
  _documentId: string,
  _jobTypes: string[]
): InFlightJobResult {
  // Phase 1 stub — Phase 2 replaces this with a real tRPC query
  // with jittered polling (5000ms + random(0..1000)ms per Ch 24.6)
  return { job: null, isPending: false };
}
