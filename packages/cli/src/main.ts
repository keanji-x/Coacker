#!/usr/bin/env npx tsx
/**
 * @coacker/cli — 入口
 *
 * Usage:
 *   npx tsx ts/packages/cli/src/main.ts
 */

import { AgBackend } from '@coacker/backend';
import { Brain } from '@coacker/brain';
import { Player } from '@coacker/player';
import {
  logger,
  loadConfig,
  getBackendConfig,
  getBrainConfig,
  getPlayerConfig,
  getKnowledgeConfig,
} from '@coacker/shared';

async function main() {
  const args = process.argv.slice(2);

  // 读取配置
  const cfg = loadConfig();
  const backendCfg = getBackendConfig(cfg);
  const brainCfg = getBrainConfig(cfg);
  const playerCfg = getPlayerConfig(cfg);
  const knowledgeCfg = getKnowledgeConfig(cfg);

  const intent = args.join(' ') || brainCfg.audit?.userIntent || 'Comprehensive code review';

  logger.info('Coacker starting...');
  logger.info(`Intent: ${intent}`);

  // 1. 创建 Backend (AG/CDP)
  const backend = new AgBackend({
    endpointUrl: backendCfg.ag?.endpointUrl,
    timeout: backendCfg.ag?.timeout,
    humanize: backendCfg.ag?.humanize,
    windowTitle: backendCfg.ag?.windowTitle,
  });

  // 2. 创建 Player (注入 Backend)
  const player = new Player({
    backend,
    skillsDir: playerCfg.skillsDir,
    taskTimeout: playerCfg.taskTimeout,
  });

  // 3. 创建 Brain
  const brain = new Brain({
    knowledgeDir: knowledgeCfg.storeDir,
    audit: brainCfg.audit,
  });

  // 4. 连接
  const pageTitle = await player.connect();
  logger.info(`Connected to: ${pageTitle}`);

  try {
    // 5. 创建初始任务
    brain.dispatcher.createTask('intention', intent, {
      id: 'intention',
      context: {
        userIntent: intent,
        projectRoot: brainCfg.audit?.projectRoot || process.cwd(),
        entryFile: brainCfg.audit?.entryFile,
      },
    });

    // 6. 运行
    const results = await brain.run(player);

    // 7. 输出结果
    logger.info(`\n📊 Results: ${results.length} tasks completed`);
    for (const r of results) {
      const icon = r.status === 'success' ? '✅' : '❌';
      logger.info(`  ${icon} ${r.taskId} (${r.type}) — ${r.elapsed.toFixed(1)}s`);
    }

    logger.info(`\n📚 Knowledge: ${brain.knowledge.size} entries`);

  } finally {
    await player.disconnect();
  }
}

main().catch(err => {
  logger.error('Fatal error', err);
  process.exit(1);
});
