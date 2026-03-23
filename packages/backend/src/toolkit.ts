/**
 * @coacker/backend — Toolkit 辅助工具层
 *
 * Toolkit 是可选的辅助工具集合，Brain 用它在派发 Task 前预处理上下文。
 * 与 Backend 接口无关 — Backend 负责对话，Toolkit 负责预分析。
 */

import { createRequire } from "node:module";
import { McpClient } from "./mcp-client.js";
import { AstAnalyzer } from "./ast-analyzer.js";
import type { LangId } from "./ast-analyzer.js";
import { Sandbox } from "./sandbox.js";
import { RepoMap } from "./repo-map.js";
import type { RepoMapConfig } from "./repo-map.js";

/** 辅助工具集合 (所有字段可选) */
export interface Toolkit {
  mcp?: McpClient;
  ast?: AstAnalyzer;
  sandbox?: Sandbox;
  repoMap?: RepoMap;
}

/** AST 配置: 单语言 (向后兼容) 或多语言 */
export type AstConfig =
  | { languagePath: string }
  | { languages: Array<{ lang: LangId; wasmPath?: string }> };

/** Toolkit 配置 (对应 config.toml [backend.toolkit.*]) */
export interface ToolkitConfig {
  mcp?: { command: string; args: string[]; env?: Record<string, string> };
  ast?: AstConfig;
  sandbox?: { baseDir?: string; allowedCommands?: string[] };
  repoMap?: RepoMapConfig;
}

/**
 * 根据配置创建 Toolkit 实例
 *
 * 只初始化配置中存在的工具，未配置的字段为 undefined。
 * 当 AST 可用时，自动构建 RepoMap（除非未提供 projectRoot）。
 */
export async function createToolkit(
  config: ToolkitConfig,
  projectRoot?: string,
): Promise<Toolkit> {
  const toolkit: Toolkit = {};

  if (config.ast) {
    toolkit.ast = new AstAnalyzer();

    if ("languagePath" in config.ast) {
      // 单语言 (向后兼容)
      await toolkit.ast.init(config.ast.languagePath);
    } else {
      // 多语言
      const entries: Array<[LangId, string]> = [];
      for (const { lang, wasmPath } of config.ast.languages) {
        const resolved = wasmPath ?? resolveBuiltinWasm(lang);
        if (resolved) entries.push([lang, resolved]);
      }
      if (entries.length > 0) {
        await toolkit.ast.initMulti(entries);
      }
    }
  }

  if (config.mcp) {
    toolkit.mcp = new McpClient();
    await toolkit.mcp.connect(config.mcp.command, config.mcp.args, config.mcp.env);
  }

  if (config.sandbox) {
    toolkit.sandbox = new Sandbox(
      config.sandbox.baseDir,
      config.sandbox.allowedCommands,
    );
  }

  // AST 初始化后，构建 RepoMap (需要 projectRoot)
  if (toolkit.ast && projectRoot) {
    toolkit.repoMap = new RepoMap(toolkit.ast, projectRoot, config.repoMap);
    await toolkit.repoMap.build();
  }

  return toolkit;
}

/**
 * 从 tree-sitter-wasms 包解析内置 .wasm 路径
 * 如果包不可用则返回 undefined
 */
function resolveBuiltinWasm(lang: LangId): string | undefined {
  const wasmName: Record<LangId, string> = {
    typescript: "tree-sitter-typescript.wasm",
    solidity: "tree-sitter-solidity.wasm",
    rust: "tree-sitter-rust.wasm",
  };

  try {
    const require = createRequire(import.meta.url);
    const pkgDir = require.resolve("tree-sitter-wasms/package.json");
    const outDir = pkgDir.replace(/package\.json$/, "out");
    return `${outDir}/${wasmName[lang]}`;
  } catch {
    return undefined;
  }
}
