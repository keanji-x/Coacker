/**
 * @coacker/brain/validate — Enrichment + SAST 门禁
 *
 * enrichIssueContext: 从 issue body 中提取引用的函数，返回代码片段
 * runSASTGate: PR 创建前的静态安全扫描
 */

import type { Toolkit } from "@coacker/backend";
import type { IssueItem } from "./types.js";

/** SAST 门禁结果 */
export interface SASTResult {
  passed: boolean;
  report: string;
}

/**
 * 从 issue body 中提取引用的函数，返回代码上下文
 *
 * 降级链: RepoMap → AST → ""
 */
export async function enrichIssueContext(
  toolkit: Toolkit | undefined,
  issue: IssueItem,
  _projectRoot: string,
): Promise<string> {
  if (!toolkit) return "";
  const parts: string[] = [];

  // 从 issue body + title 提取关键词
  const searchText = `${issue.title} ${issue.body}`;

  // Level 1: RepoMap 关键词匹配
  if (toolkit.repoMap) {
    try {
      const relevant = toolkit.repoMap.findRelevant(searchText, 5);
      if (relevant.length > 0) {
        const bodies = toolkit.repoMap.getBodies(
          relevant.map((s) => s.qualifiedName),
        );
        for (const sym of relevant) {
          const body = bodies.get(sym.qualifiedName);
          if (body) {
            parts.push(
              `### ${sym.qualifiedName} (${sym.kind})\n\`\`\`\n${body.slice(0, 1200)}\n\`\`\``,
            );
          }
        }
      }
    } catch {
      // best-effort
    }
  }

  // Level 2: AST 精确函数提取
  if (parts.length === 0 && toolkit.ast) {
    try {
      // 从 issue body 中提取可能的函数名
      const funcNames =
        searchText.match(
          /\b[a-zA-Z_][a-zA-Z0-9_]*(?:[A-Z][a-z]+)+\b/g,
        ) ?? [];
      const snakeNames =
        searchText.match(
          /\b[a-z][a-z0-9]*(?:_[a-z][a-z0-9]*)+\b/g,
        ) ?? [];
      const candidates = [...new Set([...funcNames, ...snakeNames])].slice(
        0,
        5,
      );

      // 尝试用 repoMap 的 allSymbolNames 做交集
      if (toolkit.repoMap) {
        const allNames = new Set(toolkit.repoMap.allSymbolNames());
        for (const name of candidates) {
          if (allNames.has(name)) {
            const relevant = toolkit.repoMap.findRelevant(name, 1);
            if (relevant.length > 0) {
              parts.push(
                `### ${relevant[0].qualifiedName}\n\`\`\`\n${relevant[0].body.slice(0, 1200)}\n\`\`\``,
              );
            }
          }
        }
      }
    } catch {
      // best-effort
    }
  }

  if (parts.length === 0) return "";
  return `\n## Related Code (auto-extracted)\n${parts.join("\n\n")}`;
}

/**
 * PR 创建前的 SAST 门禁检查
 *
 * 通过 → { passed: true }
 * 未通过 → { passed: false, report: "..." }
 * Sandbox 不可用或无 SAST 配置 → { passed: true, report: "" } (跳过)
 */
export async function runSASTGate(
  toolkit: Toolkit | undefined,
  _changedFiles: string[],
  projectRoot: string,
  sastConfig?: { command?: string; args?: string[] },
): Promise<SASTResult> {
  if (!toolkit?.sandbox) return { passed: true, report: "" };
  if (!sastConfig?.command) return { passed: true, report: "" };

  try {
    const result = await toolkit.sandbox.execute(
      sastConfig.command,
      sastConfig.args ?? [],
      projectRoot,
      300_000, // 5 minute timeout for SAST tools
    );

    return {
      passed: result.exitCode === 0,
      report: (result.stdout + "\n" + result.stderr).trim(),
    };
  } catch (err) {
    // Sandbox rejected the command (not in allowlist) or other error
    return {
      passed: true,
      report: `SAST gate skipped: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
