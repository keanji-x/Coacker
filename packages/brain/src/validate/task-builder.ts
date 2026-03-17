/**
 * @coacker/brain/validate — Task 构造器
 *
 * 将 ValidateBrain 的意图转换为可执行的 Task 数据结构。
 */

import type { Task } from "@coacker/shared";
import type { IssueItem, ReviewVerdict } from "./types.js";

/**
 * 构造 Issue Understanding 任务 (单步, 同一对话起点)
 *
 * Step 1: Analyst 理解 issue, 判断 testability
 */
export function buildUnderstandTask(issue: IssueItem): Task {
  return {
    id: `validate_${issue.number}`,
    intention: `Understand issue #${issue.number}: ${issue.title}`,
    type: "understand",
    steps: [
      {
        id: "understand",
        role: "issue_analyst",
        message: [
          `## Issue #${issue.number}: ${issue.title}`,
          "",
          issue.body,
          "",
          "Read the related source code, understand the issue, and output your analysis as JSON.",
        ].join("\n"),
      },
    ],
  };
}

/**
 * 构造 Test Generation 任务 (新对话, 显式携带 understanding)
 *
 * Generator 收到 issue + understanding 分析结果, 编写测试代码
 */
export function buildTestGenTask(
  issue: IssueItem,
  understandingResult: string,
): Task {
  return {
    id: `test_gen_${issue.number}`,
    intention: `Generate tests for issue #${issue.number}: ${issue.title}`,
    type: "test_gen",
    steps: [
      {
        id: "test_gen",
        role: "test_generator",
        message: [
          `## Issue #${issue.number}: ${issue.title}`,
          "",
          issue.body,
          "",
          "## Issue Analysis",
          "",
          understandingResult,
          "",
          "Based on the analysis above, write test code that validates this issue.",
          "First detect the project's test framework, then write and run the tests.",
        ].join("\n"),
      },
    ],
  };
}

/**
 * 构造 Review 任务 (新对话 — 审查者视角)
 *
 * Reviewer 收到干净输入: issue + test code + test output
 */
export function buildReviewTask(
  issue: IssueItem,
  testCode: string,
  testOutput: string,
): Task {
  const messageParts = [
    `## Issue #${issue.number}: ${issue.title}`,
    "",
    issue.body,
    "",
    "## Generated Test Code",
    "",
    "```",
    testCode,
    "```",
  ];

  if (testOutput) {
    messageParts.push(
      "",
      "## Test Execution Output",
      "",
      "```",
      testOutput,
      "```",
    );
  }

  messageParts.push(
    "",
    "Review the test code and execution output. Output your verdict as JSON.",
  );

  return {
    id: `review_${issue.number}`,
    intention: `Review test quality for issue #${issue.number}`,
    type: "test_review",
    steps: [
      {
        id: "review",
        role: "test_reviewer",
        message: messageParts.join("\n"),
      },
    ],
  };
}

/**
 * 构造 Retry 任务 (新对话 — 携带 reviewer 报告重新生成)
 *
 * 新对话, 但包含 reviewer 的反馈
 */
export function buildRetryGenTask(
  issue: IssueItem,
  reviewReport: ReviewVerdict,
  attempt: number,
): Task {
  const feedbackBlock = [
    "## Previous Review Feedback (REJECTED)",
    "",
    `**Logic Review:** ${reviewReport.logic_review}`,
    `**Audit Review:** ${reviewReport.audit_review}`,
    `**Issues:** ${reviewReport.issues.join("; ")}`,
    `**Summary:** ${reviewReport.summary}`,
  ].join("\n");

  return {
    id: `retry_${issue.number}_${attempt}`,
    intention: `Retry test generation for issue #${issue.number} (attempt ${attempt})`,
    type: "test_gen",
    steps: [
      {
        id: "understand",
        role: "issue_analyst",
        message: [
          `## Issue #${issue.number}: ${issue.title}`,
          "",
          issue.body,
          "",
          feedbackBlock,
          "",
          "Re-analyze the issue with the reviewer's feedback in mind.",
        ].join("\n"),
      },
      {
        id: "test_gen",
        role: "test_generator",
        message: [
          "Based on your updated understanding and the reviewer's feedback,",
          "write improved test code that addresses the issues raised.",
          "",
          feedbackBlock,
          "",
          "First detect the project's test framework, then write and run the tests.",
        ].join("\n"),
      },
    ],
  };
}

/**
 * 构造 PR Create 任务
 */
export function buildPrCreateTask(issue: IssueItem, origin: string): Task {
  return {
    id: `pr_create_${issue.number}`,
    intention: `Create test PR for issue #${issue.number}`,
    type: "custom",
    steps: [
      {
        id: "create_pr",
        role: "pr_creator",
        message: [
          `Create a pull request with the test code you generated for issue #${issue.number}.`,
          "",
          `Repository: ${origin}`,
          `Branch name: test/validate-issue-${issue.number}`,
          `PR title: test: add validation test for #${issue.number}`,
          "",
          "Steps:",
          "1. Create a new branch from main",
          "2. Add the test files",
          "3. Commit and push",
          "4. Create the PR using: gh pr create --title '...' --body '...'",
        ].join("\n"),
      },
    ],
  };
}
