/**
 * @coacker/brain/audit — Task 构造器
 *
 * 负责将 Brain 的意图转换为可执行的 Task 数据结构。
 * 从原 brain.ts 提取: buildIntentionTask, buildSubTask, buildGapTask,
 * buildConsolidationTask, buildContextSnippet.
 */

import type { Task } from "@coacker/shared";
import type { SubTask, TaskReport } from "./types.js";

// ─── Public API ──────────────────────────────────────

/** 构造 Intention 分析任务 */
export function buildIntentionTask(
  entryFile: string,
  userIntent: string,
  enrichment?: string,
): Task {
  return {
    id: "intention",
    intention: "Explore the project and break down the review into sub-tasks",
    type: "intention",
    steps: [
      {
        id: "explore",
        role: "intention",
        message: [
          `## Task: Intention Analysis`,
          `**Entry File:** ${entryFile}`,
          `**User Intent:** ${userIntent}`,
          enrichment || "",
          "",
          `Explore the project starting from the entry file and break the review into sub-tasks.`,
        ]
          .filter(Boolean)
          .join("\n"),
      },
    ],
  };
}

/** 构造子任务 (implement → review → attack → [propose_issues]) */
export function buildSubTask(
  st: SubTask,
  entryFile: string,
  userIntent: string,
  origin: string,
  reports: ReadonlyMap<string, TaskReport>,
  enrichment?: string,
): Task {
  const contextSnippet = buildContextSnippet(reports);

  const steps = [
    {
      id: "impl",
      role: "implementer",
      message: [
        `## Task: ${st.id}`,
        `**Intention:** ${st.intention}`,
        `**Entry File:** ${entryFile}`,
        `**User Intent:** ${userIntent}`,
        contextSnippet ? `\n## Prior Knowledge\n${contextSnippet}` : "",
        enrichment || "",
      ]
        .filter(Boolean)
        .join("\n"),
    },
    {
      id: "review",
      role: "reviewer",
      message: "Review the implementation above.",
    },
    {
      id: "attack",
      role: "attacker",
      message: "Attack the implementation above.",
    },
  ];

  // 如果配置了 origin，添加 issue proposer 步骤
  if (origin) {
    steps.push({
      id: "propose_issues",
      role: "issue_proposer",
      message: `Create GitHub issues for the findings above.`,
    });
  }

  return {
    id: `subtask_${st.id}`,
    intention: st.intention,
    type: "implement",
    steps,
  };
}

/** 构造 Gap Analysis 任务 */
export function buildGapTask(
  gapRound: number,
  entryFile: string,
  userIntent: string,
  reports: ReadonlyMap<string, TaskReport>,
  enrichment?: string,
): Task {
  const summaries = Array.from(reports.values())
    .map((r) =>
      [
        `## Task: ${r.taskId}`,
        `**Intention:** ${r.intention}`,
        `**Implementation (first 1000 chars):**`,
        r.implementation.slice(0, 1000),
      ].join("\n"),
    )
    .join("\n\n---\n\n");

  return {
    id: `gap_round_${gapRound + 1}`,
    intention: "Find gaps in existing review coverage",
    type: "gap_analysis",
    steps: [
      {
        id: "gap",
        role: "gap_analyzer",
        message: [
          `Entry File: ${entryFile}`,
          `User Intent: ${userIntent}`,
          enrichment || "",
          "",
          "## Existing Implementation Reports",
          "",
          summaries,
        ]
          .filter(Boolean)
          .join("\n"),
      },
    ],
  };
}

/** 构造 Consolidation 汇总任务 */
export function buildConsolidationTask(
  userIntent: string,
  reports: ReadonlyMap<string, TaskReport>,
): Task {
  const taskSummaries = Array.from(reports.values())
    .map((r) =>
      [
        `### Task: ${r.taskId}`,
        `**Intention:** ${r.intention}`,
        "",
        "**Implementation Findings (first 500 chars):**",
        r.implementation.slice(0, 500),
        "",
        "**Code Review:**",
        r.codeReview.slice(0, 500) || "_No review._",
        "",
        "**Attack Findings:**",
        r.attackReview.slice(0, 500) || "_No attack._",
      ].join("\n"),
    )
    .join("\n\n---\n\n");

  return {
    id: "consolidation",
    intention: "Synthesize all review findings into an executive summary",
    type: "consolidation",
    steps: [
      {
        id: "synthesize",
        role: "consolidator",
        message: [
          `## Audit Consolidation`,
          `**User Intent:** ${userIntent}`,
          `**Tasks Reviewed:** ${reports.size}`,
          "",
          "## All Review Findings",
          "",
          taskSummaries,
        ].join("\n"),
      },
    ],
  };
}

// ─── Private Helpers ─────────────────────────────────

/** 构建已分析任务的上下文摘要 */
function buildContextSnippet(reports: ReadonlyMap<string, TaskReport>): string {
  if (reports.size === 0) return "";

  const summaries = Array.from(reports.values())
    .slice(-5)
    .map((r) => `- **${r.taskId}**: ${r.intention.slice(0, 100)}`)
    .join("\n");

  return `Previously analyzed:\n${summaries}`;
}
