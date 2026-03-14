/**
 * ag/state — Agent 状态检测
 *
 * 核心信号: 输入框旁的 Send 按钮
 *   - Send 按钮可见 → IDLE (AI 空闲)
 *   - Send 按钮不可见 → GENERATING (AI 正在生成)
 *   - Accept 按钮可见 → WAITING_APPROVAL (等待用户确认)
 *
 * ⚠️ 这些检测逻辑依赖 Antigravity 的 DOM 结构，属于 hack。
 *    所有 DOM 查询集中在 Probes 对象里，方便将来适配 UI 变更。
 */

import type { Page } from 'playwright';
import { AgentState } from './types.js';

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
    const btns = document.querySelectorAll('button');
    for (const b of btns) {
      const el = b as HTMLElement;
      if (!el.offsetParent) continue; // 不可见
      if (el.textContent?.trim() === 'Send') return true;
    }
    return false;
  },

  /**
   * 检测 Accept 按钮是否存在 (tool/file approval)
   *
   * 依据: 'Accept' 或 'Always run' 文本的按钮
   */
  hasAcceptButton: () => {
    const btns = document.querySelectorAll('button');
    for (const b of btns) {
      const el = b as HTMLElement;
      if (!el.offsetParent) continue;
      const t = el.textContent?.trim().toLowerCase() ?? '';
      if (/^accept|^always run/.test(t)) return true;
    }
    return false;
  },

  /**
   * 点击 Accept/Always run 按钮
   */
  clickAcceptButton: () => {
    const btns = document.querySelectorAll('button');
    for (const b of btns) {
      const el = b as HTMLElement;
      if (!el.offsetParent) continue;
      const t = el.textContent?.trim().toLowerCase() ?? '';
      if (/^accept/.test(t)) {
        el.click();
        return true;
      }
    }
    return false;
  },
} as const;

// ─── Public API ──────────────────────────────────────

/**
 * 检测 Agent 当前状态
 *
 * 优先级:
 *   1. Accept 按钮可见 → WAITING_APPROVAL
 *   2. Send 按钮可见 → IDLE
 *   3. 都没有 → GENERATING
 */
export async function detectState(page: Page): Promise<AgentState> {
  const state = await page.evaluate(({ probes }) => {
    // 动态构造检测函数 (evaluate 里不能直接引用外部闭包)
    const hasSend = new Function(probes.hasSendButton)() as boolean;
    const hasAccept = new Function(probes.hasAcceptButton)() as boolean;

    if (hasAccept) return 'waiting_approval';
    if (hasSend) return 'idle';
    return 'generating';
  }, {
    probes: {
      hasSendButton: `return (${Probes.hasSendButton.toString()})()`,
      hasAcceptButton: `return (${Probes.hasAcceptButton.toString()})()`,
    },
  });

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
