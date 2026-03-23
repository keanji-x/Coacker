#!/usr/bin/env npx tsx
/**
 * @coacker/cli — 入口
 *
 * Usage:
 *   npx tsx packages/cli/src/main.ts [intent]
 */

import { AgBackend } from "@coacker/backend";
import { Brain } from "@coacker/brain";
import {
  INTENTION_SYSTEM_PROMPT,
  IMPLEMENTATION_SYSTEM_PROMPT,
  REVIEWER_SYSTEM_PROMPT,
  ATTACKER_SYSTEM_PROMPT,
  ISSUE_PROPOSER_SYSTEM_PROMPT,
  GAP_ANALYZER_SYSTEM_PROMPT,
  CONSOLIDATION_SYSTEM_PROMPT,
} from "@coacker/brain";
import {
  ValidateBrain,
  ISSUE_ANALYST_SYSTEM_PROMPT,
  TEST_GENERATOR_SYSTEM_PROMPT,
  TEST_REVIEWER_SYSTEM_PROMPT,
} from "@coacker/brain";
import { Player } from "@coacker/player";
import {
  logger,
  loadConfig,
  getBackendConfig,
  getBrainConfig,
  getPlayerConfig,
  getProjectConfig,
  getOutputConfig,
} from "@coacker/shared";

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
  const intent = args.length > 0 ? args.join(" ") : projectCfg.intent;

  logger.info("Coacker starting...");
  logger.info(`Brain type: ${brainCfg.type}`);
  logger.info(`Intent: ${intent}`);
  logger.info(`Entry: ${projectCfg.entry}`);
  logger.info(`Origin: ${projectCfg.origin || "(not set — issues disabled)"}`);
  logger.info(`Output: ${outputCfg.dir}`);

  // 1. 创建 Backend
  const backend = new AgBackend({
    endpointUrl: backendCfg.ag?.endpointUrl,
    timeout: backendCfg.ag?.timeout,
    humanize: backendCfg.ag?.humanize,
    windowTitle: backendCfg.ag?.windowTitle,
  });

  // 2. 根据 brain type 分发
  if (brainCfg.type === "validate") {
    // ── Validate Brain ──
    const player = new Player({
      backend,
      taskTimeout: playerCfg.taskTimeout,
      rolePrompts: {
        issue_analyst: ISSUE_ANALYST_SYSTEM_PROMPT,
        test_generator: TEST_GENERATOR_SYSTEM_PROMPT,
        test_reviewer: TEST_REVIEWER_SYSTEM_PROMPT,
      },
    });

    const validate = brainCfg.validate!;
    const brain = new ValidateBrain({
      project: { root: projectCfg.root, origin: projectCfg.origin },
      validate: {
        maxReviewAttempts: validate.maxReviewAttempts!,
        excludeLabels: validate.excludeLabels!,
        draftOnFailure: validate.draftOnFailure!,
      },
      output: outputCfg,
    });

    const pageTitle = await player.connect(backendCfg.ag?.windowTitle);
    logger.info(`Connected to: ${pageTitle}`);

    try {
      const results = await brain.run(player);

      logger.info(`\n📊 Issues validated: ${results.length}`);
      for (const r of results) {
        const icon =
          r.outcome === "accepted"
            ? "✅"
            : r.outcome === "untestable"
              ? "⏭"
              : r.outcome === "draft"
                ? "📝"
                : "❌";
        logger.info(
          `  ${icon} #${r.issueNumber} ${r.issueTitle} → ${r.outcome}`,
        );
      }
      logger.info(`\n📁 All results saved to: ${outputCfg.dir}/validate`);
    } finally {
      await player.disconnect();
    }
  } else {
    // ── Audit Brain (default) ──
    const player = new Player({
      backend,
      taskTimeout: playerCfg.taskTimeout,
      rolePrompts: {
        intention: INTENTION_SYSTEM_PROMPT,
        implementer: IMPLEMENTATION_SYSTEM_PROMPT,
        reviewer: REVIEWER_SYSTEM_PROMPT,
        attacker: ATTACKER_SYSTEM_PROMPT,
        issue_proposer: ISSUE_PROPOSER_SYSTEM_PROMPT(projectCfg.origin || "", outputCfg.dir),
        gap_analyzer: GAP_ANALYZER_SYSTEM_PROMPT,
        consolidator: CONSOLIDATION_SYSTEM_PROMPT,
      },
    });

    const audit = brainCfg.audit!;
    const brain = new Brain({
      project: { ...projectCfg, intent },
      audit: {
        maxGapRounds: audit.maxGapRounds!,
        maxSubTasks: audit.maxSubTasks!,
      },
      output: outputCfg,
    });

    const pageTitle = await player.connect(backendCfg.ag?.windowTitle);
    logger.info(`Connected to: ${pageTitle}`);

    try {
      const report = await brain.run(player);

      logger.info(`\n📊 Tasks analyzed: ${report.tasks.length}`);
      for (const t of report.tasks) {
        logger.info(`  📋 [${t.taskId}] ${t.intention.slice(0, 60)}`);
      }
      logger.info(`\n📁 All results saved to: ${outputCfg.dir}`);
    } finally {
      await player.disconnect();
    }
  }
}

main().catch((err) => {
  logger.error("Fatal error", err);
  process.exit(1);
});
