/**
 * ag/state — Agent 状态检测
 *
 * 核心信号: 输入框旁的 Send 按钮
 *   - Send 按钮可见 → IDLE (AI 空闲)
 *   - Send 按钮不可见 → GENERATING (AI 正在生成)
 *   - Accept 按钮可见 → WAITING_APPROVAL (等待用户确认)
 *   - Retry 按钮可见 → ERROR_TERMINATED (Agent 崩溃, 可重试)
 *
 * ⚠️ 这些检测逻辑依赖 Antigravity 的 DOM 结构，属于 hack。
 *    所有 DOM 查询集中在 Probes 对象里，方便将来适配 UI 变更。
 */

import type { Page } from "playwright";
import { AgentState } from "./types.js";

// ─── DOM Probes ──────────────────────────────────────
// 所有 DOM 层面的 hack 集中在这里。
// 如果 Antigravity UI 改了结构，只需修改这个对象。

const Probes = {
  /**
   * 检测 Send 按钮是否存在且可见
   *
   * 依据: 输入区域有一个 text='Send' 的 button
   * 空闲时可见 (disabled=true/false), 生成中消失。
   */
  hasSendButton: () => {
    const btns = document.querySelectorAll("button");
    for (const b of btns) {
      const el = b as HTMLElement;
      if (!el.offsetParent) continue; // 不可见
      if (el.textContent?.trim() === "Send") return true;
    }
    return false;
  },

  /**
   * 检测 Accept 按钮是否存在 (tool/file approval)
   *
   * 依据: 'Accept' 或 'Always run' 文本的按钮
   */
  hasAcceptButton: () => {
    const btns = document.querySelectorAll("button");
    for (const b of btns) {
      const el = b as HTMLElement;
      if (!el.offsetParent) continue;
      const t = el.textContent?.trim().toLowerCase() ?? "";
      if (/^accept|^always run/.test(t)) return true;
    }
    return false;
  },

  /**
   * 检测 Retry 按钮是否存在 (Agent terminated due to error)
   *
   * 依据: 可见的 text='Retry' 按钮
   */
  hasRetryButton: () => {
    const btns = document.querySelectorAll("button");
    for (const b of btns) {
      const el = b as HTMLElement;
      if (!el.offsetParent) continue;
      if (el.textContent?.trim() === "Retry") return true;
    }
    return false;
  },

  /**
   * 点击 Accept/Always run 按钮
   */
  clickAcceptButton: () => {
    const btns = document.querySelectorAll("button");
    for (const b of btns) {
      const el = b as HTMLElement;
      if (!el.offsetParent) continue;
      const t = el.textContent?.trim().toLowerCase() ?? "";
      if (/^accept/.test(t)) {
        el.click();
        return true;
      }
    }
    return false;
  },

  /**
   * 点击 Retry 按钮
   */
  clickRetryButton: () => {
    const btns = document.querySelectorAll("button");
    for (const b of btns) {
      const el = b as HTMLElement;
      if (!el.offsetParent) continue;
      if (el.textContent?.trim() === "Retry") {
        el.click();
        return true;
      }
    }
    return false;
  },

  /**
   * 获取当前对话标题
   *
   * DOM 结构 (Antigravity 2026-03):
   *   .antigravity-agent-side-panel
   *     > div.w-full.h-full.flex.flex-col.box-border
   *       > div.flex.items-center.justify-between (头部栏)
   *         > div.text-ellipsis.whitespace-nowrap  ← 对话标题文本
   */
  getConversationTitle: () => {
    // 新对话或空对话可能显示的默认标题，视为 "无标题"
    const EMPTY_TITLES = new Set(["agent", "new chat", "untitled"]);

    const panel =
      document.querySelector(".antigravity-agent-side-panel") ||
      document.querySelector(".part.auxiliarybar");
    if (!panel) return "";

    const titleEl = panel.querySelector(
      ".text-ellipsis.whitespace-nowrap",
    ) as HTMLElement | null;
    const title = titleEl?.textContent?.trim() ?? "";

    return EMPTY_TITLES.has(title.toLowerCase()) ? "" : title;
  },
} as const;

// ─── Public API ──────────────────────────────────────

/**
 * 检测 Agent 当前状态
 *
 * 优先级:
 *   1. Send 按钮可见 → IDLE (AI 完成, 即使有残留 Accept/Retry 按钮)
 *   2. Accept 按钮可见 → WAITING_APPROVAL
 *   3. Retry 按钮可见 → ERROR_TERMINATED
 *   4. 都没有 → GENERATING
 */
export async function detectState(page: Page): Promise<AgentState> {
  const state = await page.evaluate(
    ({ probes }) => {
      // 动态构造检测函数 (evaluate 里不能直接引用外部闭包)
      const hasSend = new Function(probes.hasSendButton)() as boolean;

      // Send 可见 = AI 已完成, 直接返回 idle
      if (hasSend) return "idle";

      const hasAccept = new Function(probes.hasAcceptButton)() as boolean;
      const hasRetry = new Function(probes.hasRetryButton)() as boolean;

      if (hasAccept) return "waiting_approval";
      if (hasRetry) return "error_terminated";
      return "generating";
    },
    {
      probes: {
        hasSendButton: `return (${Probes.hasSendButton.toString()})()`,
        hasAcceptButton: `return (${Probes.hasAcceptButton.toString()})()`,
        hasRetryButton: `return (${Probes.hasRetryButton.toString()})()`,
      },
    },
  );

  return state as AgentState;
}

/**
 * 点击 Accept 按钮
 */
export async function clickAccept(page: Page): Promise<boolean> {
  return page.evaluate((probeSrc) => {
    return new Function(probeSrc)() as boolean;
  }, `return (${Probes.clickAcceptButton.toString()})()`);
}

/**
 * 点击 Retry 按钮
 */
export async function clickRetry(page: Page): Promise<boolean> {
  return page.evaluate((probeSrc) => {
    return new Function(probeSrc)() as boolean;
  }, `return (${Probes.clickRetryButton.toString()})()`);
}

/**
 * 获取当前对话标题
 */
export async function getConversationTitle(page: Page): Promise<string> {
  return page.evaluate((probeSrc) => {
    return new Function(probeSrc)() as string;
  }, `return (${Probes.getConversationTitle.toString()})()`);
}
