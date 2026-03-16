/**
 * ag/panel — Agent 面板内容获取
 *
 * 核心原则: 抓全量 innerText, 不 parse DOM 结构。
 * 有噪音没关系, LLM 可以处理。
 * 但 diff 后会过一遍 NoiseFilter, 去掉大部分已知 UI 杂音以节省 token。
 */

import type { Page } from "playwright";

// ─── Noise Filter ────────────────────────────────────
// 已知的 UI 杂音模式。集中在这里, UI 改了只需更新这一处。

const NoiseFilter = {
  /** 完全匹配的行 (trim 后) */
  exactLines: new Set([
    "Copy",
    "Send",
    "Planning",
    "Generating",
    "Generating.",
    "Generating…",
    "Relocate",
    "Review Changes",
    "Always run",
    "Cancel",
    "Proceed",
    "Open",
    // 设置面板
    "Customization",
    "MCP Servers",
    "Export",
    "Model",
    "New",
    "Settings",
    "AI Shortcuts",
    // 模型名称
    "Gemini 3.1 Pro (High)",
    "Gemini 3.1 Pro (Low)",
    "Gemini 3 Flash",
    "Claude Sonnet 4.6 (Thinking)",
    "Claude Opus 4.6 (Thinking)",
    "GPT-OSS 120B (Medium)",
  ]),

  /** 前缀匹配 (trim 后的行以这些开头就过滤) */
  prefixes: [
    "Ask anything",
    "Claude ", // "Claude Opus 4.6 (Th..."
    "Gemini ", // "Gemini 3.1 Pro..."
    "GPT-", // "GPT-OSS..."
    "Scroll to bottom",
    "Record voice memo",
    "View ", // "View 1 edited file"
  ],

  /** 正则匹配 */
  patterns: [
    /^Thought for \d+s?$/, // "Thought for 2s"
    /^Thought for <\d+s$/, // "Thought for <1s"
    /^[a-z]+ \d+\.\d+/, // "claude 4.6" etc
    /^@ to mention/,
    /^\/\s+for workflows$/,
    /^Initiating /, // "Initiating Task Execution"
    /^Determining /, // "Determining Optimal Response"
    /^Advancing /, // "Advancing towards next step"
  ],

  /** 判断某行是否是噪音 */
  isNoise(line: string): boolean {
    const trimmed = line.trim();
    if (!trimmed) return false; // 空行保留 (排版用)

    if (this.exactLines.has(trimmed)) return true;
    if (this.prefixes.some((p) => trimmed.startsWith(p))) return true;
    if (this.patterns.some((r) => r.test(trimmed))) return true;

    return false;
  },

  /** 过滤整段文本 */
  clean(text: string): string {
    return text
      .split("\n")
      .filter((line) => !this.isNoise(line))
      .join("\n")
      .replace(/\n{3,}/g, "\n\n") // 连续空行压缩
      .trim();
  },
} as const;

// ─── Panel Snapshot ──────────────────────────────────

/**
 * 抓取 Antigravity Agent 面板的 innerText
 */
export async function snapshotPanel(page: Page): Promise<string> {
  return page.evaluate(() => {
    // 优先: Antigravity 专属面板
    const agPanel = document.querySelector(".antigravity-agent-side-panel");
    if (agPanel) {
      const text = (agPanel as HTMLElement).innerText || "";
      if (text.trim().length > 0) return text;
    }
    // 备选: 右侧 auxiliarybar
    const auxBar = document.querySelector(".part.auxiliarybar");
    if (auxBar) {
      const text = (auxBar as HTMLElement).innerText || "";
      if (text.trim().length > 0) return text;
    }
    return "";
  });
}

/**
 * 直接从 DOM 提取最后一条 AI 回复
 *
 * 比 diff 更可靠: 不依赖 before/after 快照对比。
 * AI 回复渲染在 div.leading-relaxed 容器里，取最后一个的 innerText 即可。
 */
export async function extractLastResponse(page: Page): Promise<string> {
  const text = await page.evaluate(`
    (function() {
      // 每条消息（用户/AI）都渲染在 leading-relaxed 容器里
      var containers = document.querySelectorAll('.leading-relaxed');
      if (containers.length === 0) return '';
      var last = containers[containers.length - 1];
      return (last.innerText || '').trim();
    })()
  `);
  return (text as string) || "";
}

/**
 * 计算当前 .leading-relaxed 容器总数
 * 用于在 chat 前记录 baseline，chat 后提取新增内容
 */
export async function countMessages(page: Page): Promise<number> {
  return page.evaluate(() => {
    return document.querySelectorAll(".leading-relaxed").length;
  });
}

/**
 * 提取从 baseCount 开始的所有新 .leading-relaxed 容器文本
 *
 * 比 extractLastResponse 更可靠:
 *   - 包含 thinking（思考过程）
 *   - 包含中间输出（代码动作、文件写入等）
 *   - 包含最终回复
 * 用 NoiseFilter 清洗噪音。
 */
export async function extractResponsesSince(
  page: Page,
  baseCount: number,
): Promise<string> {
  const raw = await page.evaluate((base: number) => {
    const containers = document.querySelectorAll(".leading-relaxed");
    const parts: string[] = [];
    for (let i = base; i < containers.length; i++) {
      const text = (containers[i] as HTMLElement).innerText?.trim();
      if (text) parts.push(text);
    }
    return parts.join("\n\n---\n\n");
  }, baseCount);
  return NoiseFilter.clean(raw || "");
}

// ─── Diff ────────────────────────────────────────────

/**
 * 去掉 CSS text-overflow: ellipsis 造成的截断重复行。
 * 如果一行是另一行的前缀 (至少 5 字符)，则认为是截断版，去掉。
 */
function dedupTruncated(lines: string[]): string[] {
  const trimmed = lines.map((l) => l.trim()).filter((l) => l.length > 0);
  return trimmed.filter((line, _i) => {
    // 如果存在另一行，以当前行为前缀且更长，则当前行是截断版
    if (line.length < 5) return true;
    return !trimmed.some(
      (other) =>
        other !== line && other.length > line.length && other.startsWith(line),
    );
  });
}

/**
 * 对比 before/after 快照, 提取新增内容, 过滤噪音。
 *
 * @param userMessage - 用户发送的消息原文，会从结果中去掉。
 */
export function diffSnapshots(
  before: string,
  after: string,
  userMessage?: string,
): string {
  if (!before.trim()) {
    let result = NoiseFilter.clean(after);
    if (userMessage) result = stripUserMessage(result, userMessage);
    return dedup(result);
  }

  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");

  // 找最长公共前缀, 然后取后面的新增部分
  let commonPrefix = 0;
  const minLen = Math.min(beforeLines.length, afterLines.length);
  for (let i = 0; i < minLen; i++) {
    if (beforeLines[i] === afterLines[i]) {
      commonPrefix = i + 1;
    } else {
      break;
    }
  }

  const newLines = afterLines.slice(commonPrefix);
  const raw = newLines.join("\n").trim();
  let result = NoiseFilter.clean(raw || after);
  if (userMessage) result = stripUserMessage(result, userMessage);
  return dedup(result);
}

/**
 * 从 diff 结果中去掉用户发送的消息。
 * 用户消息可能被分成多行出现在 diff 中。
 */
function stripUserMessage(text: string, userMessage: string): string {
  // 先尝试直接去掉完整的 userMessage (整段匹配)
  if (text.includes(userMessage)) {
    text = text.replace(userMessage, "");
  }

  // 再逐行检查: 只去掉跟 userMessage 某一行**完全一致**的行
  const msgLines = new Set(
    userMessage
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 3),
  );
  const lines = text.split("\n");
  const filtered = lines.filter((line) => {
    const trimmed = line.trim();
    if (!trimmed) return true; // 保留空行
    return !msgLines.has(trimmed);
  });

  return filtered
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * 最终去重: 去掉 CSS truncation 造成的重复行
 */
function dedup(text: string): string {
  const lines = text.split("\n");
  return dedupTruncated(lines)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
