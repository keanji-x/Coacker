/**
 * @coacker/shared — 共享类型定义
 *
 * Brain / Player / Backend 三层架构的核心类型。
 */

// ─── Config ──────────────────────────────────────────

/** 全局配置 (对应 config.toml) */
export interface CoasterConfig {
  brain?: BrainConfig;
  player?: PlayerConfig;
  backend?: BackendConfig;
  knowledge?: KnowledgeConfig;
}

export interface AuditBrainConfig {
  /** Gap 分析最大轮数 */
  maxGapRounds?: number;
  /** 最大子任务数 */
  maxSubTasks?: number;
  /** 项目根目录 */
  projectRoot?: string;
  /** 入口文件 */
  entryFile?: string;
  /** 用户意图 */
  userIntent?: string;
}

export interface BrainConfig {
  /** Brain 类型 */
  type?: string;
  /** 审查流水线配置 */
  audit?: AuditBrainConfig;
}

export interface PlayerConfig {
  /** 单次任务超时 (秒) */
  taskTimeout?: number;
  /** Skills 目录 */
  skillsDir?: string;
}

export interface BackendConfig {
  /** Backend 类型 */
  type?: string;
  /** AG (CDP) 配置 */
  ag?: AgConfig;
}

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

export interface KnowledgeConfig {
  /** 知识库存储目录 */
  storeDir?: string;
  /** 单个知识条目最大字符数 */
  maxEntrySize?: number;
}

// ─── Task ────────────────────────────────────────────

/** 任务状态 */
export type TaskStatus = 'pending' | 'running' | 'done' | 'error';

/** Brain 派发给 Player 的任务 */
export interface Task {
  /** 唯一 ID */
  id: string;
  /** 任务意图描述 */
  intention: string;
  /** 任务类型 */
  type: TaskType;
  /** 任务状态 */
  status: TaskStatus;
  /** 依赖的任务 ID 列表 */
  dependsOn: string[];
  /** 任务创建时间 */
  createdAt: number;
  /** 需要注入的上下文 */
  context?: TaskContext;
}

/** 任务类型 */
export type TaskType =
  | 'intention'       // 意图分析 (探索项目)
  | 'implement'       // 实现分析 (深入某模块)
  | 'review'          // 代码审查
  | 'attack'          // 逻辑攻击
  | 'gap_analysis'    // 查漏补缺
  | 'custom';         // 自定义

/** 任务上下文 — Player 注入给 Backend 的信息 */
export interface TaskContext {
  /** 入口文件 */
  entryFile?: string;
  /** 用户意图 */
  userIntent?: string;
  /** 项目根目录 */
  projectRoot?: string;
  /** 上游任务的结果 */
  upstreamResults?: Record<string, string>;
  /** Skills 列表 */
  skills?: string[];
  /** 额外的键值对 */
  extra?: Record<string, unknown>;
}

/** 任务执行结果 — Player 收集并交给 Brain */
export interface TaskResult {
  /** 任务 ID */
  taskId: string;
  /** 任务类型 */
  type: TaskType;
  /** 完成状态 */
  status: 'success' | 'error' | 'timeout';
  /** 回复文本 (Backend 返回的完整回复) */
  response: string;
  /** 面板全文 (可选) */
  fullPanel?: string;
  /** 耗时 (秒) */
  elapsed: number;
  /** 状态机步骤数 */
  steps: number;
  /** 自动接受审批次数 */
  approvals: number;
  /** 错误信息 */
  error?: string;
  /** Player 提取的结构化数据 */
  extracted?: Record<string, unknown>;
}

// ─── Knowledge ───────────────────────────────────────

/** 知识条目 */
export interface KnowledgeEntry {
  /** 唯一 ID */
  id: string;
  /** 知识标题 */
  title: string;
  /** 知识内容 (Markdown) */
  content: string;
  /** 来源任务 ID */
  sourceTaskId: string;
  /** 标签 */
  tags: string[];
  /** 创建时间 */
  createdAt: number;
  /** 更新时间 */
  updatedAt: number;
}

// ─── Events / Callbacks ─────────────────────────────

/** 事件回调 */
export interface CoasterEvents {
  onTaskStart?: (task: Task) => void;
  onTaskDone?: (task: Task, result: TaskResult) => void;
  onKnowledgeUpdate?: (entry: KnowledgeEntry) => void;
  onLog?: (level: LogLevel, message: string, data?: unknown) => void;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
