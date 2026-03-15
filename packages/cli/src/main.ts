#!/usr/bin/env npx tsx
/**
 * @coacker/cli — 入口
 *
 * Usage:
 *   npx tsx packages/cli/src/main.ts [intent]
 */

import { AgBackend } from '@coacker/backend';
import { Brain } from '@coacker/brain';
import {
  INTENTION_SYSTEM_PROMPT,
  IMPLEMENTATION_SYSTEM_PROMPT,
  REVIEWER_SYSTEM_PROMPT,
  ATTACKER_SYSTEM_PROMPT,
  GAP_ANALYZER_SYSTEM_PROMPT,
  CONSOLIDATION_SYSTEM_PROMPT,
} from '@coacker/brain';
import { Player } from '@coacker/player';
import {
  logger,
  loadConfig,
  getBackendConfig,
  getBrainConfig,
  getPlayerConfig,
  getProjectConfig,
  getOutputConfig,
} from '@coacker/shared';

async function main() {
  const args = process.argv.slice(2);

  // 读取配置 (config.toml 是唯一的真相源)
  const cfg = loadConfig();
  const projectCfg = getProjectConfig(cfg);
  const outputCfg = getOutputConfig(cfg);
  const backendCfg = getBackendConfig(cfg);
  const brainCfg = getBrainConfig(cfg);
  const playerCfg = getPlayerConfig(cfg);

  // CLI 参数覆盖 intent
  const intent = args.length > 0 ? args.join(' ') : projectCfg.intent;

  logger.info('Coacker starting...');
  logger.info(`Intent: ${intent}`);
  logger.info(`Entry: ${projectCfg.entry}`);
  logger.info(`Output: ${outputCfg.dir}`);

  // 1. 创建 Backend
  const backend = new AgBackend({
    endpointUrl: backendCfg.ag?.endpointUrl,
    timeout: backendCfg.ag?.timeout,
    humanize: backendCfg.ag?.humanize,
    windowTitle: backendCfg.ag?.windowTitle,
  });

  // 2. 创建 Player
  const player = new Player({
    backend,
    taskTimeout: playerCfg.taskTimeout,
    rolePrompts: {
      intention: INTENTION_SYSTEM_PROMPT.replace('{{MAX_TASKS}}', String(brainCfg.audit?.maxSubTasks ?? 20)),
      implementer: IMPLEMENTATION_SYSTEM_PROMPT,
      reviewer: REVIEWER_SYSTEM_PROMPT,
      attacker: ATTACKER_SYSTEM_PROMPT,
      gap_analyzer: GAP_ANALYZER_SYSTEM_PROMPT,
      consolidator: CONSOLIDATION_SYSTEM_PROMPT,
    },
  });

  // 3. 创建 Brain (配置驱动 — 所有持久化由 Brain 自动完成)
  const audit = brainCfg.audit!;
  const brain = new Brain({
    project: { ...projectCfg, intent },
    audit: {
      maxGapRounds: audit.maxGapRounds!,
      maxSubTasks: audit.maxSubTasks!,
    },
    output: outputCfg,
  });

  // 4. 连接
  const pageTitle = await player.connect(backendCfg.ag?.windowTitle);
  logger.info(`Connected to: ${pageTitle}`);

  try {
    // 5. 运行 (Brain 自动持久化 state/history/reports/report.md)
    const report = await brain.run(player);

    // 6. 输出摘要
    logger.info(`\n📊 Tasks analyzed: ${report.tasks.length}`);
    for (const t of report.tasks) {
      logger.info(`  📋 [${t.taskId}] ${t.intention.slice(0, 60)}`);
    }
    logger.info(`\n📁 All results saved to: ${outputCfg.dir}`);

  } finally {
    await player.disconnect();
  }
}

main().catch(err => {
  logger.error('Fatal error', err);
  process.exit(1);
});
