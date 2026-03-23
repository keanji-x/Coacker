/**
 * @coacker/backend — Claude Code CLI Backend
 *
 * 通过 `claude -p` CLI 实现 Backend 接口。
 * 使用 session 模式 (--session-id / --resume) 保持对话上下文。
 * 认证由 Claude Code 本地 OAuth 自动处理，无需 API Key。
 *
 * 特性:
 *   · 完整对话上下文 (multi-step tasks 可以正常工作)
 *   · 工具调用默认开启 (读写文件、执行命令)
 *   · 权限自动批准 (--permission-mode acceptEdits)
 *   · 无需 ANTHROPIC_API_KEY (走 Claude Max/Pro 订阅额度)
 */

import { spawn, execSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import type {
  Backend,
  BackendOptions,
  ChatResult,
  ChatOptions,
} from "./interface.js";

export interface ClaudeCodeBackendOptions extends BackendOptions {
  /** Claude CLI 模型 (e.g. "sonnet", "opus"). 默认: CLI 默认 */
  model?: string;
  /** 允许的工具列表. 默认: "default" (全部开启) */
  tools?: string;
  /** 权限模式. 默认: "acceptEdits" */
  permissionMode?: string;
  /** claude 二进制路径. 默认: "claude" */
  claudeBinary?: string;
  /** 工作目录 (claude 进程的 cwd). 默认: process.cwd() */
  cwd?: string;
  /** 追加的 system prompt. 默认: undefined */
  systemPrompt?: string;
}

export class ClaudeCodeBackend implements Backend {
  readonly name = "claude-code";
  private _connected = false;
  private _version = "";
  private _sessionId: string | null = null;
  private _messageCount = 0;
  private _currentProcess: ChildProcess | null = null;

  // 配置
  private readonly model?: string;
  private readonly tools: string;
  private readonly permissionMode: string;
  private readonly claudeBinary: string;
  private readonly cwd: string;
  private readonly systemPrompt?: string;

  constructor(options: ClaudeCodeBackendOptions = {}) {
    this.model = options.model;
    this.tools = options.tools ?? "default";
    this.permissionMode = options.permissionMode ?? "acceptEdits";
    this.claudeBinary = options.claudeBinary ?? "claude";
    this.cwd = options.cwd ?? process.cwd();
    this.systemPrompt = options.systemPrompt;
  }

  get isConnected(): boolean {
    return this._connected;
  }

  /**
   * 验证 claude CLI 可用
   */
  async connect(_target?: string): Promise<string> {
    try {
      const version = execSync(`${this.claudeBinary} --version 2>&1`, {
        encoding: "utf-8",
        timeout: 10_000,
      }).trim();
      this._version = version;
      this._connected = true;
      return `Claude Code CLI (${version})`;
    } catch (err) {
      throw new Error(
        `Cannot find claude CLI at "${this.claudeBinary}": ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  async disconnect(): Promise<void> {
    // kill any running process
    if (this._currentProcess && !this._currentProcess.killed) {
      this._currentProcess.kill("SIGTERM");
    }
    this._connected = false;
    this._sessionId = null;
    this._messageCount = 0;
  }

  /**
   * 开新对话 = 新 session UUID
   */
  async newConversation(): Promise<void> {
    this._sessionId = randomUUID();
    this._messageCount = 0;
  }

  async listConversations(): Promise<{ id: string; title?: string }[]> {
    // Claude CLI 不暴露 session 列表接口
    return [];
  }

  /**
   * 切换到指定 session
   */
  async switchToConversation(id: string): Promise<void> {
    this._sessionId = id;
  }

  /**
   * 核心: 发送消息并等待回复
   *
   * 使用 claude -p --session-id/--resume 保持对话上下文
   */
  async chat(message: string, options?: ChatOptions): Promise<ChatResult> {
    if (!this._sessionId) {
      await this.newConversation();
    }

    const startTime = Date.now();

    // 构建命令行参数
    const args = this.buildArgs();

    return new Promise<ChatResult>((resolve) => {
      let stdout = "";
      let stderr = "";
      let timedOut = false;

      const proc = spawn(this.claudeBinary, args, {
        cwd: this.cwd,
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env },
      });
      this._currentProcess = proc;

      proc.stdout!.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });

      proc.stderr!.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      // 超时处理
      const timeoutSec = options?.timeout ?? 300;
      const timer = setTimeout(() => {
        timedOut = true;
        proc.kill("SIGTERM");
        // 给 SIGTERM 2 秒优雅退出
        setTimeout(() => {
          if (!proc.killed) proc.kill("SIGKILL");
        }, 2000);
      }, timeoutSec * 1000);

      proc.on("close", (code) => {
        clearTimeout(timer);
        this._currentProcess = null;
        this._messageCount++;

        const elapsed = (Date.now() - startTime) / 1000;
        const responseText = stdout.trim();

        const state: ChatResult["state"] = timedOut
          ? "timeout"
          : code === 0
            ? "done"
            : "error";

        if (state === "error" && stderr) {
          console.error(`[claude-code] stderr: ${stderr.trim()}`);
        }

        resolve({
          snapshot: responseText || stderr.trim(),
          response: responseText || undefined,
          responseFile: undefined,
          state,
          elapsed,
          steps: 1,
          approvals: 0,
          retries: 0,
          conversationTitle: null,
        });
      });

      proc.on("error", (err) => {
        clearTimeout(timer);
        this._currentProcess = null;

        resolve({
          snapshot: `Process error: ${err.message}`,
          response: undefined,
          responseFile: undefined,
          state: "error",
          elapsed: (Date.now() - startTime) / 1000,
          steps: 0,
          approvals: 0,
          retries: 0,
          conversationTitle: null,
        });
      });

      // 写入 prompt 并关闭 stdin
      proc.stdin!.write(message);
      proc.stdin!.end();
    });
  }

  async getConversationTitle(): Promise<string | null> {
    return null;
  }

  /**
   * Claude CLI 没有异步等待的概念 — 每次 chat() 都是同步等进程退出
   */
  async waitForIdle(_options?: ChatOptions): Promise<ChatResult> {
    return {
      snapshot: "[claude-code] No pending response",
      response: undefined,
      responseFile: undefined,
      state: "done",
      elapsed: 0,
      steps: 0,
      approvals: 0,
      retries: 0,
      conversationTitle: null,
    };
  }

  /**
   * 终止当前运行的 claude 进程
   */
  async stop(): Promise<void> {
    if (this._currentProcess && !this._currentProcess.killed) {
      this._currentProcess.kill("SIGTERM");
    }
  }

  // ── Private Helpers ──

  /**
   * 构建 claude CLI 参数
   */
  private buildArgs(): string[] {
    const args = ["-p"];

    // session 管理: 第一次用 --session-id, 后续用 --resume
    if (this._messageCount === 0) {
      args.push("--session-id", this._sessionId!);
    } else {
      args.push("--resume", this._sessionId!);
    }

    // 输出格式
    args.push("--output-format", "text");

    // 模型
    if (this.model) {
      args.push("--model", this.model);
    }

    // 工具
    if (this.tools) {
      args.push("--tools", this.tools);
    }

    // 权限模式
    if (this.permissionMode) {
      args.push("--permission-mode", this.permissionMode);
    }

    // system prompt
    if (this.systemPrompt) {
      args.push("--append-system-prompt", this.systemPrompt);
    }

    return args;
  }

  /** 当前 session ID */
  get sessionId(): string | null {
    return this._sessionId;
  }

  /** Claude CLI 版本 */
  get version(): string {
    return this._version;
  }
}
