/**
 * @coacker/brain/audit — 本地任务构造器
 *
 * 替代 Phase 1 AI 探索，通过扫描本地目录直接生成 SubTask。
 */

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { SubTask } from "./types.js";

/**
 * 根据 auditPaths 扫描文件并构建子任务
 */
export function buildLocalTasks(
  projectRoot: string,
  auditPaths: string[],
  userIntent: string,
): SubTask[] {
  return auditPaths.map((auditPath) => {
    const fullPath = join(projectRoot, auditPath);
    
    let fileSummaries: string[] = [];
    let totalFiles = 0;

    if (existsSync(fullPath)) {
      const files = getSourceFiles(fullPath);
      totalFiles = files.length;
      
      fileSummaries = files.slice(0, 30).map(f => {
        const lineCount = countLines(join(fullPath, f));
        return `${f} (${lineCount} lines)`;
      });
    }

    const intention = [
      `## Task: Review ${auditPath}`,
      `**Context:** ${userIntent}`,
      "",
      `Review the source code in \`${auditPath}\`.`,
      "",
      "### Files and Line Counts:",
      ...fileSummaries.map(s => `- ${s}`),
      totalFiles > 30 ? `\n... and ${totalFiles - 30} more files.` : ""
    ].join("\n");

    return {
      id: auditPath.replace(/\/$/, "").replace(/\//g, "_"),
      intention,
      status: "pending" as const,
    };
  });
}

/** 递归扫描源文件 */
function getSourceFiles(dir: string, relativeDir: string = ""): string[] {
  let results: string[] = [];
  try {
    const list = readdirSync(dir);
    for (const file of list) {
      const fullPath = join(dir, file);
      const relPath = join(relativeDir, file);
      const stat = statSync(fullPath);
      
      if (stat.isDirectory()) {
        if (["target", "node_modules", ".git", "dist", "build"].includes(file)) continue;
        results = results.concat(getSourceFiles(fullPath, relPath));
      } else {
        if (isSourceFile(file)) {
          results.push(relPath);
        }
      }
    }
  } catch (err) {
    // 忽略无法读取的目录
  }
  return results;
}

/** 是否是需要审计的源文件 */
function isSourceFile(filename: string): boolean {
  const ext = filename.split(".").pop()?.toLowerCase();
  return ["rs", "ts", "js", "sol", "toml", "go", "py", "c", "cpp", "h", "proto"].includes(ext || "");
}

/** 计算行数 */
function countLines(filePath: string): number {
  try {
    const content = readFileSync(filePath, "utf-8");
    return content.split("\n").length;
  } catch {
    return 0;
  }
}
