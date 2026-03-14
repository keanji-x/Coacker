/**
 * @coacker/player — Player 执行者
 *
 * Player 是 Brain 和 Backend 之间的桥梁:
 *   1. 从 Brain 接收 Task
 *   2. 准备环境: 加载 skills, 构建上下文
 *   3. 操控 Backend: 新建对话, 注入 prompt, 发送消息
 *   4. 收集结果: 从 Backend 返回中提取结构化信息
 *   5. 将 TaskResult 交回给 Brain
 */

import type { Backend, ChatResult } from '@coacker/backend';
import type { Task, TaskResult, CoasterEvents } from '@coacker/shared';
import { Logger } from '@coacker/shared';
import { buildPrompt } from './context.js';
import { loadSkills, getSkillsContent } from './skills.js';
import { collectResult } from './collector.js';

export interface PlayerOptions {
  /** 注入的 Backend 实例 (Player 不创建 Backend, 由外部注入) */
  backend: Backend;
  /** Skills 目录 */
  skillsDir?: string;
  /** 单次任务超时 (秒) */
  taskTimeout?: number;
  /** 事件回调 */
  events?: CoasterEvents;
}

export class Player {
  private _backend: Backend;
  private log: Logger;
  private skillsDir: string;
  private taskTimeout: number;
  private events: CoasterEvents;

  constructor(options: PlayerOptions) {
    this._backend = options.backend;
    this.log = new Logger('player');
    this.skillsDir = options.skillsDir ?? './skills';
    this.taskTimeout = options.taskTimeout ?? 300;
    this.events = options.events ?? {};
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
    this.log.info('Disconnected');
  }

  /**
   * 执行单个任务
   *
   * 流程:
   *   1. 加载 skills
   *   2. 构建 prompt (上下文工程)
   *   3. 新建对话 (除非 continueConversation)
   *   4. 发送消息到 Backend
   *   5. 收集结果
   *
   * @param options.continueConversation 为 true 时不开新对话，作为 follow-up 发送
   */
  async executeTask(
    task: Task,
    options?: { continueConversation?: boolean },
  ): Promise<TaskResult> {
    if (!this._backend.isConnected) {
      throw new Error('Player not connected. Call player.connect() first.');
    }

    this.log.info(`▶ Starting task: ${task.id} (${task.type})`);
    this.events.onTaskStart?.(task);

    try {
      // 1. 加载 skills
      loadSkills(this.skillsDir);

      // 2. 注入 skills 内容到上下文
      if (task.context?.skills && task.context.skills.length > 0) {
        const skillsContent = getSkillsContent(task.context.skills);
        if (skillsContent) {
          task.context.extra = {
            ...task.context.extra,
            injected_skills: skillsContent,
          };
        }
      }

      // 3. 构建 prompt
      const prompt = buildPrompt(task);
      this.log.debug(`Prompt (${prompt.length} chars)`);

      // 4. 新建对话 (或复用当前对话) + 发送
      if (!options?.continueConversation) {
        await this._backend.newConversation();
      }
      const chatResult = await this._backend.chat(prompt, {
        autoAccept: true,
        timeout: this.taskTimeout,
      });

      // 5. 收集结果
      const result = collectResult(task, chatResult);

      const icon = result.status === 'success' ? '✅' : '❌';
      this.log.info(`${icon} Task ${task.id}: ${result.status} (${result.elapsed.toFixed(1)}s)`);

      this.events.onTaskDone?.(task, result);
      return result;

    } catch (error) {
      const result: TaskResult = {
        taskId: task.id,
        type: task.type,
        status: 'error',
        response: '',
        elapsed: 0,
        steps: 0,
        approvals: 0,
        error: error instanceof Error ? error.message : String(error),
      };

      this.log.error(`❌ Task ${task.id} failed: ${result.error}`);
      this.events.onTaskDone?.(task, result);
      return result;
    }
  }

  /**
   * 批量执行任务 (串行)
   */
  async executeTasks(tasks: Task[]): Promise<TaskResult[]> {
    const results: TaskResult[] = [];
    for (const task of tasks) {
      const result = await this.executeTask(task);
      results.push(result);
    }
    return results;
  }

  /** Backend 实例 (供外部直接操作) */
  get backend(): Backend {
    return this._backend;
  }
}
