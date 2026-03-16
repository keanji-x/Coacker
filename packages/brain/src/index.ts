/**
 * @coacker/brain — Public API
 */

// Brain class (backward-compatible alias for AuditBrain)
export { AuditBrain as Brain } from "./audit/index.js";
export type { BrainOptions, AuditPhase } from "./audit/index.js";

// Audit types + prompts
export type {
  SubTask,
  TaskReport,
  AuditReport,
  AuditBrainOptions,
  AuditBrainState,
} from "./audit/index.js";

export {
  INTENTION_SYSTEM_PROMPT,
  IMPLEMENTATION_SYSTEM_PROMPT,
  REVIEWER_SYSTEM_PROMPT,
  ATTACKER_SYSTEM_PROMPT,
  ISSUE_PROPOSER_SYSTEM_PROMPT,
  GAP_ANALYZER_SYSTEM_PROMPT,
  CONSOLIDATION_SYSTEM_PROMPT,
} from "./audit/index.js";
