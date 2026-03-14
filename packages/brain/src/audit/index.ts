/**
 * @coacker/brain/audit — Audit Brain
 *
 * 审查流水线: 多角色代码审查 (Intention → Implement → Review → Attack)
 */

export { AuditPipeline } from './pipeline.js';

export type {
  AuditPipelineOptions,
  SubTask,
  TaskReport,
  GapResult,
  AuditReport,
} from './types.js';

export {
  INTENTION_SYSTEM_PROMPT,
  IMPLEMENTATION_SYSTEM_PROMPT,
  REVIEWER_SYSTEM_PROMPT,
  ATTACKER_SYSTEM_PROMPT,
  GAP_ANALYZER_SYSTEM_PROMPT,
} from './prompts.js';
