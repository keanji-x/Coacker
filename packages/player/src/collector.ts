/**
 * @coacker/player — 结果收集器
 *
 * 从 Backend 返回的 ChatResult 中提取结构化信息。
 */

import type { ChatResult } from '@coacker/backend';
import type { StepResult } from '@coacker/shared';

/**
 * 将 Backend ChatResult 转换为 StepResult
 */
export function collectStepResult(stepId: string, role: string, chatResult: ChatResult): StepResult {
  const status = chatResult.state === 'done' ? 'success'
    : chatResult.state === 'timeout' ? 'error'
    : 'error';

  return {
    stepId,
    role,
    response: chatResult.response,
    status,
    elapsed: chatResult.elapsed,
    steps: chatResult.steps,
    approvals: chatResult.approvals,
  };
}

/**
 * 从回复文本中尝试提取 JSON (容忍 markdown 包裹)
 */
export function extractJSON<T = unknown>(text: string): T | null {
  // 去掉 markdown 代码块
  const cleaned = text
    .replace(/```json\s*/g, '')
    .replace(/```\s*/g, '')
    .trim();

  // 尝试直接解析
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    // 尝试提取第一个 JSON 对象或数组
    const match = cleaned.match(/[[\{][\s\S]*[\]\}]/);
    if (match) {
      try {
        return JSON.parse(match[0]) as T;
      } catch {
        return null;
      }
    }
    return null;
  }
}

/**
 * 截断文本
 */
export function truncate(text: string, limit: number = 500): string {
  if (text.length <= limit) return text;
  return text.slice(0, limit) + `... [${text.length - limit} chars truncated]`;
}
