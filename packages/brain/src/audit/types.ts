/**
 * @coacker/brain — 审查流水线类型定义
 */

import type { CoasterEvents } from '@coacker/shared';

/** 审查流水线配置 */
export interface AuditPipelineOptions {
  /** 审查流水线配置 */
  audit?: {
    maxGapRounds?: number;
    maxSubTasks?: number;
    projectRoot?: string;
    entryFile?: string;
    userIntent?: string;
  };
  /** 知识库存储目录 */
  knowledgeDir?: string;
  /** 事件回调 */
  events?: CoasterEvents;
}

/** 拆分后的子任务 */
export interface SubTask {
  id: string;
  intention: string;
}

/** 单个子任务的完整审查报告 */
export interface TaskReport {
  taskId: string;
  intention: string;
  implementation: string;
  codeReview: string;
  attackReview: string;
}

/** Gap 分析结果 */
export interface GapResult {
  completenessScore: number;
  gaps: SubTask[];
  duplicates: Array<{
    keep: string;
    remove: string;
    reason: string;
  }>;
}

/** 完整流水线结果 */
export interface AuditReport {
  tasks: TaskReport[];
  summary: string;
  /** 生成 Markdown 报告 */
  toMarkdown(): string;
}
