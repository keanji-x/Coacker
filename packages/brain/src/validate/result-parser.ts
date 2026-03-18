/**
 * @coacker/brain/validate — 结果解析器
 *
 * 从 TaskResult 中提取验证相关的结构化信息。
 * 所有方法都是纯函数。
 */

import type { TaskResult } from "@coacker/shared";
import { extractJSON } from "@coacker/player";
import type { UnderstandingResult, ReviewVerdict } from "./types.js";

/**
 * 从 TaskResult 中提取指定步骤的快照
 */
export function getStepSnapshot(result: TaskResult, stepId: string): string {
  const step = result.stepResults.find((s) => s.stepId === stepId);
  return step?.snapshot ?? "";
}

/**
 * 解析 Issue Analyst 的理解输出
 *
 * 容错: 如果解析失败, 返回 testable=true 让流程继续
 */
export function parseUnderstanding(response: string): UnderstandingResult {
  const parsed = extractJSON<UnderstandingResult>(response);
  if (parsed && typeof parsed.testable === "boolean") {
    return {
      summary: parsed.summary ?? "",
      scope: parsed.scope ?? "",
      expected_vs_actual: parsed.expected_vs_actual ?? "",
      test_targets: parsed.test_targets ?? [],
      testable: parsed.testable,
      untestable_reason: parsed.untestable_reason,
    };
  }

  // Fallback: 无法解析时假设可测试, 让 test_gen 阶段自行判断
  return {
    summary: response.slice(0, 500),
    scope: "",
    expected_vs_actual: "",
    test_targets: [],
    testable: true,
  };
}

/**
 * 解析 Test Generator 的输出, 检测是否标记为 untestable
 *
 * 如果 AI 输出 {"untestable": true, "reason": "..."}, 返回 untestable
 */
export function parseTestGenResult(response: string): {
  untestable: boolean;
  reason?: string;
  testCode: string;
  testOutput: string;
} {
  // 检查是否有 untestable 标记
  const parsed = extractJSON<{ untestable?: boolean; reason?: string }>(
    response,
  );
  if (parsed?.untestable) {
    return {
      untestable: true,
      reason: parsed.reason ?? "AI determined issue is not testable",
      testCode: "",
      testOutput: "",
    };
  }

  // 正常情况: 整个 snapshot 就是测试相关的上下文
  return {
    untestable: false,
    testCode: response,
    testOutput: response,
  };
}

/**
 * 解析 Test Reviewer 的裁决输出
 *
 * 容错: 无法解析时默认 REJECT
 */
export function parseReviewVerdict(response: string): ReviewVerdict {
  const parsed = extractJSON<ReviewVerdict>(response);
  if (parsed && (parsed.verdict === "ACCEPT" || parsed.verdict === "REJECT")) {
    return {
      verdict: parsed.verdict,
      logic_review: parsed.logic_review ?? "",
      audit_review: parsed.audit_review ?? "",
      verification: parsed.verification ?? "",
      issues: parsed.issues ?? [],
      summary: parsed.summary ?? "",
    };
  }

  // Fallback: 无法解析时 REJECT (保守策略)
  return {
    verdict: "REJECT",
    logic_review: "",
    audit_review: "",
    verification: "",
    issues: ["Failed to parse reviewer output"],
    summary: `Could not parse verdict from response (${response.length} chars)`,
  };
}
