/**
 * @coacker/backend — 统一后端接口
 *
 * Player 通过 Backend 接口操控 IDE/LLM，无需关心底层实现。
 * 目前实现: AgBackend (通过 Playwright CDP 操控 Antigravity/Cursor)
 * 未来可扩展: APIBackend (直接调 LLM API), MockBackend (测试) 等
 */

/** Backend 连接选项 */
export interface BackendOptions {
  /** 连接端点 */
  endpointUrl?: string;
  /** 连接超时 (ms) */
  timeout?: number;
  /** 模拟人类操作节奏 */
  humanize?: boolean;
}

/** chat() 返回结果 */
export interface ChatResult {
  /** 面板全量快照 (innerText, debug/日志用) */
  snapshot: string;
  /** 最终状态 */
  state: "done" | "timeout" | "error" | "waiting_approval";
  /** 耗时 (秒) */
  elapsed: number;
  /** 步骤数 */
  steps: number;
  /** 自动审批次数 */
  approvals: number;
  /** 自动重试次数 */
  retries: number;
}

/** chat() 选项 */
export interface ChatOptions {
  /** 自动接受审批弹窗 */
  autoAccept?: boolean;
  /** 超时 (秒) */
  timeout?: number;
  /** 轮询间隔 (ms) */
  pollInterval?: number;
  /** IDLE 确认阈值 (ms) */
  idleThreshold?: number;
  /** "Agent terminated" 后最大自动重试次数 (default: 2) */
  maxRetries?: number;
}

/**
 * Backend 统一接口
 *
 * 任何能对话的后端都实现这个接口。
 * Player 只依赖这个接口，不关心底层是 CDP、API 还是 Mock。
 */
export interface Backend {
  /** 后端名称 */
  readonly name: string;

  /** 是否已连接 */
  readonly isConnected: boolean;

  /** 连接到后端 */
  connect(target?: string): Promise<string>;

  /** 断开连接 */
  disconnect(): Promise<void>;

  /** 创建新对话 */
  newConversation(): Promise<void>;

  /** 列出历史对话 */
  listConversations(): Promise<{ id: string; title?: string }[]>;

  /** 切换到指定对话 */
  switchToConversation(id: string): Promise<void>;

  /** 发送消息并等待回复 */
  chat(message: string, options?: ChatOptions): Promise<ChatResult>;

  /** 停止当前生成 */
  stop(): Promise<void>;

  /** 截屏 (可选) */
  screenshot?(path?: string): Promise<string>;
}
