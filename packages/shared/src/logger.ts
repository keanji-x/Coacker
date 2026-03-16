/**
 * @coacker/shared — 统一日志
 *
 * 轻量日志封装，支持 level 过滤和彩色输出。
 */

import type { LogLevel } from "./types.js";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const LEVEL_COLORS: Record<LogLevel, string> = {
  debug: "\x1b[90m", // gray
  info: "\x1b[36m", // cyan
  warn: "\x1b[33m", // yellow
  error: "\x1b[31m", // red
};

const RESET = "\x1b[0m";

export class Logger {
  private minLevel: number;
  private prefix: string;

  constructor(prefix: string = "", minLevel: LogLevel = "info") {
    this.prefix = prefix ? `[${prefix}]` : "";
    this.minLevel = LEVEL_ORDER[minLevel];
  }

  private log(level: LogLevel, message: string, data?: unknown): void {
    if (LEVEL_ORDER[level] < this.minLevel) return;

    const color = LEVEL_COLORS[level];
    const tag = level.toUpperCase().padEnd(5);
    const ts = new Date().toISOString().slice(11, 23); // HH:mm:ss.SSS
    const line = `${color}${ts} ${tag}${RESET} ${this.prefix} ${message}`;

    if (level === "error") {
      console.error(line, data !== undefined ? data : "");
    } else {
      console.log(line, data !== undefined ? data : "");
    }
  }

  debug(message: string, data?: unknown): void {
    this.log("debug", message, data);
  }
  info(message: string, data?: unknown): void {
    this.log("info", message, data);
  }
  warn(message: string, data?: unknown): void {
    this.log("warn", message, data);
  }
  error(message: string, data?: unknown): void {
    this.log("error", message, data);
  }

  /** 创建子 Logger (追加 prefix) */
  child(prefix: string): Logger {
    const combined = this.prefix
      ? `${this.prefix.slice(1, -1)}:${prefix}`
      : prefix;
    const logger = new Logger(combined);
    logger.minLevel = this.minLevel;
    return logger;
  }
}

/** 全局 Logger 实例 */
export const logger = new Logger("coacker");
