/**
 * @coacker/brain/audit — Enrichment 降级链
 *
 * 三级降级: MCP → RepoMap/AST → grep → ""
 * 每个 enrichment 函数都是 best-effort，失败返回空字符串。
 */

import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import type { Toolkit } from "@coacker/backend";
import type { SubTask, TaskReport } from "./types.js";

export interface EnrichmentContext {
  toolkit?: Toolkit;
  projectRoot: string;
  entryFile: string;
  knowledgeDir?: string; // 默认 {projectRoot}/.coacker/docs/
}

/**
 * Phase 1: 注入 RepoMap 项目鸟瞰图 + 领域知识
 *
 * 降级链: RepoMap → AST 扫描入口 → ""
 */
export async function enrichIntention(ctx: EnrichmentContext): Promise<string> {
  const parts: string[] = [];

  // Level 1: RepoMap 全库鸟瞰
  if (ctx.toolkit?.repoMap) {
    try {
      const mapStr = ctx.toolkit.repoMap.toPromptString();
      if (mapStr) parts.push(mapStr);
    } catch {
      // best-effort
    }
  }
  // Level 2: AST 扫描入口文件导出
  else if (ctx.toolkit?.ast) {
    try {
      const symbols = await ctx.toolkit.ast.extractSymbols(ctx.entryFile);
      if (symbols.length > 0) {
        const lines = symbols
          .slice(0, 20)
          .map((s) => `- ${s.signature} (${s.kind}, L${s.line})`);
        parts.push(
          `## Entry File Symbols (auto-extracted)\n${lines.join("\n")}`,
        );
      }
    } catch {
      // best-effort
    }
  }

  // 领域知识注入
  const knowledge = loadProjectKnowledge(ctx.projectRoot, ctx.knowledgeDir);
  if (knowledge) parts.push(knowledge);

  return parts.length > 0 ? "\n" + parts.join("\n\n") : "";
}

/**
 * Phase 2: 注入子任务相关的精准代码片段
 *
 * 降级链: MCP → RepoMap → grep → ""
 */
export async function enrichSubTask(
  ctx: EnrichmentContext,
  st: SubTask,
): Promise<string> {
  const parts: string[] = [];

  // Level 1: MCP find_references
  if (ctx.toolkit?.mcp) {
    try {
      const tools = await ctx.toolkit.mcp.listTools();
      const hasFindRefs = tools.tools?.some(
        (t: { name: string }) => t.name === "find_references",
      );
      if (hasFindRefs) {
        // 从 intention 提取可能的符号名
        const symbols = extractSymbolCandidates(st.intention);
        for (const sym of symbols.slice(0, 3)) {
          try {
            const result = await ctx.toolkit.mcp.callTool("find_references", {
              symbol: sym,
              projectRoot: ctx.projectRoot,
            });
            if (result?.content) {
              const text =
                typeof result.content === "string"
                  ? result.content
                  : JSON.stringify(result.content);
              if (text.length > 10) {
                parts.push(
                  `### MCP: References for \`${sym}\`\n\`\`\`\n${text.slice(0, 1500)}\n\`\`\``,
                );
              }
            }
          } catch {
            // individual tool call failure is ok
          }
        }
      }
    } catch {
      // MCP not available
    }
  }

  // Level 2: RepoMap 关键词匹配 + 函数体
  if (ctx.toolkit?.repoMap && parts.length === 0) {
    try {
      const relevant = ctx.toolkit.repoMap.findRelevant(st.intention, 5);
      if (relevant.length > 0) {
        const bodies = ctx.toolkit.repoMap.getBodies(
          relevant.map((s) => s.qualifiedName),
        );
        for (const sym of relevant) {
          const body = bodies.get(sym.qualifiedName);
          if (body) {
            parts.push(
              `### ${sym.qualifiedName} (${sym.kind}, refs: ${sym.bodyTokens}t)\n\`\`\`\n${body.slice(0, 1500)}\n\`\`\``,
            );
          }
        }
      }
    } catch {
      // best-effort
    }
  }

  // Level 3: grep fallback
  if (parts.length === 0) {
    const grepResult = grepFallback(ctx.projectRoot, st.intention);
    if (grepResult) {
      parts.push(
        `### Grep Results (keyword search)\n\`\`\`\n${grepResult}\n\`\`\``,
      );
    }
  }

  // 知识匹配: 如果 .coacker/docs/ 有与子任务关键词匹配的内容
  const knowledgeSnippet = matchKnowledgeForTask(
    ctx.projectRoot,
    st.intention,
    ctx.knowledgeDir,
  );
  if (knowledgeSnippet) parts.push(knowledgeSnippet);

  if (parts.length === 0) return "";
  return `\n## Toolkit Pre-Analysis\n${parts.join("\n\n")}`;
}

/**
 * Phase 2.5: 对比 RepoMap 与已审计报告，输出未覆盖区域
 */
export async function enrichGapAnalysis(
  ctx: EnrichmentContext,
  reports: ReadonlyMap<string, TaskReport>,
): Promise<string> {
  if (!ctx.toolkit?.repoMap) return "";

  try {
    // 从 reports 中提取已审计的标识符
    const auditedNames = new Set<string>();
    for (const report of reports.values()) {
      // 从 intention + implementation 文本中提取标识符
      const text = `${report.intention} ${report.implementation}`;
      const identifiers = text.match(/\b[a-zA-Z_][a-zA-Z0-9_]+\b/g) ?? [];
      for (const id of identifiers) {
        auditedNames.add(id);
      }
    }

    const uncovered = ctx.toolkit.repoMap.uncoveredSymbols(auditedNames);
    if (uncovered.length === 0) return "";

    const lines = uncovered.slice(0, 15).map((sym) => {
      return `- **${sym.qualifiedName}** (${sym.kind}, L${sym.line}) — ${sym.signature.slice(0, 100)}`;
    });

    return [
      "\n## Uncovered Symbols (auto-detected)",
      `${uncovered.length} symbols not yet audited. Top priority:`,
      ...lines,
    ].join("\n");
  } catch {
    return "";
  }
}

// ─── Helpers ──────────────────────────────────────────

/** 加载 .coacker/docs/ 领域知识 */
function loadProjectKnowledge(
  projectRoot: string,
  knowledgeDir?: string,
): string {
  const dir = knowledgeDir
    ? path.resolve(projectRoot, knowledgeDir)
    : path.join(projectRoot, ".coacker", "docs");

  if (!fs.existsSync(dir)) return "";

  let files: string[];
  try {
    files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".md") || f.endsWith(".txt"))
      .slice(0, 5);
  } catch {
    return "";
  }

  if (files.length === 0) return "";

  const parts: string[] = [];
  let totalChars = 0;
  const budget = 4000; // ~1000 tokens

  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(dir, file), "utf8");
      if (totalChars + content.length > budget) {
        parts.push(
          `### ${file}\n${content.slice(0, budget - totalChars)}\n...(truncated)`,
        );
        break;
      }
      parts.push(`### ${file}\n${content}`);
      totalChars += content.length;
    } catch {
      // skip unreadable files
    }
  }

  return parts.length > 0
    ? `\n## Project Knowledge (from .coacker/docs/)\n${parts.join("\n\n")}`
    : "";
}

/** 从子任务 intention 匹配知识库中的相关段落 */
function matchKnowledgeForTask(
  projectRoot: string,
  intention: string,
  knowledgeDir?: string,
): string {
  const dir = knowledgeDir
    ? path.resolve(projectRoot, knowledgeDir)
    : path.join(projectRoot, ".coacker", "docs");

  if (!fs.existsSync(dir)) return "";

  const keywords = intention
    .split(/[\s,;:.!?()\[\]{}"'`]+/)
    .filter((w) => w.length > 3)
    .map((w) => w.toLowerCase());

  if (keywords.length === 0) return "";

  let files: string[];
  try {
    files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".md") || f.endsWith(".txt"));
  } catch {
    return "";
  }

  const matched: string[] = [];
  let totalChars = 0;
  const budget = 2000;

  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(dir, file), "utf8");
      const contentLower = content.toLowerCase();
      const hits = keywords.filter((kw) => contentLower.includes(kw));
      if (hits.length >= 2) {
        // At least 2 keyword matches → relevant
        const snippet = content.slice(0, budget - totalChars);
        matched.push(`### ${file}\n${snippet}`);
        totalChars += snippet.length;
        if (totalChars >= budget) break;
      }
    } catch {
      // skip
    }
  }

  return matched.length > 0
    ? `\n## Relevant Project Knowledge\n${matched.join("\n\n")}`
    : "";
}

/** 从文本中提取可能的符号名 (camelCase / snake_case) */
function extractSymbolCandidates(text: string): string[] {
  const matches = text.match(/\b[a-zA-Z_][a-zA-Z0-9_]*(?:[A-Z][a-z]+)+\b/g) ?? [];
  const snakeMatches = text.match(/\b[a-z][a-z0-9]*(?:_[a-z][a-z0-9]*)+\b/g) ?? [];
  return [...new Set([...matches, ...snakeMatches])];
}

/** grep fallback: 在项目中搜索关键词 */
function grepFallback(projectRoot: string, intention: string): string {
  // Extract meaningful keywords
  const keywords = intention
    .split(/[\s,;:.!?()\[\]{}"'`]+/)
    .filter((w) => w.length > 4)
    .slice(0, 3);

  if (keywords.length === 0) return "";

  // 使用 spawnSync + 参数数组，避免 shell 拼接注入风险
  const pattern = keywords.join("|");
  const result = spawnSync(
    "grep",
    [
      "-rn",
      "--include=*.ts",
      "--include=*.rs",
      "--include=*.sol",
      "-E",
      pattern,
      ".",
    ],
    {
      cwd: projectRoot,
      encoding: "utf-8",
      timeout: 5000,
      shell: false,
    },
  );

  if (result.error || result.status === null) return "";

  const output = (result.stdout as string).trim();
  // 模拟 head -30
  return output.split("\n").slice(0, 30).join("\n");
}
