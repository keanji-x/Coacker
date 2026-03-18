/**
 * @coacker/shared — 共享类型定义
 *
 * Brain / Player / Backend 三层架构的核心类型。
 */

// ─── Config ──────────────────────────────────────────

/** 全局配置 (对应 config.toml) */
export interface CoackerConfig {
  /** 项目配置 (审查什么) */
  project?: ProjectConfig;
  /** 输出配置 */
  output?: OutputConfig;
  /** Backend 配置 (怎么连接 IDE) */
  backend?: BackendConfig;
  /** Brain 配置 (审查管道参数) */
  brain?: BrainConfig;
  /** Player 配置 */
  player?: PlayerConfig;
}

/** 项目配置 — 描述审查目标 */
export interface ProjectConfig {
  /** 项目根目录 */
  root?: string;
  /** 入口文件 (分析起点) */
  entry?: string;
  /** 用户审查意图 */
  intent?: string;
  /** GitHub origin (owner/repo) — 用于提交 issue */
  origin?: string;
  /** 主分支名 (默认 "main", 用于 branch 切换基准) */
  mainBranch?: string;
}

/** 输出配置 */
export interface OutputConfig {
  /** 报告和知识文件输出目录 */
  dir?: string;
}

/** Backend 配置 */
export interface BackendConfig {
  /** Backend 类型 */
  type?: string;
  /** AG (CDP) 配置 */
  ag?: AgConfig;
}

/** AG CDP 配置 */
export interface AgConfig {
  /** CDP 端点 URL */
  endpointUrl?: string;
  /** 连接超时 (ms) */
  timeout?: number;
  /** 模拟人类操作 */
  humanize?: boolean;
  /** CDP 窗口标题匹配关键字 */
  windowTitle?: string;
}

/** Brain 配置 */
export interface BrainConfig {
  /** Brain 类型 */
  type?: string;
  /** 审查管道配置 */
  audit?: AuditConfig;
  /** 验证管道配置 */
  validate?: ValidateConfig;
}

/** 审查管道配置 — 仅管道调优参数 */
export interface AuditConfig {
  /** Gap 分析最大轮数 (0 = 禁用) */
  maxGapRounds?: number;
  /** 最大子任务数 */
  maxSubTasks?: number;
}

/** 验证管道配置 — Issue Validator Brain 调优参数 */
export interface ValidateConfig {
  /** Review-retry 循环上限 (default 3) */
  maxReviewAttempts?: number;
  /** 排除带有这些 label 的 issue (黑名单, default ["wontfix", "duplicate", "invalid"]) */
  excludeLabels?: string[];
  /** 失败后标记 draft (default true) */
  draftOnFailure?: boolean;
}

/** Player 配置 */
export interface PlayerConfig {
  /** 单次任务超时 (秒) */
  taskTimeout?: number;
}

// ─── Task ────────────────────────────────────────────

/** 任务类型 */
export type TaskType =
  | "intention"
  | "implement"
  | "review"
  | "attack"
  | "gap_analysis"
  | "consolidation"
  | "understand"
  | "test_gen"
  | "test_review"
  | "custom";

/**
 * 任务中的单个步骤
 *
 * 一个 Task 可以包含多个 step，Player 在同一个对话里按顺序执行。
 */
export interface TaskStep {
  /** 步骤 ID (如 'impl', 'review', 'attack') */
  id: string;
  /** 角色 — Player 根据 role 选择 system prompt */
  role: string;
  /** 消息内容 (Brain 构造) */
  message: string;
}

/**
 * Brain 派发给 Player 的任务
 *
 * 一个 Task = Brain 的一次委派 = Player 的一个对话流。
 * Task 内部包含 steps，Player 在同一个 IDE 对话里顺序执行。
 */
export interface Task {
  /** 唯一 ID (语义化，如 'intention', 'review_config') */
  id: string;
  /** 人可读的任务描述 */
  intention: string;
  /** 任务类型 */
  type: TaskType;
  /** 任务包含的步骤 */
  steps: TaskStep[];
}

// ─── Result ──────────────────────────────────────────

/** 单个步骤的执行结果 */
export interface StepResult {
  /** 步骤 ID */
  stepId: string;
  /** 角色 */
  role: string;
  /** 发送给 LLM 的完整 prompt (ask) */
  prompt: string;
  /** 面板全量快照 (debug/日志用) */
  snapshot: string;
  /** 完成状态 */
  status: "success" | "error" | "skipped";
  /** 耗时 (秒) */
  elapsed: number;
  /** 状态机步骤数 */
  steps: number;
  /** 自动接受审批次数 */
  approvals: number;
}

/**
 * 任务执行结果 — Player 收集并交给 Brain
 */
export interface TaskResult {
  /** 任务 ID */
  taskId: string;
  /** 任务类型 */
  type: TaskType;
  /** 整体状态 */
  status: "success" | "partial" | "error";
  /** 每个步骤的执行结果 */
  stepResults: StepResult[];
  /** 总耗时 (秒) */
  elapsed: number;
  /** 对话 ID (Player 分配，用于追踪) */
  conversationId?: string;
  /** 错误信息 */
  error?: string;
}

// ─── Helpers ─────────────────────────────────────────

/** 日志级别 */
export type LogLevel = "debug" | "info" | "warn" | "error";
