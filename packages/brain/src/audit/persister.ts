/**
 * @coacker/brain/audit — 持久化器
 *
 * 负责将 Brain 状态、报告、对话记录持久化到文件系统。
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

import type {
  SubTask,
  TaskReport,
  AuditReport,
  AuditPhase,
  AuditBrainState,
} from "./types.js";

const log = new Logger("brain:persist");

/** 确保输出目录结构存在 */
export function ensureOutputDirs(outputDir: string): void {
  mkdirSync(outputDir, { recursive: true });
  mkdirSync(join(outputDir, "reports"), { recursive: true });
  mkdirSync(join(outputDir, "conversations"), { recursive: true });
}

/** 保存 Brain 状态快照 + 完整历史 */
export function persistState(
  outputDir: string,
  phase: AuditPhase,
  gapRound: number,
  subtasks: SubTask[],
  reports: ReadonlyMap<string, TaskReport>,
  history: readonly TaskResult[],
): void {
  try {
    const state: AuditBrainState = {
      phase,
      gapRound,
      subtasks,
      reportIds: Array.from(reports.keys()),
      historyCount: history.length,
      updatedAt: new Date().toISOString(),
    };
    writeFileSync(
      join(outputDir, "state.json"),
      JSON.stringify(state, null, 2),
      "utf-8",
    );

    writeFileSync(
      join(outputDir, "history.json"),
      JSON.stringify(history, null, 2),
      "utf-8",
    );
  } catch (err) {
    log.warn(`Failed to persist state: ${err}`);
  }
}

/** 保存 Intention 分析结果 (子任务列表) */
export function persistIntention(outputDir: string, subtasks: SubTask[]): void {
  try {
    writeFileSync(
      join(outputDir, "intention.json"),
      JSON.stringify(subtasks, null, 2),
      "utf-8",
    );
  } catch (err) {
    log.warn(`Failed to persist intention: ${err}`);
  }
}

/** 保存单个子任务的详细报告 */
export function persistReport(
  outputDir: string,
  taskId: string,
  report: TaskReport,
): void {
  try {
    writeFileSync(
      join(outputDir, "reports", `${taskId}.json`),
      JSON.stringify(report, null, 2),
      "utf-8",
    );
  } catch (err) {
    log.warn(`Failed to persist report ${taskId}: ${err}`);
  }
}

/** 保存单个对话的完整 ask/answer 记录 */
export function persistConversation(
  outputDir: string,
  task: Task,
  result: TaskResult,
): void {
  try {
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
      join(outputDir, "conversations", filename),
      JSON.stringify(convData, null, 2),
      "utf-8",
    );
  } catch (err) {
    log.warn(`Failed to persist conversation ${task.id}: ${err}`);
  }
}

/** 保存最终的 Markdown 报告 */
export function persistMarkdownReport(
  outputDir: string,
  report: AuditReport,
): void {
  try {
    writeFileSync(
      join(outputDir, "audit-report.md"),
      report.toMarkdown(),
      "utf-8",
    );
  } catch (err) {
    log.warn(`Failed to persist markdown report: ${err}`);
  }
}

// ─── Load (断点续传) ─────────────────────────────────

/** 从 state.json 恢复状态 (无文件则返回 null) */
export function loadState(outputDir: string): AuditBrainState | null {
  const path = join(outputDir, "state.json");
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as AuditBrainState;
  } catch (err) {
    log.warn(`Failed to load state: ${err}`);
    return null;
  }
}

/** 从 intention.json 恢复子任务列表 (无文件则返回 null) */
export function loadIntention(outputDir: string): SubTask[] | null {
  const path = join(outputDir, "intention.json");
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as SubTask[];
  } catch (err) {
    log.warn(`Failed to load intention: ${err}`);
    return null;
  }
}

/** 从 reports/ 目录恢复已有报告 */
export function loadReports(outputDir: string): Map<string, TaskReport> {
  const reports = new Map<string, TaskReport>();
  const dir = join(outputDir, "reports");
  if (!existsSync(dir)) return reports;
  try {
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".json")) continue;
      const content = readFileSync(join(dir, file), "utf-8");
      const report = JSON.parse(content) as TaskReport;
      reports.set(report.taskId, report);
    }
  } catch (err) {
    log.warn(`Failed to load reports: ${err}`);
  }
  return reports;
}
