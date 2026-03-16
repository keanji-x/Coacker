/**
 * E2E 测试: MockBackend 验证全流程
 *
 * 执行: cd /Users/jianxie/Desktop/Coacker && npx tsx packages/cli/tests/e2e-mock.test.ts
 */

import { MockBackend } from '@coacker/backend';
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
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const OUTPUT_DIR = '/tmp/coacker-e2e-test-output';

async function main() {
  console.log('=== E2E Test: MockBackend ===\n');

  const backend = new MockBackend([
    // 1. Intention
    {
      response: `I analyzed the project.\n\n[\n  {"id": "config_review", "intention": "Review configuration loading and validation"}\n]`,
      state: 'done',
      delay: 50,
    },
    // 2. SubTask impl
    {
      response: `## Implementation Analysis\n\nThe config module loads TOML files using smol-toml parser. It uses singleton caching.\n\n### Key Functions\n- \`loadConfig()\`: reads config.toml, caches result\n- \`getBackendConfig()\`: merges defaults with user config`,
      state: 'done',
      delay: 50,
    },
    // 3. SubTask review
    {
      response: `## Code Review\n\n**Warning**: Config spread order may cause nested defaults to be overwritten.\n**Info**: No input validation on TOML values.`,
      state: 'done',
      delay: 50,
    },
    // 4. SubTask attack
    {
      response: `## Attack Findings\n\n**Medium**: Singleton cache never invalidated - stale config after file changes.`,
      state: 'done',
      delay: 50,
    },
    // 5. Gap analysis
    {
      response: `{"completeness_score": 9, "gaps": [], "duplicates": []}`,
      state: 'done',
      delay: 50,
    },
    // 6. Consolidation
    {
      response: `## Executive Summary\n\nThe codebase shows reasonable structure with a few configuration handling concerns.\n\n## Top Issues\n1. **Medium** - Config override bug in spread order\n2. **Low** - No TOML validation`,
      state: 'done',
      delay: 50,
    },
  ]);

  const player = new Player({
    backend,
    taskTimeout: 60,
    rolePrompts: {
      intention: INTENTION_SYSTEM_PROMPT,
      implementer: IMPLEMENTATION_SYSTEM_PROMPT,
      reviewer: REVIEWER_SYSTEM_PROMPT,
      attacker: ATTACKER_SYSTEM_PROMPT,
      gap_analyzer: GAP_ANALYZER_SYSTEM_PROMPT,
      consolidator: CONSOLIDATION_SYSTEM_PROMPT,
    },
  });

  const brain = new Brain({
    project: {
      root: '.',
      entry: 'packages/shared/src/config.ts',
      intent: 'Review the Coacker config system',
    },
    audit: {
      maxGapRounds: 1,
      maxSubTasks: 3,
    },
    output: {
      dir: OUTPUT_DIR,
    },
  });

  const title = await player.connect();
  console.log(`✅ Connected to: ${title}`);

  const report = await brain.run(player);

  // ─── Output ───
  console.log('\n--- Report ---');
  console.log(`Tasks: ${report.tasks.length}`);
  for (const t of report.tasks) {
    console.log(`  [${t.taskId}] impl:${t.implementation.length}c review:${t.codeReview.length}c attack:${t.attackReview.length}c`);
  }

  console.log('\n--- Stats ---');
  console.log(`Conversations: ${backend.conversationCount}, Chats: ${backend.chatHistory.length}`);
  console.log(`Brain phase: ${brain.phase}, History: ${brain.history.length}`);

  await player.disconnect();

  // ─── Assertions ───
  const ok = (cond: boolean, msg: string) => {
    if (cond) console.log(`  ✅ ${msg}`);
    else { console.log(`  ❌ FAIL: ${msg}`); process.exitCode = 1; }
  };

  console.log('\n--- Assertions ---');
  ok(report.tasks.length === 1, `Tasks: ${report.tasks.length} (expected 1)`);
  ok(report.tasks[0]?.implementation.length > 0, 'Implementation not empty');
  ok(report.tasks[0]?.codeReview.length > 0, 'Code review not empty');
  ok(report.tasks[0]?.attackReview.length > 0, 'Attack review not empty');
  ok(report.executiveSummary.length > 0, 'Executive summary not empty');
  ok(brain.phase === 'done', `Phase: ${brain.phase}`);
  ok(backend.conversationCount === 4, `Conversations: ${backend.conversationCount} (expected 4)`);
  ok(backend.chatHistory.length === 6, `Chats: ${backend.chatHistory.length} (expected 6)`);
  ok(brain.history.length === 4, `History: ${brain.history.length} (expected 4)`);

  // 持久化验证
  ok(existsSync(join(OUTPUT_DIR, 'state.json')), 'state.json exists');
  ok(existsSync(join(OUTPUT_DIR, 'history.json')), 'history.json exists');
  ok(existsSync(join(OUTPUT_DIR, 'reports', 'config_review.json')), 'reports/config_review.json exists');
  ok(existsSync(join(OUTPUT_DIR, 'audit-report.md')), 'audit-report.md exists');

  // 验证 state.json 内容
  const state = JSON.parse(readFileSync(join(OUTPUT_DIR, 'state.json'), 'utf-8'));
  ok(state.phase === 'done', `state.json phase: ${state.phase}`);
  ok(state.subtasks.length === 1, `state.json subtasks: ${state.subtasks.length}`);
  ok(state.historyCount === 4, `state.json historyCount: ${state.historyCount}`);

  console.log('\n=== Done ===');
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
