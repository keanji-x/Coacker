/**
 * E2E 测试: MockBackend 验证 ValidateBrain 全流程
 *
 * 模拟场景:
 *   Issue #1: understand → test gen → review REJECT → retry → review ACCEPT → PR create
 *   Issue #2: understand → marked untestable
 *
 * 执行: cd /home/kenji/Coacker && npx tsx packages/cli/tests/e2e-validate-mock.test.ts
 */

import { MockBackend } from "@coacker/backend";
import {
  ValidateBrain,
  ISSUE_ANALYST_SYSTEM_PROMPT,
  TEST_GENERATOR_SYSTEM_PROMPT,
  TEST_REVIEWER_SYSTEM_PROMPT,
} from "@coacker/brain";
import type { IssueItem } from "@coacker/brain";
import { Player } from "@coacker/player";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const OUTPUT_DIR = "/tmp/coacker-e2e-validate-test-output";

async function main() {
  console.log("=== E2E Test: ValidateBrain with MockBackend ===\n");

  const backend = new MockBackend([
    // ── Issue #1 ──

    // 1. Understanding (analyst)
    {
      snapshot: JSON.stringify({
        summary: "Config spread order causes nested defaults to be overwritten",
        scope: "packages/shared/src/config.ts",
        expected_vs_actual:
          "Expected: nested config preserves defaults. Actual: spread overwrites.",
        test_targets: ["loadConfig", "getBackendConfig"],
        testable: true,
      }),
      state: "done",
      delay: 50,
    },
    // 2. Test generation (generator)
    {
      snapshot: `import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/config';

describe('Config spread order', () => {
  it('should preserve nested defaults when user provides partial config', () => {
    const config = loadConfig();
    expect(config.backend?.ag?.timeout).toBeDefined();
  });
});

// Test output: 1 passed, 0 failed`,
      state: "done",
      delay: 50,
    },
    // 3. Review #1: REJECT
    {
      snapshot: JSON.stringify({
        verdict: "REJECT",
        logic_review:
          "Test only checks if timeout is defined, does not test the actual spread order bug",
        audit_review: "Assertions are too weak — need to test specific values",
        verification: "Test passes but does not validate the reported issue",
        issues: [
          "Does not test partial config override behavior",
          "No edge case for nested spread",
        ],
        summary:
          "Test is trivial and does not actually validate the reported bug",
      }),
      state: "done",
      delay: 50,
    },
    // 4. Retry: Re-understand with feedback (analyst)
    {
      snapshot: JSON.stringify({
        summary:
          "Config spread order bug: when user provides partial nested config, defaults get lost",
        scope: "packages/shared/src/config.ts - getBackendConfig()",
        expected_vs_actual:
          "Expected: {endpointUrl: user, timeout: default}. Actual: {endpointUrl: user, timeout: undefined}",
        test_targets: ["getBackendConfig with partial ag config"],
        testable: true,
      }),
      state: "done",
      delay: 50,
    },
    // 5. Retry: Improved test generation (generator)
    {
      snapshot: `import { describe, it, expect } from 'vitest';
import { getBackendConfig } from '../src/config';

describe('Config spread order bug', () => {
  it('should preserve default timeout when user only sets endpointUrl', () => {
    const config = getBackendConfig({
      backend: { ag: { endpointUrl: 'http://custom:9222' } }
    });
    expect(config.ag.endpointUrl).toBe('http://custom:9222');
    expect(config.ag.timeout).toBe(30000); // default should survive
  });
});

// Test output: 1 passed, 0 failed`,
      state: "done",
      delay: 50,
    },
    // 6. Review #2: ACCEPT
    {
      snapshot: JSON.stringify({
        verdict: "ACCEPT",
        logic_review:
          "Test correctly validates partial config override preserves defaults",
        audit_review: "Good assertions on both user value and default value",
        verification: "Test passes and correctly validates the behavior",
        issues: [],
        summary: "Test adequately validates the reported spread order bug",
      }),
      state: "done",
      delay: 50,
    },
    // 7. PR Create
    {
      snapshot:
        "Created PR: https://github.com/test/repo/pull/42\nBranch: test/validate-issue-1",
      state: "done",
      delay: 50,
    },

    // ── Issue #2 ──

    // 8. Understanding: untestable
    {
      snapshot: JSON.stringify({
        summary: "UI rendering issue in dark mode",
        scope: "frontend/components/theme.tsx",
        expected_vs_actual: "Dark mode colors are wrong on mobile Safari",
        test_targets: [],
        testable: false,
        untestable_reason:
          "Browser-specific rendering issue requires visual testing on actual mobile Safari device",
      }),
      state: "done",
      delay: 50,
    },
    // 9. Test gen (won't reach for untestable issue, but MockBackend needs something in queue)
    {
      snapshot: '{"untestable": true, "reason": "Not reachable"}',
      state: "done",
      delay: 50,
    },
  ]);

  const player = new Player({
    backend,
    taskTimeout: 60,
    rolePrompts: {
      issue_analyst: ISSUE_ANALYST_SYSTEM_PROMPT,
      test_generator: TEST_GENERATOR_SYSTEM_PROMPT,
      test_reviewer: TEST_REVIEWER_SYSTEM_PROMPT,
      pr_creator: "You create PRs.",
    },
  });

  const brain = new ValidateBrain({
    project: {
      root: ".",
      origin: "test/repo",
    },
    validate: {
      maxReviewAttempts: 3,
      excludeLabels: ["wontfix", "duplicate", "invalid"],
      draftOnFailure: true,
    },
    output: {
      dir: OUTPUT_DIR,
    },
  });

  // 注入测试 issues (不走 GitHub API)
  const testIssues: IssueItem[] = [
    {
      number: 1,
      title: "Config spread order overwrites nested defaults",
      body: "When providing partial nested config, the spread operator overwrites all defaults.",
      labels: ["bug"],
    },
    {
      number: 2,
      title: "Dark mode rendering broken on mobile Safari",
      body: "Colors appear wrong in dark mode when using mobile Safari.",
      labels: ["bug", "ui"],
    },
  ];

  const title = await player.connect();
  console.log(`✅ Connected to: ${title}`);

  const results = await brain.run(player, testIssues);

  // ─── Output ───
  console.log("\n--- Results ---");
  for (const r of results) {
    console.log(
      `  #${r.issueNumber} ${r.issueTitle} → ${r.outcome} (${r.reviewAttempts} attempts)`,
    );
  }

  console.log("\n--- Stats ---");
  console.log(
    `Conversations: ${backend.conversationCount}, Chats: ${backend.chatHistory.length}`,
  );
  console.log(
    `Brain phase: ${brain.phase}, History: ${brain.history.length}`,
  );

  await player.disconnect();

  // ─── Assertions ───
  const ok = (cond: boolean, msg: string) => {
    if (cond) console.log(`  ✅ ${msg}`);
    else {
      console.log(`  ❌ FAIL: ${msg}`);
      process.exitCode = 1;
    }
  };

  console.log("\n--- Assertions ---");
  ok(results.length === 2, `Results: ${results.length} (expected 2)`);

  // Issue #1: accepted after 1 reject + 1 accept
  ok(
    results[0]?.outcome === "accepted",
    `Issue #1 outcome: ${results[0]?.outcome} (expected accepted)`,
  );
  ok(
    results[0]?.reviewAttempts === 2,
    `Issue #1 attempts: ${results[0]?.reviewAttempts} (expected 2)`,
  );

  // Issue #2: untestable
  ok(
    results[1]?.outcome === "untestable",
    `Issue #2 outcome: ${results[1]?.outcome} (expected untestable)`,
  );
  ok(
    results[1]?.reviewAttempts === 0,
    `Issue #2 attempts: ${results[1]?.reviewAttempts} (expected 0)`,
  );

  // Brain state
  ok(brain.phase === "done", `Phase: ${brain.phase}`);

  // Persistence
  const validateDir = join(OUTPUT_DIR, "validate");
  ok(
    existsSync(join(validateDir, "state.json")),
    "validate/state.json exists",
  );
  ok(
    existsSync(join(validateDir, "results", "issue_1.json")),
    "validate/results/issue_1.json exists",
  );
  ok(
    existsSync(join(validateDir, "results", "issue_2.json")),
    "validate/results/issue_2.json exists",
  );
  ok(
    existsSync(join(validateDir, "validate-report.md")),
    "validate/validate-report.md exists",
  );

  // Validate state.json content
  const state = JSON.parse(
    readFileSync(join(validateDir, "state.json"), "utf-8"),
  );
  ok(state.phase === "done", `state.json phase: ${state.phase}`);
  ok(
    state.results.length === 2,
    `state.json results: ${state.results.length}`,
  );

  console.log("\n=== Done ===");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
