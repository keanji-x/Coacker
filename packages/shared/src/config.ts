/**
 * @coacker/shared — TOML 配置加载
 *
 * 读取 config.toml，合并默认值，缓存单例。
 * 默认值**只在这里定义一次**，消费方不再有 fallback。
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseToml } from "smol-toml";
import type {
  CoasterConfig,
  ProjectConfig,
  OutputConfig,
  BackendConfig,
  BrainConfig,
  PlayerConfig,
} from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** 默认配置路径: 项目根 config.toml */
const DEFAULT_CONFIG_PATH = resolve(__dirname, "..", "..", "..", "config.toml");

let _cached: CoasterConfig | null = null;

/**
 * 加载配置文件 (单例缓存)
 */
export function loadConfig(path?: string): CoasterConfig {
  if (_cached) return _cached;

  const configPath = path ?? DEFAULT_CONFIG_PATH;
  const raw = readFileSync(configPath, "utf-8");
  _cached = parseToml(raw) as unknown as CoasterConfig;
  return _cached;
}

/** 重置缓存 (测试用) */
export function resetConfig(): void {
  _cached = null;
}

// ─── 带默认值的 Getter (唯一的默认值来源) ───

/** 获取项目配置 */
export function getProjectConfig(
  config?: CoasterConfig,
): Required<ProjectConfig> {
  const cfg = config ?? loadConfig();
  return {
    root: ".",
    entry: "",
    intent: "Comprehensive code review",
    origin: "",
    ...cfg.project,
  };
}

/** 获取输出配置 */
export function getOutputConfig(
  config?: CoasterConfig,
): Required<OutputConfig> {
  const cfg = config ?? loadConfig();
  return {
    dir: "./output",
    ...cfg.output,
  };
}

/** 获取 Backend 配置 */
export function getBackendConfig(
  config?: CoasterConfig,
): Required<BackendConfig> {
  const cfg = config ?? loadConfig();
  return {
    type: "ag",
    ...cfg.backend,
    ag: {
      endpointUrl: "http://localhost:9222",
      timeout: 30_000,
      humanize: true,
      windowTitle: "",
      ...cfg.backend?.ag,
    },
  };
}

/** 获取 Brain 配置 */
export function getBrainConfig(config?: CoasterConfig): Required<BrainConfig> {
  const cfg = config ?? loadConfig();
  return {
    type: "audit",
    ...cfg.brain,
    audit: {
      maxGapRounds: 2,
      maxSubTasks: 20,
      ...cfg.brain?.audit,
    },
  };
}

/** 获取 Player 配置 */
export function getPlayerConfig(
  config?: CoasterConfig,
): Required<PlayerConfig> {
  const cfg = config ?? loadConfig();
  return {
    taskTimeout: 300,
    ...cfg.player,
  };
}
