/**
 * @coacker/backend — MockBackend (测试用)
 *
 * 模拟 Backend 接口，按预设脚本返回结果。
 * 用于单测和集成测试，不需要真实 IDE。
 */

import type { Backend, ChatResult, ChatOptions } from "./interface.js";

export interface MockResponse {
  /** 回复文本 (模拟快照) */
  snapshot: string;
  /** 状态 */
  state?: ChatResult["state"];
  /** 延迟 (ms) */
  delay?: number;
}

export class MockBackend implements Backend {
  readonly name = "mock";
  private _connected = false;
  private _responses: MockResponse[] = [];
  private _callIndex = 0;

  /** 聊天历史记录 */
  readonly chatHistory: Array<{ message: string; options?: ChatOptions }> = [];
  /** 新建对话次数 */
  conversationCount = 0;

  constructor(responses?: MockResponse[]) {
    this._responses = responses ?? [];
  }

  get isConnected(): boolean {
    return this._connected;
  }

  /** 预设一批回复 (按调用顺序消费) */
  setResponses(responses: MockResponse[]): void {
    this._responses = responses;
    this._callIndex = 0;
  }

  async connect(_target?: string): Promise<string> {
    this._connected = true;
    return "MockBackend - Test Page";
  }

  async disconnect(): Promise<void> {
    this._connected = false;
  }

  async newConversation(): Promise<void> {
    this.conversationCount++;
  }

  async listConversations(): Promise<{ id: string; title?: string }[]> {
    return [{ id: "mock-conv-1", title: "Mock Conv 1" }];
  }

  async switchToConversation(_id: string): Promise<void> {
    // dummy switch
  }

  async chat(message: string, options?: ChatOptions): Promise<ChatResult> {
    this.chatHistory.push({ message, options });

    const mockResp = this._responses[this._callIndex] ?? {
      snapshot: `[Mock] No response configured for call #${this._callIndex}`,
      state: "done" as const,
    };
    this._callIndex++;

    if (mockResp.delay) {
      await new Promise((r) => setTimeout(r, mockResp.delay));
    }

    return {
      snapshot: mockResp.snapshot,
      state: mockResp.state ?? "done",
      elapsed: (mockResp.delay ?? 10) / 1000,
      steps: 1,
      approvals: 0,
      retries: 0,
    };
  }

  async stop(): Promise<void> {}
}
