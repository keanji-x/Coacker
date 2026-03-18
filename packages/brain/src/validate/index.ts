/**
 * @coacker/brain/validate — Issue Validator Brain
 *
 * 验证状态机 + 角色 Prompts + 类型
 */

// ── State Machine ──
export { ValidateBrain } from "./validate-brain.js";

// ── Types ──
export type {
  IssueItem,
  ReviewVerdict,
  UnderstandingResult,
  ValidationResult,
  ValidatePhase,
  ValidateBrainOptions,
  ValidateBrainState,
} from "./types.js";

// ── Prompts ──
export {
  ISSUE_ANALYST_SYSTEM_PROMPT,
  TEST_GENERATOR_SYSTEM_PROMPT,
  TEST_REVIEWER_SYSTEM_PROMPT,
} from "./prompts.js";

// ── Sub-modules (advanced usage) ──
export {
  buildUnderstandAndGenTask,
  buildReviewTask,
  buildRetryGenTask,
  buildPrCreateTask,
} from "./task-builder.js";

export {
  getStepSnapshot,
  parseUnderstanding,
  parseTestGenResult,
  parseReviewVerdict,
} from "./result-parser.js";
