/**
 * @coacker/player — Player 执行者
 *
 * Player 是 Brain 和 Backend 之间的桥梁:
 *   1. 从 Brain 接收 Task (包含多个 steps)
 *   2. 开新对话
 *   3. 按步骤顺序执行 (同一个对话里)
 *   4. 收集每步的结果
 *   5. 将 TaskResult 交回 Brain
 *
 * Player 维护对话注册表，记录每个 task 在哪个对话里执行。
 */

import type { Backend, ChatResult } from "@coacker/backend";
import type { Task, TaskResult, StepResult } from "@coacker/shared";
import { Logger } from "@coacker/shared";
import { buildStepPrompt } from "./context.js";
import { collectStepResult } from "./collector.js";

export interface PlayerOptions {
  /** 注入的 Backend 实例 */
  backend: Backend;
  /** 单次步骤超时 (秒) */
  taskTimeout?: number;
  /** 角色 prompt 映射 (role → system prompt 文本) */
  rolePrompts?: Record<string, string>;
}

/** executeTask 的可选参数 */
export interface TaskExecuteOptions {
  /** 每个步骤开始前触发的回调 */
  onStepStart?: (info: {
    stepId: string;
    stepIndex: number;
    totalSteps: number;
    conversationId: string;
  }) => void;
  /** 每个步骤完成后触发的回调 (用于 checkpoint tracking, 可异步) */
  onStepEnd?: (info: {
    stepId: string;
    stepIndex: number;
    totalSteps: number;
    conversationId: string;
  }) => void | Promise<void>;
}

/** 对话记录 — Player 内部跟踪每个对话的生命周期 */
export interface ConversationRecord {
  /** 自增 ID (conv_1, conv_2, ...) */
  id: string;
  /** 关联的 Task ID */
  taskId: string;
  /** 对话开始时间 */
  startedAt: number;
  /** 在这个对话里发过的消息数 */
  messageCount: number;
}

export class Player {
  private _backend: Backend;
  private log: Logger;
  private taskTimeout: number;

  // ── 角色 prompt (实例级) ──
  private _rolePrompts: Map<string, string> = new Map();

  // ── 对话管理 ──
  private _conversations: ConversationRecord[] = [];
  private _convCounter = 0;

  constructor(options: PlayerOptions) {
    this._backend = options.backend;
    this.log = new Logger("player");
    this.taskTimeout = options.taskTimeout ?? 300;

    // 注册角色 prompts (实例级，不再使用全局 Map)
    if (options.rolePrompts) {
      for (const [role, prompt] of Object.entries(options.rolePrompts)) {
        this._rolePrompts.set(role, prompt);
      }
    }
  }

  /**
   * 连接到 Backend
   */
  async connect(target?: string): Promise<string> {
    const title = await this._backend.connect(target);
    this.log.info(`Connected to: ${title}`);
    return title;
  }

  /**
   * 断开连接
   */
  async disconnect(): Promise<void> {
    await this._backend.disconnect();
    this.log.info("Disconnected");
  }

  /**
   * 执行单个任务 (包含多步骤)
   *
   * 流程:
   *   1. 开新对话
   *   2. 按步骤顺序执行，全在同一个对话里
   *   3. 如果某步失败，后续步骤标记为 skipped
   *   4. 收集所有步骤的结果，打包为 TaskResult
   */
  async executeTask(
    task: Task,
    options?: TaskExecuteOptions,
  ): Promise<TaskResult> {
    if (!this._backend.isConnected) {
      throw new Error("Player not connected. Call player.connect() first.");
    }

    this.log.info(
      `▶ Starting task: ${task.id} (${task.type}, ${task.steps.length} steps)`,
    );

    const startTime = Date.now();

    try {
      // 1. 开新对话
      await this._backend.newConversation();
      const conv: ConversationRecord = {
        id: `conv_${++this._convCounter}`,
        taskId: task.id,
        startedAt: Date.now(),
        messageCount: 0,
      };
      this._conversations.push(conv);
      this.log.debug(`📎 New conversation: ${conv.id}`);

      // 2. 按步骤执行
      const stepResults: StepResult[] = [];
      let previousFailed = false;

      for (let i = 0; i < task.steps.length; i++) {
        const step = task.steps[i];
        // 如果前一步失败，跳过后续步骤
        if (previousFailed) {
          stepResults.push({
            stepId: step.id,
            role: step.role,
            prompt: "",
            snapshot: "",
            status: "skipped",
            elapsed: 0,
            steps: 0,
            approvals: 0,
          });
          this.log.info(`  ⏭ Step ${step.id} skipped (previous failed)`);
          continue;
        }

        // 触发步骤开始回调
        options?.onStepStart?.({
          stepId: step.id,
          stepIndex: i,
          totalSteps: task.steps.length,
          conversationId: conv.id,
        });

        // 构建 prompt 并发送 (使用实例级 rolePrompts)
        const prompt = buildStepPrompt(step, this._rolePrompts);
        this.log.debug(
          `  📤 Step ${step.id} (${step.role}): ${prompt.length} chars`,
        );

        const chatResult = await this._backend.chat(prompt, {
          autoAccept: true,
          timeout: this.taskTimeout,
          outputTag: `${task.id}__${step.id}`,
        });

        conv.messageCount++;

        // 收集步骤结果
        const stepResult = collectStepResult(
          step.id,
          step.role,
          prompt,
          chatResult,
        );
        stepResults.push(stepResult);

        const icon = stepResult.status === "success" ? "✅" : "❌";
        this.log.info(
          `  ${icon} Step ${step.id} (${step.role}): ${stepResult.status} (${stepResult.elapsed.toFixed(1)}s)`,
        );

        // 触发步骤完成回调 (可能是 async)
        await options?.onStepEnd?.({
          stepId: step.id,
          stepIndex: i,
          totalSteps: task.steps.length,
          conversationId: conv.id,
        });

        if (stepResult.status !== "success") {
          previousFailed = true;
        }
      }

      // 3. 整体状态判定
      const totalElapsed = (Date.now() - startTime) / 1000;
      const allSuccess = stepResults.every((s) => s.status === "success");
      const allFailed = stepResults.every(
        (s) => s.status === "error" || s.status === "skipped",
      );
      const overallStatus = allSuccess
        ? "success"
        : allFailed
          ? "error"
          : "partial";

      const result: TaskResult = {
        taskId: task.id,
        type: task.type,
        status: overallStatus,
        stepResults,
        elapsed: totalElapsed,
        conversationId: conv.id,
      };

      const icon =
        overallStatus === "success"
          ? "✅"
          : overallStatus === "partial"
            ? "⚠️"
            : "❌";
      this.log.info(
        `${icon} Task ${task.id}: ${overallStatus} (${totalElapsed.toFixed(1)}s) [${conv.id}]`,
      );

      return result;
    } catch (error) {
      const totalElapsed = (Date.now() - startTime) / 1000;
      const result: TaskResult = {
        taskId: task.id,
        type: task.type,
        status: "error",
        stepResults: [],
        elapsed: totalElapsed,
        error: error instanceof Error ? error.message : String(error),
      };

      this.log.error(`❌ Task ${task.id} failed: ${result.error}`);
      return result;
    }
  }

  /**
   * 等待 AI 回复完成 (不发送消息)
   *
   * 用于断点续传: prompt 已发出但进程中断，恢复后只需等回复。
   * 返回单步的 ChatResult。
   */
  async waitForResponse(options?: { timeout?: number }): Promise<ChatResult> {
    if (!this._backend.isConnected) {
      throw new Error("Player not connected. Call player.connect() first.");
    }

    this.log.info("⏳ Waiting for AI response (resume)...");
    const chatResult = await this._backend.waitForIdle({
      autoAccept: true,
      timeout: options?.timeout ?? this.taskTimeout,
    });

    const icon = chatResult.state === "done" ? "✅" : "❌";
    this.log.info(
      `${icon} Resume wait: ${chatResult.state} (${chatResult.elapsed.toFixed(1)}s)`,
    );

    return chatResult;
  }

  /**
   * 从指定步骤继续执行任务 (不新建对话)
   *
   * 用于断点续传: 对话已存在，部分步骤已完成。
   * 从 fromStepIndex 开始执行剩余步骤。
   *
   * @param task - 完整的任务定义
   * @param fromStepIndex - 从哪个步骤开始 (0-indexed)
   * @param existingConvId - 已有对话 ID (用于追踪)
   * @param options - 执行选项
   */
  async continueTask(
    task: Task,
    fromStepIndex: number,
    existingConvId: string,
    options?: TaskExecuteOptions,
  ): Promise<TaskResult> {
    if (!this._backend.isConnected) {
      throw new Error("Player not connected. Call player.connect() first.");
    }

    this.log.info(
      `▶ Resuming task: ${task.id} from step ${fromStepIndex}/${task.steps.length}`,
    );

    const startTime = Date.now();

    try {
      // 复用已有 conversation 记录
      const conv: ConversationRecord = {
        id: existingConvId,
        taskId: task.id,
        startedAt: Date.now(),
        messageCount: 0,
      };
      this._conversations.push(conv);

      // 已跳过的步骤标记为 skipped (它们已在之前的运行中完成)
      const stepResults: StepResult[] = [];
      for (let i = 0; i < fromStepIndex; i++) {
        const step = task.steps[i];
        stepResults.push({
          stepId: step.id,
          role: step.role,
          prompt: "",
          snapshot: "[resumed — completed in previous run]",
          status: "success",
          elapsed: 0,
          steps: 0,
          approvals: 0,
        });
      }

      // 从 fromStepIndex 执行剩余步骤
      let previousFailed = false;

      for (let i = fromStepIndex; i < task.steps.length; i++) {
        const step = task.steps[i];

        if (previousFailed) {
          stepResults.push({
            stepId: step.id,
            role: step.role,
            prompt: "",
            snapshot: "",
            status: "skipped",
            elapsed: 0,
            steps: 0,
            approvals: 0,
          });
          this.log.info(`  ⏭ Step ${step.id} skipped (previous failed)`);
          continue;
        }

        options?.onStepStart?.({
          stepId: step.id,
          stepIndex: i,
          totalSteps: task.steps.length,
          conversationId: conv.id,
        });

        const prompt = buildStepPrompt(step, this._rolePrompts);
        this.log.debug(
          `  📤 Step ${step.id} (${step.role}): ${prompt.length} chars`,
        );

        const chatResult = await this._backend.chat(prompt, {
          autoAccept: true,
          timeout: this.taskTimeout,
          outputTag: `${task.id}__${step.id}`,
        });

        conv.messageCount++;

        const stepResult = collectStepResult(
          step.id,
          step.role,
          prompt,
          chatResult,
        );
        stepResults.push(stepResult);

        const icon = stepResult.status === "success" ? "✅" : "❌";
        this.log.info(
          `  ${icon} Step ${step.id} (${step.role}): ${stepResult.status} (${stepResult.elapsed.toFixed(1)}s)`,
        );

        // 触发步骤完成回调 (可能是 async)
        await options?.onStepEnd?.({
          stepId: step.id,
          stepIndex: i,
          totalSteps: task.steps.length,
          conversationId: conv.id,
        });

        if (stepResult.status !== "success") {
          previousFailed = true;
        }
      }

      // 整体状态判定
      const totalElapsed = (Date.now() - startTime) / 1000;
      const activeResults = stepResults.slice(fromStepIndex);
      const allSuccess = activeResults.every((s) => s.status === "success");
      const allFailed = activeResults.every(
        (s) => s.status === "error" || s.status === "skipped",
      );
      const overallStatus = allSuccess
        ? "success"
        : allFailed
          ? "error"
          : "partial";

      const result: TaskResult = {
        taskId: task.id,
        type: task.type,
        status: overallStatus,
        stepResults,
        elapsed: totalElapsed,
        conversationId: conv.id,
      };

      const icon =
        overallStatus === "success"
          ? "✅"
          : overallStatus === "partial"
            ? "⚠️"
            : "❌";
      this.log.info(
        `${icon} Task ${task.id} (resumed): ${overallStatus} (${totalElapsed.toFixed(1)}s) [${conv.id}]`,
      );

      return result;
    } catch (error) {
      const totalElapsed = (Date.now() - startTime) / 1000;
      const result: TaskResult = {
        taskId: task.id,
        type: task.type,
        status: "error",
        stepResults: [],
        elapsed: totalElapsed,
        error: error instanceof Error ? error.message : String(error),
      };

      this.log.error(`❌ Task ${task.id} resume failed: ${result.error}`);
      return result;
    }
  }

  // ── 查询 API ──

  /** 所有对话记录 */
  get conversations(): readonly ConversationRecord[] {
    return this._conversations;
  }

  /** Backend 实例 */
  get backend(): Backend {
    return this._backend;
  }
}
