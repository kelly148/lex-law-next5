/**
 * clientDelivery.ts — TITLE-EXAM-1 (T6), the client-facing artifact generation gate (spec §7.2/§7.3, NC-3).
 *
 * Client email + branded report are generated ONLY from the attorney-APPROVED, version-locked memo, behind a
 * distinct logged Approve-for-Client-Delivery action. This module holds the PURE generation gate: the version-
 * lock hash (a later edit re-arms the approval), the NC-3e render-block enforcement (forbidden assurances /
 * unverified citations / annotation leaks are a BLOCK, not a label), the non-editable template disclaimers,
 * and the attorney-of-record framing with NO affirmative AI disclosure (operator resolution). There is NO
 * send path anywhere — the artifacts are DRAFTS the attorney transports.
 *
 * PURE. Flag-dark by construction. The durable attestation write lives in db/queries/titleExamApproval.ts.
 */

import { createHash } from 'node:crypto';
import { checkClientFacingRenderBlocks, type RenderBlockResult } from './renderBlocks.js';

export type RecipientClass = 'client' | 'lender' | 'underwriter' | 'agent' | 'counsel' | 'other';
export type ScopePosture = 'exam_only' | 'exam_with_curative_identification';

export interface ClientDeliveryApproval {
  attorneyUserId: string;
  /** The engagement-capacity hat (e.g. Universal Title / Satterwhite Law Firm). */
  hat: string;
  recipientClass: RecipientClass;
  posture: ScopePosture;
  /** Law-firm hat only — a title-company-hat communication frames requirements, never party-specific advice. */
  advicePermitted: boolean;
  /** Required caveats surfaced to the recipient. */
  caveats: string[];
  /** Intentional exclusions — preserved internally, not stated to the recipient. */
  exclusions: string[];
}

/** Deterministic version-lock hash binding the approval to the exact approved memo text (a later edit re-arms
 *  the approval — the sendability_override / express-attestation supersede-on-change pattern). Pure. */
export function buildMemoVersionHash(approvedMemoText: string): string {
  return createHash('sha256').update(approvedMemoText ?? '', 'utf8').digest('hex');
}

export interface ClientArtifactResult {
  /** false = render-blocked; the artifact is NOT produced (fail-closed, NC-3e). */
  ok: boolean;
  /** The draft artifact text (never sent — the attorney transports). Null when blocked. */
  content: string | null;
  renderBlock: RenderBlockResult;
}

// Non-editable template disclaimer + attorney-of-record framing. NO affirmative AI disclosure (operator
// resolution); nothing may imply the AI performed the examination.
function disclaimerBlock(approval: ClientDeliveryApproval): string {
  const lines = [
    approval.advicePermitted
      ? 'This communication is provided under our engagement for this matter.'
      : 'This is a title/settlement requirement communication, not legal advice to any party.',
    `Prepared under the supervision and responsibility of the attorney of record (${approval.hat}), who is responsible for its contents.`,
  ];
  if (approval.caveats.length > 0) {
    lines.push('Caveats:');
    for (const c of approval.caveats) lines.push(`- ${c}`);
  }
  return lines.join('\n');
}

function assemble(approvedClientBody: string, approval: ClientDeliveryApproval, header: string): ClientArtifactResult {
  const body = `${header}\n\n${approvedClientBody.trim()}\n\n${disclaimerBlock(approval)}`;
  // NC-3e: render-block BEFORE producing. Any forbidden assurance / unverified citation / annotation leak
  // fails closed — the artifact is not produced and the failures return to the attorney.
  const renderBlock = checkClientFacingRenderBlocks(body);
  if (!renderBlock.ok) {
    return { ok: false, content: null, renderBlock };
  }
  return { ok: true, content: body, renderBlock };
}

/**
 * Generate the client email DRAFT from the attorney-approved client-facing body. Render-blocked; NO send path
 * (returns a draft the attorney transports in their own mail client). Blocked artifacts return the failures.
 */
export function buildClientEmailDraft(
  approvedClientBody: string,
  approval: ClientDeliveryApproval,
): ClientArtifactResult {
  return assemble(approvedClientBody, approval, 'RE: Title Examination — Requirements and Exceptions');
}

/** Generate the branded Title Examination Report DRAFT. Same gate; NO send path. */
export function buildBrandedReportDraft(
  approvedClientBody: string,
  approval: ClientDeliveryApproval,
): ClientArtifactResult {
  return assemble(approvedClientBody, approval, 'TITLE EXAMINATION REPORT');
}
