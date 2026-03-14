/**
 * ag/input — 聊天输入框操作
 *
 * 处理聚焦、检测、输入等操作。
 * 避免重复按 ⌘L 导致面板被关闭。
 */

import type { Page } from 'playwright';
import { Keys } from './types.js';
import { humanDelay, microPause, sleep } from './humanize.js';

/**
 * 聚焦到聊天输入框
 *
 * 先检测当前焦点是否已在 contenteditable 上,
 * 避免重复按 ⌘L 导致 chat 面板被关闭。
 */
export async function focusChatInput(page: Page, humanize: boolean): Promise<void> {
  // 检查当前焦点是否已在编辑区
  const alreadyFocused = await page.evaluate(() => {
    const el = document.activeElement;
    return el !== null && (
      (el as HTMLElement).contentEditable === 'true' ||
      (el as HTMLElement).contentEditable === 'plaintext-only'
    );
  });

  if (alreadyFocused) return;

  // 按 ⌘L 聚焦
  await page.keyboard.press(Keys.FOCUS_CHAT);
  if (humanize) {
    await humanDelay(0.3, 0.6);
  } else {
    await sleep(300);
  }

  // 验证是否真的聚焦了
  const isEditable = await page.evaluate(() => {
    const el = document.activeElement;
    return el !== null && (
      (el as HTMLElement).contentEditable === 'true' ||
      (el as HTMLElement).contentEditable === 'plaintext-only'
    );
  });

  if (!isEditable) {
    // Fallback: 直接点击 contenteditable 元素
    const editables = await page.$$('[contenteditable="true"], [contenteditable="plaintext-only"]');
    for (let i = editables.length - 1; i >= 0; i--) {
      try {
        if (await editables[i].isVisible()) {
          await editables[i].click();
          if (humanize) await microPause();
          else await sleep(200);
          break;
        }
      } catch {
        continue;
      }
    }
  }
}
