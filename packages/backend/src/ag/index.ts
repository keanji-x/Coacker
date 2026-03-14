/**
 * @coacker/ag — Antigravity 自动化控制模块
 *
 * 通过 CDP 连接 Antigravity (VS Code Electron),
 * 提供创建对话、发送消息、自动审批、获取回复等功能。
 */

export { Antigravity } from './client.js';
export { AgentState, Keys } from './types.js';
export type { ChatResult, ConversationInfo, AntigravityOptions, CDPPageInfo } from './types.js';
export { detectState, clickAccept } from './state.js';
export { snapshotPanel, diffSnapshots, extractLastResponse } from './panel.js';
export { humanDelay, humanType, humanTypeFast, microPause, sleep } from './humanize.js';
export { focusChatInput } from './input.js';
