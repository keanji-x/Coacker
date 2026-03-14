/**
 * @coacker/shared — TOML 配置加载
 *
 * 读取 config.toml，缓存单例。
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseToml } from 'smol-toml';
import type { CoasterConfig } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** 默认配置路径: 项目根 config.toml */
const DEFAULT_CONFIG_PATH = resolve(__dirname, '..', '..', '..', 'config.toml');

let _cached: CoasterConfig | null = null;

/**
 * 加载配置文件 (单例缓存)
 * @param path 配置文件路径，默认 Coacker/config.toml
 */
export function loadConfig(path?: string): CoasterConfig {
  if (_cached) return _cached;

  const configPath = path ?? DEFAULT_CONFIG_PATH;
  const raw = readFileSync(configPath, 'utf-8');
  _cached = parseToml(raw) as unknown as CoasterConfig;
  return _cached;
}

/** 重置缓存 (测试用) */
export function resetConfig(): void {
  _cached = null;
}

/** 获取 Backend 配置 */
export function getBackendConfig(config?: CoasterConfig): Required<CoasterConfig>['backend'] {
  const cfg = config ?? loadConfig();
  return {
    type: 'ag',
    ag: {
      endpointUrl: 'http://localhost:9222',
      timeout: 30_000,
      humanize: true,
      windowTitle: '',
      ...cfg.backend?.ag,
    },
    ...cfg.backend,
  };
}

/** 获取 Brain 配置 */
export function getBrainConfig(config?: CoasterConfig): Required<CoasterConfig>['brain'] {
  const cfg = config ?? loadConfig();
  return {
    type: 'audit',
    audit: {
      maxGapRounds: 2,
      maxSubTasks: 20,
      projectRoot: '.',
      entryFile: '',
      userIntent: 'Comprehensive code review',
      ...cfg.brain?.audit,
    },
    ...cfg.brain,
  };
}

/** 获取 Player 配置 */
export function getPlayerConfig(config?: CoasterConfig): Required<CoasterConfig>['player'] {
  const cfg = config ?? loadConfig();
  return {
    taskTimeout: 300,
    skillsDir: './skills',
    ...cfg.player,
  };
}

/** 获取 Knowledge 配置 */
export function getKnowledgeConfig(config?: CoasterConfig): Required<CoasterConfig>['knowledge'] {
  const cfg = config ?? loadConfig();
  return {
    storeDir: './knowledge',
    maxEntrySize: 50_000,
    ...cfg.knowledge,
  };
}
