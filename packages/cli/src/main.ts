#!/usr/bin/env npx tsx
/**
 * @coacker/cli — 入口
 *
 * Usage:
 *   npx tsx packages/cli/src/main.ts [intent]
 */

import { AgBackend, ClaudeCodeBackend, createToolkit } from "@coacker/backend";
import type { Backend, Toolkit } from "@coacker/backend";
import { execSync } from "node:child_process";
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
  logger.info(`Backend type: ${backendCfg.type}`);
  logger.info(`Intent: ${intent}`);
  logger.info(`Entry: ${projectCfg.entry}`);
  logger.info(`Origin: ${projectCfg.origin || "(not set — issues disabled)"}`);
  logger.info(`Output: ${outputCfg.dir}`);

  // 获取当前 git commit SHA (审计可溯源)
  const commitSha = getCommitSha(projectCfg.root);

  // 1. 创建 Backend (根据配置类型)
  const backend = createBackendFromConfig(backendCfg, projectCfg.root);

  // 2. 创建 Toolkit (可选)
  let toolkit: Toolkit | undefined;
  if (backendCfg.toolkit) {
    const tkCfg = backendCfg.toolkit;
    const toolkitConfig: Record<string, unknown> = {};

    // AST: 支持单语言 (languagePath) 和多语言 (languages) 两种配置
    if (tkCfg.ast) {
      if ("languages" in tkCfg.ast && tkCfg.ast.languages) {
        toolkitConfig.ast = { languages: tkCfg.ast.languages };
      } else if ("languagePath" in tkCfg.ast && tkCfg.ast.languagePath) {
        toolkitConfig.ast = { languagePath: tkCfg.ast.languagePath };
      }
    }

    if (tkCfg.mcp?.command) toolkitConfig.mcp = { command: tkCfg.mcp.command, args: tkCfg.mcp.args ?? [] };
    if (tkCfg.sandbox) toolkitConfig.sandbox = { baseDir: tkCfg.sandbox.baseDir, allowedCommands: tkCfg.sandbox.allowedCommands };
    if (tkCfg.repoMap) toolkitConfig.repoMap = tkCfg.repoMap;

    if (Object.keys(toolkitConfig).length > 0) {
      toolkit = await createToolkit(
        toolkitConfig as Parameters<typeof createToolkit>[0],
        projectCfg.root,
      );
      logger.info(`Toolkit: ${Object.keys(toolkitConfig).join(", ")}`);
    }
  }

  // 3. 根据 brain type 分发
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

    const validate = brainCfg.validate;
    const brain = new ValidateBrain({
      project: { root: projectCfg.root, origin: projectCfg.origin },
      validate: {
        maxReviewAttempts: validate.maxReviewAttempts,
        excludeLabels: validate.excludeLabels,
        draftOnFailure: validate.draftOnFailure,
        sast: validate.sast,
      },
      output: outputCfg,
      toolkit,
    });

    const connInfo = await player.connect(
      backendCfg.type === "ag" ? backendCfg.ag?.windowTitle : undefined,
    );
    logger.info(`Connected to: ${connInfo}`);

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
        issue_proposer: ISSUE_PROPOSER_SYSTEM_PROMPT(projectCfg.origin || "", commitSha),
        gap_analyzer: GAP_ANALYZER_SYSTEM_PROMPT,
        consolidator: CONSOLIDATION_SYSTEM_PROMPT,
      },
    });

    const audit = brainCfg.audit;
    const brain = new Brain({
      project: { ...projectCfg, intent },
      audit: {
        maxGapRounds: audit.maxGapRounds,
        maxSubTasks: audit.maxSubTasks,
        spinBreaker: audit.spinBreaker,
        knowledgeDir: audit.knowledgeDir,
      },
      output: outputCfg,
      toolkit,
    });

    const connInfo = await player.connect(
      backendCfg.type === "ag" ? backendCfg.ag?.windowTitle : undefined,
    );
    logger.info(`Connected to: ${connInfo}`);

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

// ── Backend 工厂 ──

function createBackendFromConfig(
  backendCfg: ReturnType<typeof getBackendConfig>,
  projectRoot: string,
): Backend {
  switch (backendCfg.type) {
    case "claude-code": {
      const cc = backendCfg.claudeCode;
      return new ClaudeCodeBackend({
        model: cc.model || undefined,
        tools: cc.tools,
        permissionMode: cc.permissionMode,
        claudeBinary: cc.claudeBinary,
        cwd: cc.cwd || projectRoot,
      });
    }
    case "ag":
    default:
      return new AgBackend({
        endpointUrl: backendCfg.ag?.endpointUrl,
        timeout: backendCfg.ag?.timeout,
        humanize: backendCfg.ag?.humanize,
        windowTitle: backendCfg.ag?.windowTitle,
      });
  }
}

// ── Git Helpers ──

/**
 * 获取当前 git commit SHA (short, 8 chars)
 * 失败时返回 undefined (non-git 仓库或没有任何 commit)
 */
function getCommitSha(cwd: string): string | undefined {
  try {
    return execSync("git rev-parse --short=8 HEAD", {
      cwd,
      encoding: "utf-8",
      timeout: 3000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return undefined;
  }
}

main().catch((err) => {
  logger.error("Fatal error", err);
  process.exit(1);
});
