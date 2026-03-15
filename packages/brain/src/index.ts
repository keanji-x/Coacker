/**
 * @coacker/brain — Public API
 */

export { Brain } from './brain.js';
export type { BrainOptions, AuditPhase } from './brain.js';

// Audit types + prompts
export type {
  SubTask,
  TaskReport,
  AuditReport,
} from './audit/index.js';

export {
  INTENTION_SYSTEM_PROMPT,
  IMPLEMENTATION_SYSTEM_PROMPT,
  REVIEWER_SYSTEM_PROMPT,
  ATTACKER_SYSTEM_PROMPT,
  GAP_ANALYZER_SYSTEM_PROMPT,
  CONSOLIDATION_SYSTEM_PROMPT,
} from './audit/index.js';
