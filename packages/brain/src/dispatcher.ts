/**
 * @coacker/brain — 任务派发器
 *
 * 管理任务的创建、依赖关系、状态流转。
 * 支持 DAG 拓扑排序，按层级派发给 Player。
 */

import type { Task, TaskStatus, TaskType, TaskContext } from '@coacker/shared';

let _idCounter = 0;

/** 生成唯一任务 ID */
function genId(prefix: string): string {
  return `${prefix}_${++_idCounter}`;
}

export class Dispatcher {
  private tasks: Map<string, Task> = new Map();

  /** 创建新任务 */
  createTask(
    type: TaskType,
    intention: string,
    options: {
      dependsOn?: string[];
      context?: TaskContext;
      id?: string;
    } = {},
  ): Task {
    const task: Task = {
      id: options.id ?? genId(type),
      intention,
      type,
      status: 'pending',
      dependsOn: options.dependsOn ?? [],
      createdAt: Date.now(),
      context: options.context,
    };
    this.tasks.set(task.id, task);
    return task;
  }

  /** 批量创建任务 (从 intention 分析结果) */
  createBatch(
    items: Array<{ id: string; intention: string; type?: TaskType }>,
    context?: TaskContext,
    dependsOn?: string[],
  ): Task[] {
    return items.map(item =>
      this.createTask(item.type ?? 'implement', item.intention, {
        id: item.id,
        context,
        dependsOn,
      })
    );
  }

  /** 更新任务状态 */
  updateStatus(taskId: string, status: TaskStatus): void {
    const task = this.tasks.get(taskId);
    if (task) task.status = status;
  }

  /** 获取任务 */
  getTask(id: string): Task | undefined {
    return this.tasks.get(id);
  }

  /** 获取所有任务 */
  allTasks(): Task[] {
    return Array.from(this.tasks.values());
  }

  /**
   * 拓扑排序 — 返回分层列表
   * 每层内的任务可以并行执行
   */
  topoSort(): Task[][] {
    const inDegree = new Map<string, number>();
    const reverseDeps = new Map<string, string[]>();

    for (const task of this.tasks.values()) {
      if (!inDegree.has(task.id)) inDegree.set(task.id, 0);

      for (const dep of task.dependsOn) {
        if (this.tasks.has(dep)) {
          inDegree.set(task.id, (inDegree.get(task.id) ?? 0) + 1);
          if (!reverseDeps.has(dep)) reverseDeps.set(dep, []);
          reverseDeps.get(dep)!.push(task.id);
        }
      }
    }

    const layers: Task[][] = [];
    let currentIds = [...inDegree.entries()]
      .filter(([, deg]) => deg === 0)
      .map(([id]) => id);

    while (currentIds.length > 0) {
      const layer = currentIds.map(id => this.tasks.get(id)!);
      layers.push(layer);

      const nextIds: string[] = [];
      for (const id of currentIds) {
        for (const dependent of reverseDeps.get(id) ?? []) {
          const newDeg = (inDegree.get(dependent) ?? 1) - 1;
          inDegree.set(dependent, newDeg);
          if (newDeg === 0) nextIds.push(dependent);
        }
      }
      currentIds = nextIds;
    }

    return layers;
  }

  /**
   * 获取下一批可执行的任务 (所有依赖已完成)
   */
  getReady(): Task[] {
    return Array.from(this.tasks.values()).filter(task => {
      if (task.status !== 'pending') return false;
      return task.dependsOn.every(depId => {
        const dep = this.tasks.get(depId);
        return dep?.status === 'done';
      });
    });
  }

  /** 待执行任务数 */
  get pendingCount(): number {
    return Array.from(this.tasks.values()).filter(t => t.status === 'pending').length;
  }

  /** 已完成任务数 */
  get doneCount(): number {
    return Array.from(this.tasks.values()).filter(t => t.status === 'done').length;
  }

  /** 执行摘要 */
  summary(): string {
    const all = this.allTasks();
    const done = all.filter(t => t.status === 'done').length;
    const err = all.filter(t => t.status === 'error').length;
    const pending = all.filter(t => t.status === 'pending').length;
    const running = all.filter(t => t.status === 'running').length;
    return `Tasks: ${done} done, ${running} running, ${pending} pending, ${err} errors (total: ${all.length})`;
  }

  /** 重置 (测试用) */
  reset(): void {
    this.tasks.clear();
    _idCounter = 0;
  }
}
