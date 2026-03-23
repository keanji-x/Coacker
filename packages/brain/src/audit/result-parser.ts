/**
 * @coacker/brain/audit — 结果解析器
 *
 * 从 TaskResult 中提取结构化信息。
 * 从原 brain.ts 提取: getFirstResponse, extractReport,
 * parseIntentionTasks, parseGapResult.
 *
 * 所有方法都是纯函数，方便独立测试。
 */

import type { TaskResult } from "@coacker/shared";
import { extractJSON } from "@coacker/player";
import type { SubTask, TaskReport } from "./types.js";

/**
 * 从 TaskResult 中提取第一个成功步骤的快照
 */
export function getFirstResponse(result: TaskResult): string {
  const step = result.stepResults.find((s) => s.status === "success");
  return step?.response ?? step?.snapshot ?? "";
}

/**
 * 从 TaskResult 中提取结构化的 TaskReport
 */
export function extractReport(st: SubTask, result: TaskResult): TaskReport {
  const getContent = (stepId: string) => {
    const s = result.stepResults.find((r) => r.stepId === stepId);
    return s?.response ?? s?.snapshot ?? "";
  };

  return {
    taskId: st.id,
    intention: st.intention,
    implementation: getContent("impl"),
    codeReview: getContent("review"),
    attackReview: getContent("attack"),
    issueProposals: getContent("propose_issues"),
  };
}

/**
 * 解析 Intention AI 的回复，提取子任务列表
 *
 * 容错策略:
 *   1. extractJSON (去 markdown 包裹后 parse)
 *   2. regex 提取 JSON 数组
 *   3. fallback 为单个全量审查任务
 */
export function parseIntentionTasks(
  response: string,
  fallbackIntent: string,
): SubTask[] {
  const parsed =
    extractJSON<Array<{ id: string; intention: string }>>(response);
  if (Array.isArray(parsed) && parsed.length > 0) {
    return parsed
      .filter((p) => p.id && p.intention)
      .map((p, i) => ({
        id: p.id ?? `task_${i + 1}`,
        intention: p.intention,
        status: "pending" as const,
      }));
  }

  const match = response.match(/\[[\s\S]*\]/);
  if (match) {
    try {
      const arr = JSON.parse(match[0]) as Array<{
        id?: string;
        intention?: string;
      }>;
      if (Array.isArray(arr)) {
        return arr
          .filter((p) => p.intention)
          .map((p, i) => ({
            id: p.id ?? `task_${i + 1}`,
            intention: p.intention!,
            status: "pending" as const,
          }));
      }
    } catch {
      /* ignore */
    }
  }

  return [
    { id: "fallback", intention: fallbackIntent, status: "pending" as const },
  ];
}

/**
 * 解析 Gap Analyzer 的回复，提取新增任务
 */
export function parseGapResult(response: string): SubTask[] {
  const parsed = extractJSON<{
    completeness_score?: number;
    gaps?: Array<{ id: string; intention: string }>;
  }>(response);

  return (parsed?.gaps ?? [])
    .filter((g) => g.id && g.intention)
    .map((g) => ({
      id: g.id,
      intention: g.intention,
      status: "pending" as const,
    }));
}
