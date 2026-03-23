/**
 * @coacker/brain/audit — Audit Brain
 *
 * 审查状态机 + 角色 Prompts + 类型
 */

// ── State Machine ──
export { AuditBrain } from "./audit-brain.js";
export type { BrainOptions } from "./audit-brain.js";

// ── Types ──
export type {
  SubTask,
  TaskReport,
  AuditReport,
  AuditPhase,
  AuditBrainOptions,
  AuditBrainState,
} from "./types.js";

// ── Prompts ──
export {
  INTENTION_SYSTEM_PROMPT,
  IMPLEMENTATION_SYSTEM_PROMPT,
  REVIEWER_SYSTEM_PROMPT,
  ATTACKER_SYSTEM_PROMPT,
  ISSUE_PROPOSER_SYSTEM_PROMPT,
  GAP_ANALYZER_SYSTEM_PROMPT,
  CONSOLIDATION_SYSTEM_PROMPT,
} from "./prompts.js";

// ── Sub-modules (advanced usage) ──
export {
  buildIntentionTask,
  buildSubTask,
  buildGapTask,
  buildConsolidationTask,
} from "./task-builder.js";
export { buildLocalTasks } from "./local-task-builder.js";


export {
  getFirstResponse,
  extractReport,
  parseIntentionTasks,
  parseGapResult,
} from "./result-parser.js";

export { buildReport } from "./report-builder.js";
