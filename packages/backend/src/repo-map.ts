/**
 * @coacker/backend — RepoMap: 全库符号图谱
 *
 * 扫描项目文件，构建符号定义 + 引用关系图，
 * 按重要性排序输出 Token 裁剪后的 prompt 字符串。
 */

import fs from "fs";
import path from "path";
import type { AstAnalyzer, SymbolDef } from "./ast-analyzer.js";

export interface RepoMapConfig {
  tokenBudget?: number; // 默认 1024 tokens ≈ 4096 chars
  fileGlobs?: string[]; // 默认 ["**/*.ts"]
  excludeDirs?: string[]; // 默认 ["node_modules", "dist", ".git", "output"]
}

export interface RepoMapData {
  symbols: Map<string, SymbolDef>; // qualifiedName → SymbolDef
  inDegree: Map<string, number>; // qualifiedName → 被引用次数
  filesScanned: number;
  scannedAt: number;
}

/** 停用词：在关键词匹配时忽略 */
const STOP_WORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been",
  "being", "have", "has", "had", "do", "does", "did", "will",
  "would", "could", "should", "may", "might", "shall", "can",
  "and", "or", "but", "if", "then", "else", "when", "where",
  "how", "what", "which", "who", "whom", "this", "that", "these",
  "those", "it", "its", "of", "in", "on", "at", "to", "for",
  "with", "from", "by", "as", "into", "through", "about", "not",
  "no", "all", "each", "every", "both", "few", "more", "most",
  "other", "some", "such", "only", "own", "same", "so", "than",
  "too", "very", "just",
]);

export class RepoMap {
  private data: RepoMapData | null = null;
  private readonly tokenBudget: number;
  private readonly fileGlobs: string[];
  private readonly excludeDirs: Set<string>;

  constructor(
    private analyzer: AstAnalyzer,
    private projectRoot: string,
    config: RepoMapConfig = {},
  ) {
    this.tokenBudget = config.tokenBudget ?? 1024;
    this.fileGlobs = config.fileGlobs ?? ["**/*.ts", "**/*.sol"];
    this.excludeDirs = new Set(
      config.excludeDirs ?? [
        "node_modules", "dist", ".git", "output", "__pycache__", "coverage",
        "lib", "forge-std", "openzeppelin-contracts", // Foundry dependencies
      ],
    );
  }

  /** 扫描全库，构建符号图谱。Brain 启动时调用一次。 */
  async build(): Promise<RepoMapData> {
    const files = this.collectFiles(this.projectRoot);

    const allSymbols = new Map<string, SymbolDef>();
    const nameToQualified = new Map<string, string[]>(); // name → qualifiedNames[]

    // Phase 1: 收集所有符号 (仅处理 parser 能解析的文件)
    const parseable = files.filter((f) => this.analyzer.canParse(f));
    for (const file of parseable) {
      try {
        const relPath = path.relative(this.projectRoot, file);
        const symbols = await this.analyzer.extractSymbols(file);
        for (const sym of symbols) {
          // 用相对路径重写
          sym.filePath = relPath;
          sym.qualifiedName = `${relPath}::${sym.name}`;
          allSymbols.set(sym.qualifiedName, sym);

          const existing = nameToQualified.get(sym.name) ?? [];
          existing.push(sym.qualifiedName);
          nameToQualified.set(sym.name, existing);
        }
      } catch {
        // 跳过解析失败的文件
      }
    }

    // Phase 2: 构建引用边 + inDegree
    const knownNames = new Set(nameToQualified.keys());
    const inDegree = new Map<string, number>();
    for (const qn of allSymbols.keys()) {
      inDegree.set(qn, 0);
    }

    for (const file of parseable) {
      try {
        const relPath = path.relative(this.projectRoot, file);
        const refs = await this.analyzer.extractReferences(file, knownNames);
        for (const ref of refs) {
          // 把引用映射到具体 qualifiedName
          const candidates = nameToQualified.get(ref.toSymbol) ?? [];
          for (const qn of candidates) {
            // 不计算自引用 (同文件同名)
            if (!qn.startsWith(relPath + "::")) {
              inDegree.set(qn, (inDegree.get(qn) ?? 0) + 1);
            }
          }
        }
      } catch {
        // 跳过
      }
    }

    this.data = {
      symbols: allSymbols,
      inDegree,
      filesScanned: parseable.length,
      scannedAt: Date.now(),
    };

    return this.data;
  }

  /** 生成 Token 裁剪后的 RepoMap 字符串 (按重要性排序，签名 only) */
  toPromptString(budget?: number): string {
    if (!this.data) return "";

    const maxChars = (budget ?? this.tokenBudget) * 4;
    const sorted = this.sortedSymbols();

    // 按文件分组
    const byFile = new Map<string, Array<{ sym: SymbolDef; refs: number }>>();
    for (const sym of sorted) {
      const refs = this.data.inDegree.get(sym.qualifiedName) ?? 0;
      const arr = byFile.get(sym.filePath) ?? [];
      arr.push({ sym, refs });
      byFile.set(sym.filePath, arr);
    }

    const lines: string[] = ["## Project Map (auto-generated)"];
    let totalChars = lines[0].length;

    // 按首个符号的重要性排序文件
    const fileOrder = [...byFile.entries()].sort((a, b) => {
      const maxA = Math.max(...a[1].map((e) => e.refs));
      const maxB = Math.max(...b[1].map((e) => e.refs));
      return maxB - maxA;
    });

    for (const [filePath, entries] of fileOrder) {
      const header = `### ${filePath}`;
      if (totalChars + header.length + 1 > maxChars) break;
      lines.push(header);
      totalChars += header.length + 1;

      for (const { sym, refs } of entries) {
        const sigLine = `- ${sym.signature}  [refs: ${refs}]`;
        if (totalChars + sigLine.length + 1 > maxChars) break;
        lines.push(sigLine);
        totalChars += sigLine.length + 1;
      }
    }

    return lines.join("\n");
  }

  /** 关键词匹配：从 query 文本中找最相关的 topK 个符号 */
  findRelevant(query: string, topK = 5): SymbolDef[] {
    if (!this.data) return [];

    const keywords = extractKeywords(query);
    if (keywords.length === 0) return [];

    const scores = new Map<string, number>();

    for (const [qn, sym] of this.data.symbols) {
      let score = 0;
      const nameLower = sym.name.toLowerCase();
      const pathLower = sym.filePath.toLowerCase();
      // 拆分 camelCase / snake_case 为词
      const nameTokens = tokenizeName(sym.name);

      for (const kw of keywords) {
        const kwLower = kw.toLowerCase();
        // 名称精确匹配
        if (nameLower === kwLower) {
          score += 5;
        }
        // 名称包含
        else if (nameLower.includes(kwLower) || nameTokens.some((t) => t === kwLower)) {
          score += 3;
        }
        // 文件路径匹配
        if (pathLower.includes(kwLower)) {
          score += 2;
        }
      }

      // inDegree 加权
      const refs = this.data.inDegree.get(qn) ?? 0;
      score += Math.min(refs, 3); // 最多 +3

      if (score > 0) scores.set(qn, score);
    }

    return [...scores.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, topK)
      .map(([qn]) => this.data!.symbols.get(qn)!)
      .filter(Boolean);
  }

  /** 批量获取符号的完整函数体 */
  getBodies(qualifiedNames: string[]): Map<string, string> {
    const result = new Map<string, string>();
    if (!this.data) return result;
    for (const qn of qualifiedNames) {
      const sym = this.data.symbols.get(qn);
      if (sym) result.set(qn, sym.body);
    }
    return result;
  }

  /** 返回所有符号名列表 */
  allSymbolNames(): string[] {
    if (!this.data) return [];
    return [...new Set([...this.data.symbols.values()].map((s) => s.name))];
  }

  /** 对比已审计符号集，返回未覆盖的符号 (按重要性排序) */
  uncoveredSymbols(auditedNames: Set<string>): SymbolDef[] {
    if (!this.data) return [];
    return this.sortedSymbols().filter(
      (sym) => !auditedNames.has(sym.name) && !auditedNames.has(sym.qualifiedName),
    );
  }

  // ─── Private ───

  /** 按 inDegree 降序排列所有符号 */
  private sortedSymbols(): SymbolDef[] {
    if (!this.data) return [];
    return [...this.data.symbols.values()].sort((a, b) => {
      const ra = this.data!.inDegree.get(a.qualifiedName) ?? 0;
      const rb = this.data!.inDegree.get(b.qualifiedName) ?? 0;
      return rb - ra;
    });
  }

  /** 递归收集匹配文件 */
  private collectFiles(dir: string): string[] {
    const results: string[] = [];
    this.walkDir(dir, results);
    return results;
  }

  private walkDir(dir: string, results: string[]): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.name.startsWith(".") && this.excludeDirs.has(entry.name)) continue;
      if (this.excludeDirs.has(entry.name)) continue;

      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        this.walkDir(fullPath, results);
      } else if (entry.isFile() && this.matchesGlob(entry.name)) {
        results.push(fullPath);
      }
    }
  }

  /** 简易 glob 匹配: 检查文件扩展名 */
  private matchesGlob(filename: string): boolean {
    for (const glob of this.fileGlobs) {
      // Extract extension from glob like "**/*.ts" → ".ts"
      const extMatch = glob.match(/\*(\.\w+)$/);
      if (extMatch && filename.endsWith(extMatch[1])) return true;
      // Literal filename match
      if (filename === glob) return true;
    }
    return false;
  }
}

/** 从查询文本提取关键词 */
function extractKeywords(query: string): string[] {
  return query
    .split(/[\s,;:.!?()\[\]{}"'`]+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w.toLowerCase()));
}

/** 拆分 camelCase / snake_case 为小写词 */
function tokenizeName(name: string): string[] {
  return name
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .split(/[_\-]/)
    .map((t) => t.toLowerCase())
    .filter((t) => t.length > 1);
}
