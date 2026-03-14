/**
 * ag/types — 共享类型定义
 */

/** Agent 状态 */
export enum AgentState {
  IDLE = 'idle',
  GENERATING = 'generating',
  WAITING_APPROVAL = 'waiting_approval',
}

/** 一次 chat 的完整结果 */
export interface ChatResult {
  /** Agent 回复文本 (panel diff 的新增内容, 可能含噪音) */
  response: string;
  /** 完成后 panel 的完整文本 */
  fullPanel: string;
  /** 最终状态 */
  state: 'done' | 'timeout' | 'error' | 'waiting_approval';
  /** 耗时 (秒) */
  elapsed: number;
  /** 状态机循环次数 */
  steps: number;
  /** 自动接受审批次数 */
  approvals: number;
}

/** 对话元信息 */
export interface ConversationInfo {
  title: string;
  pageTitle: string;
  createdAt: number;
}

/** Antigravity 构造参数 */
export interface AntigravityOptions {
  /** CDP 端点 URL */
  endpointUrl?: string;
  /** 连接超时 (ms) */
  timeout?: number;
  /** 是否模拟人类操作节奏 */
  humanize?: boolean;
}

/** CDP /json 接口返回的页面信息 */
export interface CDPPageInfo {
  id: string;
  title: string;
  type: string;
  url: string;
  webSocketDebuggerUrl?: string;
}

/** 快捷键常量 */
export const Keys = {
  NEW_CONVERSATION: 'Meta+Shift+l',
  FOCUS_CHAT: 'Meta+l',
  SEND_MESSAGE: 'Enter',
  STOP_GENERATION: 'Escape',
} as const;
