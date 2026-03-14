/**
 * ag/humanize — 模拟人类操作节奏
 *
 * 通过随机延迟和变速打字降低自动化检测风险。
 */

import type { Page } from 'playwright';

/** 随机范围内延迟 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** 随机范围延迟 [minS, maxS] 秒 */
export async function humanDelay(minS: number = 0.5, maxS: number = 1.5): Promise<void> {
  const ms = (minS + Math.random() * (maxS - minS)) * 1000;
  await sleep(ms);
}

/** 微停顿 (0.1 ~ 0.3s) */
export async function microPause(): Promise<void> {
  await humanDelay(0.1, 0.3);
}

/** 思考停顿 (0.5 ~ 2s) */
export async function thinkPause(): Promise<void> {
  await humanDelay(0.5, 2.0);
}

/** 模拟人类打字 — 逐字符输入, 随机延迟 */
export async function humanType(page: Page, text: string): Promise<void> {
  for (const char of text) {
    if (char === '\n') {
      // Shift+Enter = 换行不发送
      await page.keyboard.press('Shift+Enter');
    } else {
      await page.keyboard.type(char, { delay: 0 });
    }
    // 每个字符后 30~120ms 随机延迟
    await sleep(30 + Math.random() * 90);

    // 偶尔较长停顿 (模拟思考)
    if (Math.random() < 0.05) {
      await sleep(200 + Math.random() * 400);
    }
  }
}

/** 快速打字 — 用于长文本, 减少总延迟 */
export async function humanTypeFast(page: Page, text: string): Promise<void> {
  // 按行分割，行间用 Shift+Enter，行内 chunk 打
  const lines = text.split('\n');
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    const chunkSize = 20 + Math.floor(Math.random() * 30);
    for (let i = 0; i < line.length; i += chunkSize) {
      const chunk = line.slice(i, i + chunkSize);
      await page.keyboard.type(chunk, { delay: 10 });
      await sleep(50 + Math.random() * 150);
    }
    // 行间换行: Shift+Enter (不触发发送)
    if (li < lines.length - 1) {
      await page.keyboard.press('Shift+Enter');
      await sleep(30 + Math.random() * 50);
    }
  }
}
