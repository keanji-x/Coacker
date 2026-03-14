/**
 * @coacker/brain — Brain 中央管理者
 *
 * 编排 Player 执行任务，管理知识库，驱动闭环:
 *   Brain 派任务 → Player 执行 → Brain 收集知识 → Brain 派新任务
 */

import { Player } from '@coacker/player';
import type { Task, TaskResult, CoasterEvents } from '@coacker/shared';
import { Logger } from '@coacker/shared';
import { Dispatcher } from './dispatcher.js';
import { KnowledgeStore } from './knowledge.js';
import { consolidateBatch } from './consolidator.js';

export interface BrainOptions {
  /** 知识库存储目录 */
  knowledgeDir?: string;
  /** 审查流水线配置 */
  audit?: {
    maxGapRounds?: number;
    maxSubTasks?: number;
    projectRoot?: string;
    entryFile?: string;
    userIntent?: string;
  };
  /** 事件回调 */
  events?: CoasterEvents;
}

export class Brain {
  readonly dispatcher: Dispatcher;
  readonly knowledge: KnowledgeStore;
  private log: Logger;
  private maxGapRounds: number;
  private events: CoasterEvents;

  constructor(options: BrainOptions = {}) {
    this.dispatcher = new Dispatcher();
    this.knowledge = new KnowledgeStore(options.knowledgeDir ?? './knowledge');
    this.log = new Logger('brain');
    this.maxGapRounds = options.audit?.maxGapRounds ?? 2;
    this.events = options.events ?? {};
  }

  /**
   * 运行完整的任务闭环
   *
   * 流程:
   *   1. 从 Dispatcher 获取就绪任务
   *   2. Player 逐个执行
   *   3. 收集结果 → 知识归纳
   *   4. 检查是否有新任务 (gap analysis)
   *   5. 循环直到所有任务完成
   */
  async run(player: Player): Promise<TaskResult[]> {
    const allResults: TaskResult[] = [];

    this.log.info(`▶ Brain starting. ${this.dispatcher.summary()}`);

    let round = 0;
    while (this.dispatcher.pendingCount > 0 && round <= this.maxGapRounds) {
      const readyTasks = this.dispatcher.getReady();

      if (readyTasks.length === 0) {
        this.log.warn('No ready tasks but pending count > 0. Possible dependency cycle.');
        break;
      }

      this.log.info(`── Round ${round + 1}: ${readyTasks.length} tasks ready ──`);

      // 执行任务
      for (const task of readyTasks) {
        this.dispatcher.updateStatus(task.id, 'running');
        const result = await player.executeTask(task);
        allResults.push(result);

        // 更新任务状态
        this.dispatcher.updateStatus(
          task.id,
          result.status === 'success' ? 'done' : 'error',
        );
      }

      // 知识归纳
      const roundResults = readyTasks.map(t =>
        allResults.find(r => r.taskId === t.id)!
      );
      const entries = consolidateBatch(roundResults);
      for (const entry of entries) {
        this.knowledge.put(entry);
        this.events.onKnowledgeUpdate?.(entry);
      }
      this.knowledge.save();

      this.log.info(`  📚 ${entries.length} knowledge entries collected`);

      round++;
    }

    this.log.info(`✅ Brain finished. ${this.dispatcher.summary()}`);
    this.log.info(`  📚 Knowledge base: ${this.knowledge.size} entries`);

    return allResults;
  }

  /** 注入知识摘要到 Task 上下文 */
  injectKnowledge(task: Task, tags?: string[]): void {
    const entries = tags
      ? tags.flatMap(t => this.knowledge.findByTag(t))
      : this.knowledge.all();

    if (entries.length === 0) return;

    const summary = entries
      .slice(0, 10) // 最多注入 10 条
      .map(e => `### ${e.title}\n${e.content.slice(0, 500)}`)
      .join('\n\n---\n\n');

    task.context = {
      ...task.context,
      extra: {
        ...task.context?.extra,
        knowledge_context: summary,
      },
    };
  }
}
