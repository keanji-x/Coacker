/**
 * @coacker/backend — AG (Antigravity CDP) 实现
 *
 * 通过 Playwright CDP 操控 Antigravity/Cursor IDE。
 * 实现统一 Backend 接口，Player 无需了解 CDP 细节。
 */

import type { Backend, BackendOptions, ChatResult, ChatOptions } from './interface.js';
import { Antigravity } from './ag/client.js';
import type { ChatResult as AgChatResult } from './ag/types.js';

export interface AgBackendOptions extends BackendOptions {
  /** 连接的页面标题关键字 */
  pageTitle?: string;
  /** CDP 窗口标题 (config 层面) */
  windowTitle?: string;
}

export class AgBackend implements Backend {
  readonly name = 'ag-cdp';
  private ag: Antigravity;
  private _connected = false;
  private _pageTitle: string;

  constructor(options: AgBackendOptions = {}) {
    this.ag = new Antigravity({
      endpointUrl: options.endpointUrl,
      timeout: options.timeout,
      humanize: options.humanize,
    });
    this._pageTitle = options.windowTitle ?? options.pageTitle ?? '';
  }

  get isConnected(): boolean {
    return this._connected;
  }

  async connect(target?: string): Promise<string> {
    const title = await this.ag.connect(target ?? this._pageTitle);
    this._connected = true;
    return title;
  }

  async disconnect(): Promise<void> {
    await this.ag.disconnect();
    this._connected = false;
  }

  async newConversation(): Promise<void> {
    await this.ag.newConversation();
  }

  async listConversations(): Promise<{id: string, title?: string}[]> {
    return await this.ag.listConversations();
  }

  async switchToConversation(id: string): Promise<void> {
    await this.ag.switchToConversation(id);
  }

  async chat(message: string, options?: ChatOptions): Promise<ChatResult> {
    const agResult: AgChatResult = await this.ag.chat(message, {
      autoAccept: options?.autoAccept ?? true,
      timeout: options?.timeout ?? 300,
      pollInterval: options?.pollInterval,
      idleThreshold: options?.idleThreshold,
    });

    // AgChatResult → Backend ChatResult (接口对齐)
    return {
      response: agResult.response,
      fullPanel: agResult.fullPanel,
      state: agResult.state === 'waiting_approval' ? 'waiting_approval'
        : agResult.state === 'timeout' ? 'timeout'
        : agResult.state === 'done' ? 'done'
        : 'error',
      elapsed: agResult.elapsed,
      steps: agResult.steps,
      approvals: agResult.approvals,
    };
  }

  async stop(): Promise<void> {
    await this.ag.stop();
  }

  async screenshot(path?: string): Promise<string> {
    return this.ag.screenshot(path);
  }

  /** 暴露底层 AG 实例 (高级用法, 如直接 evalJS) */
  get raw(): Antigravity {
    return this.ag;
  }
}
