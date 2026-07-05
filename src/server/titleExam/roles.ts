/**
 * roles.ts — TITLE-EXAM-1 (§4b) role vocabulary for the title-exam module.
 *
 * The module references roles by NAME (examiner_a / examiner_b / reconciler / express_reviewer) and resolves
 * the model STRING through the central config resolver — it never names a model id itself. This file just
 * re-exports the config role API + documents each role's epistemology, so the rest of the module imports
 * from here and the no-model-literal guard (title_exam_no_model_literal.test.ts) stays satisfied.
 */

export {
  TITLE_EXAM_ROLES,
  type TitleExamRole,
  resolveTitleExamModel,
  resolveTitleExamRoleKey,
} from '../llm/config.js';

/**
 * Human-readable epistemology per role — the lane INSTRUCTION is role-specific (manual-anchored vs
 * research-capable) even though the model filling the role is configuration (§4b). Used for provenance /
 * display; never for routing.
 */
export const TITLE_EXAM_ROLE_EPISTEMOLOGY: Record<
  'examiner_a' | 'examiner_b' | 'reconciler' | 'express_reviewer',
  string
> = {
  examiner_a: 'manual-anchored examiner (uploaded manuals + recorded instruments control; no live research)',
  examiner_b: 'research-capable examiner (may verify from official/primary sources under the PB-3 egress rule)',
  reconciler: 'fresh-context reconciler (no memory of its own lane; steelmans the other lane on the record)',
  express_reviewer: 'Express critique-round reviewer (bounded auto-review loop)',
};
