/**
 * @coacker/brain — 知识归纳器
 *
 * 将 TaskResult 中的回复文本整理为结构化的 KnowledgeEntry。
 * 当前为规则式提取，后续可接入 LLM 做深度归纳。
 */

import type { TaskResult, KnowledgeEntry } from '@coacker/shared';

let _entryCounter = 0;

/**
 * 从 TaskResult 提取知识条目
 *
 * 初版策略: 直接将回复文本作为知识内容存储，
 * 标题取回复的第一行 (去掉 Markdown 标记)。
 */
export function consolidate(result: TaskResult): KnowledgeEntry {
  const lines = result.response.split('\n').filter(l => l.trim());
  const firstLine = lines[0] ?? `Result of ${result.taskId}`;
  const title = firstLine.replace(/^#+\s*/, '').trim().slice(0, 100);

  return {
    id: `ke_${++_entryCounter}_${result.taskId}`,
    title,
    content: result.response,
    sourceTaskId: result.taskId,
    tags: [result.type, result.status],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

/**
 * 从多个 TaskResult 批量提取
 */
export function consolidateBatch(results: TaskResult[]): KnowledgeEntry[] {
  return results
    .filter(r => r.status === 'success' && r.response.length > 0)
    .map(consolidate);
}

/**
 * 合并两份知识 (更新已有条目)
 * 如果 existing 和 incoming 的 sourceTaskId 相同，保留 incoming
 */
export function mergeEntries(
  existing: KnowledgeEntry[],
  incoming: KnowledgeEntry[],
): KnowledgeEntry[] {
  const map = new Map<string, KnowledgeEntry>();
  for (const e of existing) map.set(e.sourceTaskId, e);
  for (const e of incoming) map.set(e.sourceTaskId, e);
  return Array.from(map.values());
}

/** 重置计数器 (测试用) */
export function resetConsolidator(): void {
  _entryCounter = 0;
}
