import { Parser, Language, type Node } from "web-tree-sitter";
import fs from "fs";
import path from "path";

/** 符号定义 */
export interface SymbolDef {
  name: string;
  qualifiedName: string; // filePath::name
  filePath: string; // 相对路径
  kind: "function" | "class" | "method" | "interface" | "type" | "const" | "modifier" | "event" | "state_var";
  line: number;
  signature: string; // 函数签名 (不含 body)
  body: string; // 完整源码
  bodyTokens: number; // 估算 token 数 (chars / 4)
}

/** 符号引用 (依赖图的边) */
export interface SymbolRef {
  fromFile: string;
  fromLine: number;
  toSymbol: string;
}

/** 支持的语言 ID */
export type LangId = "typescript" | "solidity" | "rust";

/** AST 节点类型 → SymbolDef.kind 映射 */
const NODE_KIND_MAP: Record<string, SymbolDef["kind"]> = {
  // TypeScript / JavaScript
  function_declaration: "function",
  method_definition: "method",
  class_declaration: "class",
  interface_declaration: "interface",
  type_alias_declaration: "type",
  // Rust
  function_item: "function",
  struct_item: "class",
  enum_item: "class",
  trait_item: "interface",
  impl_item: "class",
  // Solidity
  function_definition: "function",
  contract_declaration: "class",
  struct_declaration: "class",
  modifier_definition: "modifier",
  event_definition: "event",
  enum_declaration: "class",
  library_declaration: "class",
  constructor_definition: "function",
  state_variable_declaration: "state_var",
  error_declaration: "event",
  fallback_receive_definition: "function",
};

/** 文件扩展名 → 语言 ID */
const EXT_TO_LANG: Record<string, LangId> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "typescript", // tree-sitter-typescript handles JS too
  ".jsx": "typescript",
  ".sol": "solidity",
  ".rs": "rust",
};

/**
 * AstAnalyzer: 原生集成 WebAsset/TreeSitter 进行本地 AST 查询
 * 用于取代大模型直接阅读完整源码，实现百毫秒极速范围剪裁。
 * 作为 Toolkit 辅助工具使用，不是 Backend 实现。
 *
 * 支持多语言: 通过 init() 注册单语言，或 initMulti() 注册多语言。
 * 解析文件时根据扩展名自动选择对应的 parser。
 */
export class AstAnalyzer {
  public parser: Parser | null = null;
  private parserReady = false;
  /** 语言 registry: langId → Language */
  private languages = new Map<LangId, Language>();
  /** 当前 parser 设置的语言 */
  private currentLang: LangId | null = null;

  /**
   * 初始化单语言 (向后兼容)
   * @param langPath .wasm 文件路径
   */
  async init(langPath: string) {
    if (!this.parserReady) {
      await Parser.init();
      this.parser = new Parser();
      this.parserReady = true;
    }
    const language = await Language.load(langPath);
    this.parser!.setLanguage(language);

    // 从路径推断 langId
    const langId = inferLangIdFromPath(langPath);
    if (langId) {
      this.languages.set(langId, language);
      this.currentLang = langId;
    }
  }

  /**
   * 注册多语言
   * @param entries [langId, wasmPath] 对
   */
  async initMulti(entries: Array<[LangId, string]>) {
    if (!this.parserReady) {
      await Parser.init();
      this.parser = new Parser();
      this.parserReady = true;
    }
    for (const [langId, wasmPath] of entries) {
      const language = await Language.load(wasmPath);
      this.languages.set(langId, language);
    }
    // 默认设置第一个
    if (entries.length > 0) {
      const [firstLang] = entries[0];
      this.parser!.setLanguage(this.languages.get(firstLang)!);
      this.currentLang = firstLang;
    }
  }

  /** 已注册的语言列表 */
  get registeredLanguages(): LangId[] {
    return [...this.languages.keys()];
  }

  /**
   * 精确提取文件的特定函数作用域片段
   */
  async extractFunctionBody(
    filePath: string,
    targetFunc: string,
  ): Promise<string | null> {
    const tree = this.parseFile(filePath);
    if (!tree) return null;

    let result: string | null = null;

    const traverse = (node: Node) => {
      if (NODE_KIND_MAP[node.type] === "function" || node.type === "method_definition") {
        const nameNode =
          node.childForFieldName("name") ??
          node.children.find((c: Node) => c.type === "identifier");
        if (nameNode && nameNode.text === targetFunc) {
          result = node.text;
          return;
        }
      }
      for (const child of node.children) {
        if (!result) traverse(child);
      }
    };

    traverse(tree.rootNode);
    return result;
  }

  /**
   * 提取文件中所有符号定义
   */
  async extractSymbols(filePath: string): Promise<SymbolDef[]> {
    const tree = this.parseFile(filePath);
    if (!tree) return [];

    const symbols: SymbolDef[] = [];
    const ext = path.extname(filePath);
    const isSolidity = ext === ".sol";

    const traverse = (node: Node) => {
      const kind = NODE_KIND_MAP[node.type];
      if (kind) {
        const nameNode = findNameNode(node, isSolidity);

        if (nameNode) {
          const name = nameNode.text;
          const body = node.text;
          const signature = extractSignature(node);

          symbols.push({
            name,
            qualifiedName: `${filePath}::${name}`,
            filePath,
            kind,
            line: node.startPosition.row + 1,
            signature,
            body,
            bodyTokens: Math.ceil(body.length / 4),
          });
        }
      }

      // TypeScript: detect exported const (arrow functions, objects)
      if (!isSolidity && (node.type === "lexical_declaration" || node.type === "export_statement")) {
        const decl = node.type === "export_statement"
          ? node.children.find((c: Node) => c.type === "lexical_declaration")
          : node;
        if (decl) {
          for (const child of decl.children) {
            if (child.type === "variable_declarator") {
              const varNameNode = child.childForFieldName("name") ??
                child.children.find((c: Node) => c.type === "identifier");
              if (varNameNode) {
                const value = child.childForFieldName("value");
                const isArrow = value?.type === "arrow_function";
                if (isArrow || value?.type === "call_expression") {
                  const name = varNameNode.text;
                  const body = node.text;
                  symbols.push({
                    name,
                    qualifiedName: `${filePath}::${name}`,
                    filePath,
                    kind: isArrow ? "function" : "const",
                    line: node.startPosition.row + 1,
                    signature: extractSignature(node),
                    body,
                    bodyTokens: Math.ceil(body.length / 4),
                  });
                }
              }
            }
          }
        }
      }

      for (const child of node.children) {
        traverse(child);
      }
    };

    traverse(tree.rootNode);
    return symbols;
  }

  /**
   * 扫描文件中的标识符引用，与已知符号集合匹配
   */
  async extractReferences(
    filePath: string,
    knownSymbols: Set<string>,
  ): Promise<SymbolRef[]> {
    const tree = this.parseFile(filePath);
    if (!tree) return [];

    const refs: SymbolRef[] = [];
    const seen = new Set<string>();

    const traverse = (node: Node) => {
      if (node.type === "identifier" || node.type === "type_identifier") {
        const name = node.text;
        if (knownSymbols.has(name)) {
          const line = node.startPosition.row + 1;
          const key = `${line}:${name}`;
          if (!seen.has(key)) {
            seen.add(key);
            refs.push({ fromFile: filePath, fromLine: line, toSymbol: name });
          }
        }
      }
      for (const child of node.children) {
        traverse(child);
      }
    };

    traverse(tree.rootNode);
    return refs;
  }

  /**
   * 检查给定文件扩展名是否有对应的注册语言
   */
  canParse(filePath: string): boolean {
    const ext = path.extname(filePath);
    const langId = EXT_TO_LANG[ext];
    if (!langId) return false;
    return this.languages.has(langId);
  }

  // ─── Private ───

  /**
   * 解析文件: 根据扩展名自动切换语言
   * 如果文件扩展名对应的语言未注册，返回 null
   */
  private parseFile(filePath: string): ReturnType<Parser["parse"]> | null {
    if (!this.parser) throw new Error("Parser not initialized");

    const ext = path.extname(filePath);
    const langId = EXT_TO_LANG[ext];

    if (langId && this.languages.has(langId)) {
      // 按需切换语言
      if (langId !== this.currentLang) {
        this.parser.setLanguage(this.languages.get(langId)!);
        this.currentLang = langId;
      }
    } else if (!langId && this.languages.size === 0) {
      // 没有任何语言注册且无法推断 → 不可解析
      return null;
    }
    // 如果 langId 不在 registry 但有单语言 init → 用当前语言尝试（向后兼容）

    const sourceCode = fs.readFileSync(filePath, "utf8");
    return this.parser.parse(sourceCode);
  }
}

/** 从 .wasm 路径推断 langId */
function inferLangIdFromPath(wasmPath: string): LangId | null {
  const basename = path.basename(wasmPath).toLowerCase();
  if (basename.includes("typescript") || basename.includes("javascript")) return "typescript";
  if (basename.includes("solidity")) return "solidity";
  if (basename.includes("rust")) return "rust";
  return null;
}

/** 在 AST 节点中查找名称节点 */
function findNameNode(node: Node, isSolidity: boolean): Node | null {
  // Solidity constructor_definition 没有 name 字段
  if (node.type === "constructor_definition") {
    return { text: "constructor", startPosition: node.startPosition } as unknown as Node;
  }
  // Solidity fallback/receive 也没有 name
  if (node.type === "fallback_receive_definition") {
    // 检查是 fallback 还是 receive
    const keyword = node.children.find(
      (c: Node) => c.type === "fallback" || c.type === "receive" || c.text === "fallback" || c.text === "receive",
    );
    const name = keyword?.text ?? "fallback";
    return { text: name, startPosition: node.startPosition } as unknown as Node;
  }

  // state_variable_declaration: 名称可能在不同位置
  if (isSolidity && node.type === "state_variable_declaration") {
    // 遍历找 identifier (跳过类型标注)
    for (const child of node.children) {
      if (child.type === "identifier") return child;
    }
    return null;
  }

  return (
    node.childForFieldName("name") ??
    node.children.find(
      (c: Node) => c.type === "identifier" || c.type === "type_identifier",
    ) ??
    null
  );
}

/** 提取签名：取到第一个 `{` 为止，或完整文本 (interface/type) */
function extractSignature(node: Node): string {
  const text = node.text;
  const braceIdx = text.indexOf("{");
  if (braceIdx === -1) return text.trim();
  return text.slice(0, braceIdx).trim();
}
