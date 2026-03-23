/**
 * @coacker/brain — 审查流水线类型定义
 */

/** 子任务状态 */
export type SubTaskStatus = "pending" | "in_progress" | "done";

/** 当前对话的精确位置，用于断点续传 */
export interface ChatCheckpoint {
  /** 当前 chat 状态: sent = prompt 已发等回复, responded = 已收到回复待下一步 */
  chat_status: "sent" | "responded";
  /** 当前执行的步骤类型: impl / review / attack / explore / gap 等 */
  chat_type: string;
  /** 当前步骤发送的 prompt (方便校验是否是同一轮) */
  chat_input: string;
  /** 该对话的标题 (用于切回对话) */
  conversation_title: string | null;
}

/** 拆分后的子任务 (Intention 解析结果) */
export interface SubTask {
  id: string;
  intention: string;
  status: SubTaskStatus;
  /** 当前运行的对话 ID (仅 in_progress 时有值) */
  conversationId?: string;
  /** 当前 chat 的精确位置 (仅 in_progress 时有值, 用于断点续传) */
  checkpoint?: ChatCheckpoint;
  /** 已完成的 step ID 列表 (用于续传时跳过) */
  completedSteps?: string[];
  /** 当前执行的 pipeline 步骤, 如 "impl" | "review" | "attack" (仅 in_progress 时有值) */
  currentStep?: string;
  /** 已完成 / 总步骤, 如 "1/3" (仅 in_progress 时有值) */
  stepProgress?: string;
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
  /** 提交的 GitHub Issue 提案 (JSON 文本) */
  issueProposals: string;
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

// ─── AuditBrain 内部状态 ─────────────────────────────

/** 审查阶段 */
export type AuditPhase =
  | "idle"
  | "intention"
  | "execution"
  | "gap_analysis"
  | "consolidation"
  | "done";

/** AuditBrain 构造参数 */
export interface AuditBrainOptions {
  /** 项目配置 (来自 config.toml [project]) */
  project: {
    root: string;
    entry: string;
    auditPaths: string[];
    intent: string;
    origin: string;
  };
  /** 审查管道配置 (来自 config.toml [brain.audit]) */
  audit: {
    maxGapRounds: number;
    maxSubTasks: number;
  };
  /** 输出配置 (来自 config.toml [output]) */
  output: {
    dir: string;
  };
}

/** AuditBrain 可序列化状态快照 */
export interface AuditBrainState {
  phase: AuditPhase;
  gapRound: number;
  subtasks: SubTask[];
  reportIds: string[];
  historyCount: number;
  updatedAt: string;
}
