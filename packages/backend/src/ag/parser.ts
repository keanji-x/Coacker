/**
 * ag/parser — 结构化 DOM 解析器
 *
 * 解析 Antigravity 面板的 DOM 树, 返回结构化的对话 turns。
 * 替代原有的 .leading-relaxed 选择器, 更可靠地提取所有内容类型:
 *   - thinking (思考过程)
 *   - text (AI 正文回复)
 *   - tool_action (工具调用: 读取/搜索/编辑文件等)
 *   - file_edit (文件变更区块)
 *   - progress (任务进度)
 *
 * 所有 DOM 查询集中在 PARSER_SCRIPT 里, UI 改了只需修改这一处。
 */

import type { Page } from "playwright";

// ─── Types ───────────────────────────────────────────

export interface PanelTurn {
  /** 在对话中的顺序 (0-indexed) */
  index: number;
  /** 角色 */
  role: "user" | "assistant";
  /** 内容块 */
  blocks: TurnBlock[];
}

export interface TurnBlock {
  /** 内容类型 */
  type: "thinking" | "text" | "tool_action" | "file_edit" | "progress";
  /** 文本内容 */
  content: string;
}

// ─── Parser Script (在浏览器内执行) ─────────────────

/**
 * 这段脚本在 page.evaluate 里执行。
 * 用纯 JS (无 TS, 无外部引用) 解析面板 DOM 树。
 *
 * DOM 结构 (Antigravity 2026-03):
 *
 * 根容器: div.relative.flex.flex-col.gap-y-3.px-4
 *   ├── (skeleton divs: 只含 div.rounded-lg.bg-gray-500/10)
 *   ├── 用户 turn:
 *   │     └── div > div.bg-gray-500/15
 *   │           └── div.whitespace-pre-wrap.text-sm  ← 用户消息文本
 *   └── 助手 turn:
 *         └── div > div.flex.flex-col.space-y-2
 *               ├── div.isolate (thinking)
 *               │     └── button "Thought for Xs"
 *               │     └── div.overflow-hidden → .leading-relaxed.opacity-70
 *               ├── div.flex.flex-row.my-2 (AI text)
 *               │     └── div.leading-relaxed.text-ide-text-color
 *               ├── div.flex.flex-row (tool action)
 *               │     └── div.truncate → "Analyzed", "Searched", etc.
 *               └── div.text-ide-message-block-bot-color (file edit)
 */
const PARSER_SCRIPT = `
(function() {
  // ── 面板定位 ──
  var panel = document.querySelector('.antigravity-agent-side-panel')
    || document.querySelector('.part.auxiliarybar');
  if (!panel) return [];

  // ── 找到聊天容器 ──
  // 聊天内容在 div.relative.flex.flex-col.gap-y-3.px-4 里
  var chatRoot = panel.querySelector('.relative.flex.flex-col.gap-y-3.px-4');
  if (!chatRoot) {
    // fallback: 找包含 .leading-relaxed 的最近公共祖先
    var msgs = panel.querySelectorAll('.leading-relaxed');
    if (msgs.length > 1) {
      chatRoot = msgs[0].parentElement;
      while (chatRoot && !chatRoot.contains(msgs[msgs.length - 1])) {
        chatRoot = chatRoot.parentElement;
      }
    }
  }
  if (!chatRoot) return [];

  // ── 遍历每个 turn ──
  var turns = [];
  var turnIndex = 0;
  var children = chatRoot.children;

  for (var ci = 0; ci < children.length; ci++) {
    var child = children[ci];
    var turn = classifyTurn(child, turnIndex);
    if (turn) {
      turns.push(turn);
      turnIndex++;
    }
  }

  return turns;

  // ────────────────────────────────────────────────
  // 辅助函数
  // ────────────────────────────────────────────────

  function classifyTurn(el, idx) {
    // 1. 用户消息: 包含 div.bg-gray-500/15
    var userBubble = findByClassIncludes(el, 'bg-gray-500/15');
    if (userBubble) {
      var textEl = userBubble.querySelector('.whitespace-pre-wrap');
      var text = textEl ? (textEl.innerText || '').trim() : (userBubble.innerText || '').trim();
      if (text.length === 0) return null;
      return {
        index: idx,
        role: 'user',
        blocks: [{ type: 'text', content: text }]
      };
    }

    // 2. 助手 turn: 包含 div.flex.flex-col.space-y-2
    var assistContainer = el.querySelector('.flex.flex-col.space-y-2');
    if (assistContainer) {
      var blocks = parseAssistantBlocks(assistContainer);
      if (blocks.length === 0) return null;
      return {
        index: idx,
        role: 'assistant',
        blocks: blocks
      };
    }

    // 3. 单独的 .leading-relaxed (某些 turn 没有 space-y-2 容器)
    var loneMsg = el.querySelector('.leading-relaxed');
    if (loneMsg) {
      var classes = String(loneMsg.className);
      var isThinking = classes.indexOf('opacity-70') >= 0;
      var text = (loneMsg.innerText || '').trim();
      if (text.length === 0) return null;
      return {
        index: idx,
        role: 'assistant',
        blocks: [{ type: isThinking ? 'thinking' : 'text', content: text }]
      };
    }

    // 4. 文件编辑区块 (text-ide-message-block-bot-color)
    var fileEdit = findByClassIncludes(el, 'message-block-bot-color');
    if (fileEdit) {
      var text = (fileEdit.innerText || '').trim();
      if (text.length === 0) return null;
      return {
        index: idx,
        role: 'assistant',
        blocks: [{ type: 'file_edit', content: text }]
      };
    }

    // 5. Skeleton / empty — 跳过
    return null;
  }

  function parseAssistantBlocks(container) {
    var blocks = [];
    var kids = container.children;

    for (var i = 0; i < kids.length; i++) {
      var block = kids[i];
      var classes = String(block.className || '');

      // ── Thinking block ──
      // div.isolate 里有 button "Thought for Xs" + .leading-relaxed
      var isolate = block.classList.contains('isolate')
        ? block
        : block.querySelector('.isolate');
      if (isolate) {
        var lr = isolate.querySelector('.leading-relaxed');
        if (lr) {
          var text = (lr.innerText || '').trim();
          if (text.length > 0) {
            blocks.push({ type: 'thinking', content: text });
          }
        }
        continue;
      }

      // ── AI text response ──
      // div.flex.flex-row.my-2 → .leading-relaxed (not opacity-70)
      var lr = block.querySelector('.leading-relaxed');
      if (lr) {
        var lrClasses = String(lr.className);
        var isThinking = lrClasses.indexOf('opacity-70') >= 0;
        var hasTextColor = lrClasses.indexOf('text-ide-text-color') >= 0;
        var text = (lr.innerText || '').trim();
        if (text.length > 0) {
          if (isThinking) {
            blocks.push({ type: 'thinking', content: text });
          } else if (hasTextColor || classes.indexOf('my-2') >= 0) {
            blocks.push({ type: 'text', content: text });
          } else {
            // 短文本可能是 progress / status
            blocks.push({ type: text.length < 200 ? 'progress' : 'text', content: text });
          }
        }
        continue;
      }

      // ── Tool action ──
      // div.flex.flex-row → div.truncate (包含 "Analyzed", "Searched", etc.)
      var truncate = block.querySelector('.truncate');
      if (truncate) {
        var text = (truncate.innerText || '').trim();
        if (text.length > 0) {
          blocks.push({ type: 'tool_action', content: text });
        }
        continue;
      }

      // ── File edit block ──
      var fileBlock = findByClassIncludes(block, 'message-block-bot-color');
      if (fileBlock) {
        var text = (fileBlock.innerText || '').trim();
        if (text.length > 0) {
          blocks.push({ type: 'file_edit', content: text });
        }
        continue;
      }

      // ── Unknown block with text ──
      var text = (block.innerText || '').trim();
      if (text.length > 0) {
        blocks.push({ type: 'progress', content: text });
      }
    }

    return blocks;
  }

  function findByClassIncludes(el, substr) {
    if (String(el.className || '').indexOf(substr) >= 0) return el;
    var found = null;
    var kids = el.querySelectorAll('*');
    for (var i = 0; i < kids.length; i++) {
      if (String(kids[i].className || '').indexOf(substr) >= 0) {
        found = kids[i];
        break;
      }
    }
    return found;
  }
})()
`;

// ─── Public API ──────────────────────────────────────

/**
 * 解析面板 DOM, 返回所有对话 turns
 */
export async function parsePanel(page: Page): Promise<PanelTurn[]> {
  const result = await page.evaluate(PARSER_SCRIPT);
  return (result as PanelTurn[]) || [];
}

/**
 * 计算对话中的 turn 总数
 * 替代 countMessages (基于 .leading-relaxed 计数)
 */
export async function countTurns(page: Page): Promise<number> {
  const turns = await parsePanel(page);
  return turns.length;
}

/**
 * 提取从 baseTurnCount 开始的所有新助手回复
 * 替代 extractResponsesSince
 *
 * 返回所有新 assistant turn 的 text + thinking 内容
 */
export async function getResponseSince(
  page: Page,
  baseTurnCount: number,
): Promise<string> {
  const turns = await parsePanel(page);
  const newTurns = turns.slice(baseTurnCount);

  const parts: string[] = [];

  for (const turn of newTurns) {
    if (turn.role !== "assistant") continue;

    for (const block of turn.blocks) {
      // 返回 text 和 thinking (不返回 tool_action、progress 等噪音)
      if (block.type === "text" || block.type === "thinking") {
        parts.push(block.content);
      }
    }
  }

  return parts.join("\n\n---\n\n");
}

/**
 * 提取最后一条助手回复的正文 (不包含 thinking)
 * 替代 extractLastResponse
 */
export async function getLastResponse(page: Page): Promise<string> {
  const turns = await parsePanel(page);

  // 从后往前找最后一个 assistant turn
  for (let i = turns.length - 1; i >= 0; i--) {
    if (turns[i].role !== "assistant") continue;

    const textBlocks = turns[i].blocks
      .filter((b) => b.type === "text")
      .map((b) => b.content);

    if (textBlocks.length > 0) {
      return textBlocks.join("\n\n");
    }
  }

  return "";
}
