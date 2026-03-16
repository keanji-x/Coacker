/**
 * @coacker/brain/audit — Audit Brain
 *
 * 审查角色 System Prompts + 类型导出
 */

export type { SubTask, TaskReport, AuditReport } from "./types.js";

export {
  INTENTION_SYSTEM_PROMPT,
  IMPLEMENTATION_SYSTEM_PROMPT,
  REVIEWER_SYSTEM_PROMPT,
  ATTACKER_SYSTEM_PROMPT,
  ISSUE_PROPOSER_SYSTEM_PROMPT,
  GAP_ANALYZER_SYSTEM_PROMPT,
  CONSOLIDATION_SYSTEM_PROMPT,
} from "./prompts.js";
