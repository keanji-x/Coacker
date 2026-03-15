/**
 * @coacker/brain — 审查流水线类型定义
 */

/** 拆分后的子任务 (Intention 解析结果) */
export interface SubTask {
  id: string;
  intention: string;
}

/** 单个子任务的完整审查报告 */
export interface TaskReport {
  taskId: string;
  intention: string;
  /** 实现分析 (文本) */
  implementation: string;
  /** 代码审查 (文本) */
  codeReview: string;
  /** 逻辑攻击 (文本) */
  attackReview: string;
}

/** 完整流水线结果 */
export interface AuditReport {
  tasks: TaskReport[];
  summary: string;
  /** AI 生成的 Executive Summary */
  executiveSummary: string;
  /** 生成 Markdown 报告 */
  toMarkdown(): string;
}
