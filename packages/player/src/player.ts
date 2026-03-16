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

import type { Backend } from "@coacker/backend";
import type { Task, TaskResult, StepResult } from "@coacker/shared";
import { Logger } from "@coacker/shared";
import { buildStepPrompt, registerRolePrompts } from "./context.js";
import { collectStepResult } from "./collector.js";

export interface PlayerOptions {
  /** 注入的 Backend 实例 */
  backend: Backend;
  /** 单次步骤超时 (秒) */
  taskTimeout?: number;
  /** 角色 prompt 映射 (role → system prompt 文本) */
  rolePrompts?: Record<string, string>;
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

  // ── 对话管理 ──
  private _conversations: ConversationRecord[] = [];
  private _convCounter = 0;

  constructor(options: PlayerOptions) {
    this._backend = options.backend;
    this.log = new Logger("player");
    this.taskTimeout = options.taskTimeout ?? 300;

    // 注册角色 prompts
    if (options.rolePrompts) {
      registerRolePrompts(options.rolePrompts);
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
  async executeTask(task: Task): Promise<TaskResult> {
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

      for (const step of task.steps) {
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

        // 构建 prompt 并发送
        const prompt = buildStepPrompt(step);
        this.log.debug(
          `  📤 Step ${step.id} (${step.role}): ${prompt.length} chars`,
        );

        const chatResult = await this._backend.chat(prompt, {
          autoAccept: true,
          timeout: this.taskTimeout,
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
