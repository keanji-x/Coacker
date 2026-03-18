/**
 * @coacker/brain/validate — 持久化器
 *
 * 将 ValidateBrain 状态、结果、对话记录持久化到文件系统。
 * 也负责从文件系统恢复状态 (断点续传)。
 */

import type { Task, TaskResult } from "@coacker/shared";
import { Logger } from "@coacker/shared";
import {
  writeFileSync,
  readFileSync,
  existsSync,
  readdirSync,
  mkdirSync,
} from "node:fs";
import { join } from "node:path";

import type { ValidationResult, ValidateBrainState } from "./types.js";

const log = new Logger("brain:validate:persist");

/** 确保输出目录结构存在 */
export function ensureOutputDirs(outputDir: string): void {
  const validateDir = join(outputDir, "validate");
  mkdirSync(validateDir, { recursive: true });
  mkdirSync(join(validateDir, "results"), { recursive: true });
  mkdirSync(join(validateDir, "conversations"), { recursive: true });
}

/** 保存 ValidateBrain 状态快照 */
export function persistState(
  outputDir: string,
  state: ValidateBrainState,
): void {
  try {
    const validateDir = join(outputDir, "validate");
    writeFileSync(
      join(validateDir, "state.json"),
      JSON.stringify(state, null, 2),
      "utf-8",
    );
  } catch (err) {
    log.warn(`Failed to persist state: ${err}`);
  }
}

/** 保存单个 Issue 的验证结果 */
export function persistResult(
  outputDir: string,
  issueNumber: number,
  result: ValidationResult,
): void {
  try {
    const validateDir = join(outputDir, "validate");
    writeFileSync(
      join(validateDir, "results", `issue_${issueNumber}.json`),
      JSON.stringify(result, null, 2),
      "utf-8",
    );
  } catch (err) {
    log.warn(`Failed to persist result for issue #${issueNumber}: ${err}`);
  }
}

/** 保存对话记录 */
export function persistConversation(
  outputDir: string,
  task: Task,
  result: TaskResult,
): void {
  try {
    const validateDir = join(outputDir, "validate");
    const convData = {
      taskId: result.taskId,
      type: result.type,
      conversationId: result.conversationId,
      status: result.status,
      elapsed: result.elapsed,
      steps: result.stepResults.map((sr) => ({
        stepId: sr.stepId,
        role: sr.role,
        ask: sr.prompt,
        answer: sr.snapshot,
        status: sr.status,
        elapsed: sr.elapsed,
      })),
    };
    const filename = `${result.conversationId ?? result.taskId}_${task.id}.json`;
    writeFileSync(
      join(validateDir, "conversations", filename),
      JSON.stringify(convData, null, 2),
      "utf-8",
    );
  } catch (err) {
    log.warn(`Failed to persist conversation ${task.id}: ${err}`);
  }
}

/** 保存最终的 Markdown 验证报告 */
export function persistMarkdownReport(
  outputDir: string,
  results: ValidationResult[],
): void {
  try {
    const validateDir = join(outputDir, "validate");
    const lines: string[] = [];
    lines.push("# Issue Validation Report\n");

    const accepted = results.filter((r) => r.outcome === "accepted");
    const rejected = results.filter(
      (r) => r.outcome === "rejected" || r.outcome === "draft",
    );
    const untestable = results.filter((r) => r.outcome === "untestable");

    lines.push("## Summary\n");
    lines.push(`- **Total Issues**: ${results.length}`);
    lines.push(`- **Accepted**: ${accepted.length}`);
    lines.push(`- **Rejected/Draft**: ${rejected.length}`);
    lines.push(`- **Untestable**: ${untestable.length}`);
    lines.push("");

    for (const r of results) {
      const icon =
        r.outcome === "accepted"
          ? "✅"
          : r.outcome === "untestable"
            ? "⏭"
            : r.outcome === "draft"
              ? "📝"
              : "❌";
      lines.push(
        `---\n\n## ${icon} Issue #${r.issueNumber}: ${r.issueTitle}\n`,
      );
      lines.push(`**Outcome**: ${r.outcome}`);
      lines.push(`**Review Attempts**: ${r.reviewAttempts}`);
      if (r.prUrl) lines.push(`**PR**: ${r.prUrl}`);
      if (r.reviewReport) {
        lines.push(`\n### Review Summary\n`);
        lines.push(r.reviewReport.summary);
      }
      lines.push("");
    }

    writeFileSync(
      join(validateDir, "validate-report.md"),
      lines.join("\n"),
      "utf-8",
    );
  } catch (err) {
    log.warn(`Failed to persist markdown report: ${err}`);
  }
}

// ─── Load (断点续传) ─────────────────────────────────

/** 从 state.json 恢复状态 */
export function loadState(outputDir: string): ValidateBrainState | null {
  const path = join(outputDir, "validate", "state.json");
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as ValidateBrainState;
  } catch (err) {
    log.warn(`Failed to load state: ${err}`);
    return null;
  }
}

/** 从 results/ 目录恢复已有验证结果 */
export function loadResults(outputDir: string): ValidationResult[] {
  const results: ValidationResult[] = [];
  const dir = join(outputDir, "validate", "results");
  if (!existsSync(dir)) return results;
  try {
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".json")) continue;
      const content = readFileSync(join(dir, file), "utf-8");
      results.push(JSON.parse(content) as ValidationResult);
    }
  } catch (err) {
    log.warn(`Failed to load results: ${err}`);
  }
  return results;
}
