/**
 * @coacker/brain/audit — 报告生成器
 *
 * 从 TaskReport 列表生成最终 AuditReport 对象。
 * 从原 brain.ts 提取: buildReport.
 */

import type { TaskReport, AuditReport } from "./types.js";

/**
 * 构建最终的审查报告
 *
 * @param taskReports - 所有子任务的详细报告
 * @param summary - 概要文本 (默认自动生成)
 * @param executiveSummary - AI 汇总的执行摘要
 */
export function buildReport(
  taskReports: TaskReport[],
  summary?: string,
  executiveSummary?: string,
): AuditReport {
  const autoSummary = summary ?? `${taskReports.length} sub-tasks analyzed.`;
  const execSummary = executiveSummary ?? "";

  return {
    tasks: taskReports,
    summary: autoSummary,
    executiveSummary: execSummary,
    toMarkdown() {
      const lines: string[] = [];
      lines.push("# Code Review Report\n");

      if (execSummary) {
        lines.push(execSummary);
        lines.push("");
      }

      lines.push("## Overview\n");
      lines.push(`- **Tasks analyzed**: ${taskReports.length}`);
      lines.push("");

      for (const task of taskReports) {
        lines.push(
          `---\n\n## [${task.taskId}] ${task.intention.slice(0, 80)}\n`,
        );
        lines.push("### 🎯 Intention\n");
        lines.push(task.intention);
        lines.push("");
        lines.push("### 🔍 Discovered Implementation\n");
        lines.push(task.implementation || "_No implementation found._");
        lines.push("");
        lines.push("### 🛠️ Ground Review\n");
        lines.push(task.codeReview || "_No review generated._");
        lines.push("");
        lines.push("### ⚔️ Intention Attacker\n");
        lines.push(task.attackReview || "_No attack generated._");
        lines.push("");
      }

      return lines.join("\n");
    },
  };
}
