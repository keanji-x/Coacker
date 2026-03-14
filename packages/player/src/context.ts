/**
 * @coacker/player — 上下文工程
 *
 * 将 Brain 派发的 Task 转换为 Backend 能理解的 prompt。
 * 负责注入 skills、上游结果、知识片段等上下文。
 */

import type { Task, TaskContext } from '@coacker/shared';

/**
 * 从 Task 构建完整的 prompt，注入所有上下文
 */
export function buildPrompt(task: Task): string {
  const ctx = task.context ?? {};
  const parts: string[] = [];

  // 基础意图
  parts.push(`## Task: ${task.id}`);
  parts.push(`**Intention:** ${task.intention}`);
  parts.push('');

  // 入口文件
  if (ctx.entryFile) {
    parts.push(`**Entry File:** ${ctx.entryFile}`);
  }

  // 用户意图
  if (ctx.userIntent) {
    parts.push(`**User Intent:** ${ctx.userIntent}`);
  }

  // 项目根目录
  if (ctx.projectRoot) {
    parts.push(`**Project Root:** ${ctx.projectRoot}`);
  }

  // Skills 注入
  if (ctx.skills && ctx.skills.length > 0) {
    parts.push('');
    parts.push('## Skills');
    for (const skill of ctx.skills) {
      parts.push(`- ${skill}`);
    }
  }

  // 上游结果注入
  if (ctx.upstreamResults) {
    for (const [key, value] of Object.entries(ctx.upstreamResults)) {
      parts.push('');
      parts.push(`## Upstream: ${key}`);
      parts.push(value);
    }
  }

  // 额外信息
  if (ctx.extra) {
    for (const [key, value] of Object.entries(ctx.extra)) {
      parts.push('');
      parts.push(`**${key}:** ${String(value)}`);
    }
  }

  return parts.join('\n');
}

/**
 * 合并多份上下文 (用于注入上游结果)
 */
export function mergeContexts(base: TaskContext, ...overlays: Partial<TaskContext>[]): TaskContext {
  const merged = { ...base };

  for (const overlay of overlays) {
    if (overlay.entryFile) merged.entryFile = overlay.entryFile;
    if (overlay.userIntent) merged.userIntent = overlay.userIntent;
    if (overlay.projectRoot) merged.projectRoot = overlay.projectRoot;
    if (overlay.skills) merged.skills = [...(merged.skills ?? []), ...overlay.skills];
    if (overlay.upstreamResults) {
      merged.upstreamResults = { ...merged.upstreamResults, ...overlay.upstreamResults };
    }
    if (overlay.extra) {
      merged.extra = { ...merged.extra, ...overlay.extra };
    }
  }

  return merged;
}
