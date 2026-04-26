/**
 * Prompt Version Registry (Ch 22.8, R11)
 *
 * This module exposes the currently-active prompt version for each role.
 * Versions are read from environment variables at server startup and cached.
 *
 * IMMUTABILITY RULE (R11 / Ch 22.8):
 *   The version captured at job creation is stored in jobs.promptVersion
 *   and is IMMUTABLE for the lifetime of the job. No procedure ever issues:
 *     UPDATE jobs SET promptVersion = ...
 *   This is enforced by grep in the Phase 2 acceptance criteria.
 *
 * PROMPT VERSION LOCK:
 *   If an operator updates the active prompt version (via env var + redeploy)
 *   while a job is running, the running job continues executing against its
 *   captured version. Prompt changes never affect in-progress jobs.
 *
 * TELEMETRY:
 *   When a deploy changes an active prompt version, the system emits a
 *   `prompt_version_changed` telemetry event with old and new versions and
 *   the role. This is handled at server startup by comparing env values
 *   against the previously-deployed values (stored in a startup-state file
 *   or detected via the first job of each role).
 *
 * ADDING A NEW ROLE:
 *   1. Add the role key to the PROMPT_VERSION object below.
 *   2. Add the corresponding env variable to .env.example.
 *   3. Add the prompt file to server/llm/prompts/ with the correct version.
 *   4. Update the schema-consistency test.
 */

// ============================================================
// Role definitions
// ============================================================
// Each role maps to a prompt file in server/llm/prompts/.
// Format: {role}.v{version}.md  (e.g., drafter.v1.0.md)
//
// Drafter-family roles (not attorney-selectable, env-configured):
//   drafter      — draft_generation, regeneration, formatting
//   extractor    — data_extraction
//   outline      — outline_generation
//   matrix       — information_request_generation
//
// Reviewer role (attorney-selectable per Ch 22.2):
//   reviewer     — review jobs (all four provider adapters use this prompt asset)
//
// Evaluator role (not attorney-selectable, env-configured):
//   evaluator    — review cycle consolidation

export const PROMPT_ROLES = [
  'drafter',
  'extractor',
  'outline',
  'matrix',
  'reviewer',
  'evaluator',
] as const;

export type PromptRole = (typeof PROMPT_ROLES)[number];

// ============================================================
// Active version per role
// Read from environment variables at module load time.
// Defaults are the v1 launch versions.
// ============================================================
function resolveVersion(envVar: string, defaultVersion: string): string {
  const v = process.env[envVar];
  if (v && v.trim().length > 0) return v.trim();
  return defaultVersion;
}

export const PROMPT_VERSION: Record<PromptRole, string> = {
  drafter: resolveVersion('DRAFTER_PROMPT_VERSION', '1.0'),
  extractor: resolveVersion('EXTRACTOR_PROMPT_VERSION', '1.0'),
  outline: resolveVersion('OUTLINE_PROMPT_VERSION', '1.0'),
  matrix: resolveVersion('MATRIX_PROMPT_VERSION', '1.0'),
  reviewer: resolveVersion('REVIEWER_PROMPT_VERSION', '1.0'),
  evaluator: resolveVersion('EVALUATOR_PROMPT_VERSION', '1.0'),
};

// ============================================================
// Job type → prompt role mapping
// Used by job creation paths to look up the correct prompt version
// to capture in jobs.promptVersion at insert time.
// ============================================================
export const JOB_TYPE_TO_PROMPT_ROLE: Record<string, PromptRole> = {
  draft_generation: 'drafter',
  regeneration: 'drafter',
  formatting: 'drafter',
  data_extraction: 'extractor',
  outline_generation: 'outline',
  information_request_generation: 'matrix',
  review: 'reviewer',
  reviewer_feedback: 'reviewer',  // review session per-model feedback jobs (Ch 4b)
  evaluator: 'evaluator',          // review cycle consolidation jobs (Ch 4b)
  // context_summary_generation is reserved but not active in v1 (Ch 8.3)
  context_summary_generation: 'drafter',
};

/**
 * Returns the currently-active prompt version for a given job type.
 * This is the value that must be captured in jobs.promptVersion at insert time.
 * It is immutable for the lifetime of the job after that point (R11).
 */
export function getPromptVersionForJobType(jobType: string): string {
  const role = JOB_TYPE_TO_PROMPT_ROLE[jobType];
  if (!role) {
    throw new Error(
      `Unknown jobType "${jobType}" — cannot resolve prompt version. ` +
        `Add it to JOB_TYPE_TO_PROMPT_ROLE in server/llm/promptVersions.ts.`,
    );
  }
  return PROMPT_VERSION[role];
}
