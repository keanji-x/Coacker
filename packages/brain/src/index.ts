/**
 * @coacker/brain — Public API
 */

// Generic infrastructure
export { Brain } from './brain.js';
export type { BrainOptions } from './brain.js';
export { Dispatcher } from './dispatcher.js';
export { KnowledgeStore } from './knowledge.js';
export { consolidate, consolidateBatch, mergeEntries } from './consolidator.js';

// Audit Brain
export {
  AuditPipeline,
  INTENTION_SYSTEM_PROMPT,
  IMPLEMENTATION_SYSTEM_PROMPT,
  REVIEWER_SYSTEM_PROMPT,
  ATTACKER_SYSTEM_PROMPT,
  GAP_ANALYZER_SYSTEM_PROMPT,
} from './audit/index.js';

export type {
  AuditPipelineOptions,
  SubTask,
  TaskReport,
  GapResult,
  AuditReport,
} from './audit/index.js';
