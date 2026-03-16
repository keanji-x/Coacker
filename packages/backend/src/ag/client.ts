/**
 * ag/client — Antigravity CDP 客户端
 *
 * 通过 Playwright CDP 连接 Antigravity Electron 应用。
 * 状态检测靠按钮可见性 + 内容变化, 内容获取靠 panel snapshot diff。
 */

import { chromium, type Browser, type Page } from "playwright";
import type {
  ChatResult,
  ConversationInfo,
  AntigravityOptions,
  CDPPageInfo,
} from "./types.js";
import { AgentState, Keys } from "./types.js";
import { detectState, clickAccept, clickRetry } from "./state.js";
import { snapshotPanel } from "./panel.js";
import { focusChatInput } from "./input.js";
import {
  humanDelay,
  humanType,
  humanTypeFast,
  microPause,
  sleep,
} from "./humanize.js";

export class Antigravity {
  private endpointUrl: string;
  private timeout: number;
  private _humanize: boolean;

  private browser: Browser | null = null;
  private _page: Page | null = null;
  private _pageTitle: string = "";

  private conversations: ConversationInfo[] = [];
  private currentConv: ConversationInfo | null = null;

  constructor(options: AntigravityOptions = {}) {
    this.endpointUrl = options.endpointUrl ?? "http://localhost:9222";
    this.timeout = options.timeout ?? 30_000;
    this._humanize = options.humanize ?? true;
  }

  // ─── 连接管理 ───────────────────────────────

  /**
   * 连接到 Antigravity CDP 端点并选择页面
   * @param pageTitle 目标页面标题的子串匹配
   */
  async connect(pageTitle: string = ""): Promise<string> {
    this.browser = await chromium.connectOverCDP(this.endpointUrl);

    const pagesInfo = await this.listPagesHTTP();

    // 查找目标页面
    let target: CDPPageInfo | undefined;
    if (pageTitle) {
      target = pagesInfo.find(
        (p) =>
          p.type === "page" &&
          p.title.toLowerCase().includes(pageTitle.toLowerCase()),
      );
    } else {
      target = pagesInfo.find((p) => p.type === "page");
    }

    if (!target) {
      throw new Error(`No page found matching '${pageTitle}'`);
    }

    // 通过 Playwright context 找到对应页面
    // 需要 await page.title() — Playwright Node API 是异步的
    const matchStr = pageTitle.toLowerCase() || target.title.toLowerCase();
    for (const ctx of this.browser.contexts()) {
      for (const p of ctx.pages()) {
        try {
          const t = (await p.title()).toLowerCase();
          if (t.includes(matchStr)) {
            this._page = p;
            this._pageTitle = await p.title();
            return this._pageTitle;
          }
        } catch {
          continue;
        }
      }
    }

    // Fallback: 通过 URL 匹配 (CDP wsDebuggerUrl 里有 page id)
    for (const ctx of this.browser.contexts()) {
      for (const p of ctx.pages()) {
        try {
          // 尝试用 CDP target URL 匹配
          if (target.url && p.url() === target.url) {
            this._page = p;
            this._pageTitle = await p.title();
            return this._pageTitle;
          }
        } catch {
          continue;
        }
      }
    }

    // Last resort: 取第一个页面
    for (const ctx of this.browser.contexts()) {
      const pages = ctx.pages();
      if (pages.length > 0) {
        this._page = pages[0];
        this._pageTitle = await this._page.title();
        return this._pageTitle;
      }
    }

    throw new Error("Could not attach to any page");
  }

  /** 断开 CDP 连接 */
  async disconnect(): Promise<void> {
    if (this.browser) {
      try {
        await this.browser.close();
      } catch {
        /* ignore */
      }
    }
    this._page = null;
    this.browser = null;
  }

  get isConnected(): boolean {
    return this._page !== null;
  }

  get page(): Page {
    if (!this._page) throw new Error("Not connected. Call ag.connect() first.");
    return this._page;
  }

  get pageTitle(): string {
    return this._pageTitle;
  }

  // ─── 页面发现 ───────────────────────────────

  /** 列出可用页面 (过滤 worker) */
  async listPages(): Promise<CDPPageInfo[]> {
    const all = await this.listPagesHTTP();
    return all.filter((p) => p.type === "page");
  }

  // ─── 对话操作 ───────────────────────────────

  /** 创建新对话 (⌘⇧L), 带重试验证 */
  async newConversation(): Promise<ConversationInfo> {
    const maxRetries = 3;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      if (this._humanize) await microPause();

      // Electron 快捷键需要窗口在 OS 层面激活
      await this.page.bringToFront();
      await sleep(200);
      await this.page.keyboard.press(Keys.NEW_CONVERSATION);

      if (this._humanize) {
        await humanDelay(0.8, 1.5);
      } else {
        await sleep(500);
      }

      // 验证: 新对话 = 欢迎页可见 (有 "See all" 或 "Ask anything" 文本)
      const isNewConv = await this.page.evaluate(() => {
        let found = false;
        document.querySelectorAll("*").forEach((el: Element) => {
          const text = (el.textContent || "").trim().toLowerCase();
          if (
            (text === "see all" || text.startsWith("ask anything")) &&
            el.children.length === 0
          ) {
            found = true;
          }
        });
        return found;
      });

      if (isNewConv) {
        break; // 成功 — 欢迎页可见，确认是新对话
      }

      // 失败: 没看到欢迎页，说明快捷键没生效或仍在旧对话
      if (attempt < maxRetries) {
        console.warn(
          `[ag] newConversation attempt ${attempt} failed (welcome page not visible), retrying...`,
        );
        await sleep(1000);
      } else {
        console.warn(
          `[ag] newConversation failed after ${maxRetries} attempts (welcome page not visible)`,
        );
      }
    }

    const conv: ConversationInfo = {
      title: "",
      pageTitle: this._pageTitle,
      createdAt: Date.now(),
    };
    this.conversations.push(conv);
    this.currentConv = conv;
    return conv;
  }

  /** 列出历史对话 */
  async listConversations(): Promise<{ id: string; title?: string }[]> {
    // 1. 确保在空对话状态以便看到 See all
    await this.newConversation();
    await sleep(this._humanize ? 1000 : 500); // UI 渲染需要点时间

    const pg = this.page;
    await pg.evaluate(() => {
      document.querySelectorAll("*").forEach((el: Element) => {
        const text = (el.textContent || "").trim().toLowerCase();
        if (
          (text === "see all" || text.includes("past conversation")) &&
          el.children.length === 0
        ) {
          (el as HTMLElement).click();
        }
      });
    });

    await sleep(1000); // 等待列表弹出

    const lists = await pg.evaluate(() => {
      const items: { id: string; title: string }[] = [];
      document.querySelectorAll("*").forEach((el: Element) => {
        if ((el as HTMLElement).classList.contains("truncate")) {
          const text = (el.textContent || "").trim();
          if (text.length > 0) {
            items.push({ id: text, title: text });
          }
        }
      });
      return items;
    });

    // 退出列表
    await pg.keyboard.press("Escape");
    await sleep(500);

    return lists;
  }

  /** 切换到指定历史对话 */
  async switchToConversation(id: string): Promise<void> {
    // 1. 确保在空对话状态以便看到 See all
    await this.newConversation();
    await sleep(this._humanize ? 1000 : 500);

    const pg = this.page;
    await pg.evaluate(() => {
      document.querySelectorAll("*").forEach((el: Element) => {
        const text = (el.textContent || "").trim().toLowerCase();
        if (
          (text === "see all" || text.includes("past conversation")) &&
          el.children.length === 0
        ) {
          (el as HTMLElement).click();
        }
      });
    });

    await sleep(1000); // 等待列表弹出

    const clicked = await pg.evaluate((targetId) => {
      let found = false;
      document.querySelectorAll("*").forEach((el: Element) => {
        const text = (el.textContent || "").trim();
        if (
          text === targetId &&
          (el as HTMLElement).classList.contains("truncate")
        ) {
          let clickable: HTMLElement | null = el as HTMLElement;
          // 向上找最近的区块作为点击区域
          while (
            clickable &&
            clickable.tagName !== "DIV" &&
            clickable.parentElement
          ) {
            clickable = clickable.parentElement;
          }
          clickable.click();
          found = true;
        }
      });
      return found;
    }, id);

    if (!clicked) {
      await pg.keyboard.press("Escape");
      throw new Error(`Conversation not found: ${id}`);
    }

    await sleep(1500); // 等待新对话渲染完成
  }

  /**
   * 发送消息并等待完整回复
   *
   * 核心流程:
   *   1. Snapshot panel (before)
   *   2. 输入并发送消息
   *   3. 状态机循环: GENERATING → WAITING_APPROVAL → ... → IDLE
   *   4. Snapshot panel (after), diff 得到回复
   */
  async chat(
    message: string,
    options: {
      autoAccept?: boolean;
      timeout?: number;
      pollInterval?: number;
      idleThreshold?: number;
      maxRetries?: number;
    } = {},
  ): Promise<ChatResult> {
    const pg = this.page; // throws if not connected

    const autoAccept = options.autoAccept ?? true;
    const timeout = options.timeout ?? 300;
    const pollInterval = options.pollInterval ?? 2000;
    const _idleThreshold = options.idleThreshold ?? 3000;
    const maxRetries = options.maxRetries ?? 2;

    const start = Date.now();
    let approvals = 0;
    let retries = 0;
    let steps = 0;

    // 1. 激活窗口
    await pg.bringToFront();
    await focusChatInput(pg, this._humanize);
    if (this._humanize) await microPause();

    if (this._humanize) {
      if (message.length > 200) {
        await humanTypeFast(pg, message);
      } else {
        await humanType(pg, message);
      }
    } else {
      await pg.keyboard.type(message, { delay: 10 });
    }

    if (this.currentConv) {
      this.currentConv.title = message.slice(0, 60);
    }

    if (this._humanize) await humanDelay(0.3, 0.8);

    await pg.keyboard.press(Keys.SEND_MESSAGE);
    // 发送后等 1s，模拟正常人节奏，给 IDE 时间处理消息
    await sleep(1000);

    // 2. 等 Send 按钮出现 (AI 完成) 或 Accept 按钮出现 (需要审批)
    //    Send 按钮消失不是必然的 — AI 回复太快的话 Send 可能根本没消失过。
    //    所以不再检测 "Send 消失再出现"，直接等 Send 出现即可。
    while (Date.now() - start < timeout * 1000) {
      const state = await detectState(pg);
      steps++;

      if (state === AgentState.WAITING_APPROVAL) {
        if (autoAccept) {
          await clickAccept(pg);
          approvals++;
          await sleep(1000);
          continue;
        } else {
          const afterSnapshot = await snapshotPanel(pg);
          return {
            snapshot: afterSnapshot,
            state: "waiting_approval",
            elapsed: (Date.now() - start) / 1000,
            steps,
            approvals,
            retries,
          };
        }
      }

      if (state === AgentState.ERROR_TERMINATED) {
        retries++;
        if (retries <= maxRetries) {
          console.warn(
            `[ag] Agent terminated with error, retrying (${retries}/${maxRetries})...`,
          );
          await clickRetry(pg);
          await sleep(2000); // 等 Retry 启动
          continue;
        }
        // 超过最大重试次数 → 返回 error
        const afterSnapshot = await snapshotPanel(pg);
        return {
          snapshot: afterSnapshot,
          state: "error",
          elapsed: (Date.now() - start) / 1000,
          steps,
          approvals,
          retries,
        };
      }

      if (state === AgentState.IDLE) {
        // Send 按钮出现 → AI 完成，等 200ms 让面板 DOM 渲染完毕
        await sleep(200);
        break;
      }

      // GENERATING — 继续等
      await sleep(pollInterval);
    }

    // 4. 快照面板 (response = fullPanel = 全量快照, 仅用于 debug/日志)
    const afterSnapshot = await snapshotPanel(pg);
    const elapsed = (Date.now() - start) / 1000;
    const isTimeout = elapsed >= timeout;

    return {
      snapshot: afterSnapshot,
      state: isTimeout ? "timeout" : "done",
      elapsed,
      steps,
      approvals,
      retries,
    };
  }

  /**
   * 等待 AI 回复完成 (不发送消息)
   *
   * 用于断点续传: prompt 已发出，只需等待 AI 完成并收取快照。
   * 复用 chat() 的状态机循环，跳过输入/发送阶段。
   */
  async waitForIdle(
    options: {
      autoAccept?: boolean;
      timeout?: number;
      pollInterval?: number;
    } = {},
  ): Promise<ChatResult> {
    const pg = this.page;
    const autoAccept = options.autoAccept ?? true;
    const timeout = options.timeout ?? 300;
    const pollInterval = options.pollInterval ?? 2000;

    const start = Date.now();
    let approvals = 0;
    let retries = 0;
    let steps = 0;

    while (Date.now() - start < timeout * 1000) {
      const state = await detectState(pg);
      steps++;

      if (state === AgentState.WAITING_APPROVAL) {
        if (autoAccept) {
          await clickAccept(pg);
          approvals++;
          await sleep(1000);
          continue;
        } else {
          const snapshot = await snapshotPanel(pg);
          return {
            snapshot,
            state: "waiting_approval",
            elapsed: (Date.now() - start) / 1000,
            steps,
            approvals,
            retries,
          };
        }
      }

      if (state === AgentState.ERROR_TERMINATED) {
        retries++;
        if (retries <= 2) {
          await clickRetry(pg);
          await sleep(2000);
          continue;
        }
        const snapshot = await snapshotPanel(pg);
        return {
          snapshot,
          state: "error",
          elapsed: (Date.now() - start) / 1000,
          steps,
          approvals,
          retries,
        };
      }

      if (state === AgentState.IDLE) {
        await sleep(200);
        break;
      }

      await sleep(pollInterval);
    }

    const snapshot = await snapshotPanel(pg);
    const elapsed = (Date.now() - start) / 1000;

    return {
      snapshot,
      state: elapsed >= timeout ? "timeout" : "done",
      elapsed,
      steps,
      approvals,
      retries,
    };
  }

  /** 停止当前生成 */
  async stop(): Promise<void> {
    await this.page.keyboard.press(Keys.STOP_GENERATION);
  }

  /** 截屏 */
  async screenshot(path: string = "/tmp/ag_screenshot.png"): Promise<string> {
    await this.page.screenshot({ path });
    return path;
  }

  /** 在页面中执行 JavaScript */
  async evalJS<T>(fn: () => T): Promise<T> {
    return this.page.evaluate(fn);
  }

  // ─── Private ────────────────────────────────

  private async listPagesHTTP(): Promise<CDPPageInfo[]> {
    const url = `${this.endpointUrl}/json`;
    const res = await fetch(url);
    return res.json() as Promise<CDPPageInfo[]>;
  }
}
