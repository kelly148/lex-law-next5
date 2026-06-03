/**
 * Per-PA instruction-profile injection provider — FOLD-KB-1 Increment 4 (Fork E).
 *
 * The default provider the LLM-dispatch chokepoint uses to auto-load the attorney's tuned
 * per-practice-area master prompt. It loads ONLY when the matter has an attorney-CONFIRMED
 * paKey AND an active profile exists — otherwise returns null (the chokepoint falls back to
 * the base prompt, NOT a mismatched PA). Unlike practice memos (which never auto-inject), the
 * per-PA profile is the attorney's OWN instruction layer, so auto-loading it is its purpose.
 *
 * Best-effort by contract: the chokepoint invokes this inside a try/catch so a failed read can
 * never break a model call.
 */

import { getMatterById } from '../db/queries/matters.js';
import { getActiveProfileForPaKey } from '../db/queries/paInstructionProfiles.js';

export interface LoadedPaProfile {
  body: string;
  profileId: string;
  version: string;
  paKey: string;
}

export async function buildActivePaProfileForMatter(args: {
  matterId: string;
  userId: string;
}): Promise<LoadedPaProfile | null> {
  const matter = await getMatterById(args.matterId, args.userId);
  if (!matter || !matter.paKey) return null; // no confirmed paKey => base prompt
  const profile = await getActiveProfileForPaKey(matter.paKey, args.userId);
  if (!profile) return null; // no matching active profile => base prompt (never a mismatched PA)
  return { body: profile.body, profileId: profile.id, version: profile.version, paKey: matter.paKey };
}
