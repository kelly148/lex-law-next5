/**
 * d3Signoff.ts — D3-SIGNOFF (source-anchored deed sign-off), A.1 Inc 1 constants.
 *
 * The deterministic comparator (Inc 2), the export-route OBSERVE wiring (Inc 3), and the UI (Inc 4) build on
 * this data core. NC-1 holds throughout: nothing here composes or corrects operative text.
 */

/**
 * NC-D3-4 — the stamped comparator version. Written into EVERY sign-off record so a later normalization /
 * comparator change cannot retroactively launder old sign-offs (a record proves what a specific comparator
 * version concluded). BUMP this on any change to the normalization spec or the comparator logic.
 */
export const D3_COMPARATOR_VERSION = 'd3-comparator-v1';

/**
 * NC-D3-1 — fork provenance. Fork A compares the assembled deed against the EXTRACTED source TEXT / consolidated
 * facts (honestly labeled — never "source document"). Fork B (source-image) is the deferred D3B ticket; when it
 * lands it records a different provenance value alongside, without reworking this gate.
 */
export const D3_FORK_PROVENANCE = 'extracted_text_fork_a';

/** The recorded gate mode at sign-off time. A record is only ever created in 'observe' or 'enforce' — the 'off'
 *  mode produces no record and no gate (NC-D3-7). */
export type D3SignoffGateMode = 'observe' | 'enforce';

/** The sign-off outcome. 'overridden' = a genuinely-absent/withheld source fact was passed via the high-friction,
 *  audit-logged attorney override (NC-D3-3); a legal-description MISMATCH is NEVER overridden. */
export type D3SignoffVerdict = 'pass' | 'blocked' | 'overridden';
