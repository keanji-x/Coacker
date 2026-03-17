/**
 * E2E 测试: 完整对话 Flow 审查
 *
 * 使用 MockBackend 运行完整的 AuditBrain 流程,
 * 捕获并输出每轮对话的 prompt 和 response,
 * 验证对话流程的合理性:
 *   - prompt 是否包含文件输出指令 (outputTag)
 *   - 角色 system prompt 是否正确注入
 *   - 步骤顺序是否符合预期
 *   - response 是否被正确传递给下一步
 *
 * 执行: cd /home/kenji/Coacker && npx tsx packages/cli/tests/e2e-flow-review.test.ts
 */

import { MockBackend } from "@coacker/backend";
import {
  Brain,
  INTENTION_SYSTEM_PROMPT,
  IMPLEMENTATION_SYSTEM_PROMPT,
  REVIEWER_SYSTEM_PROMPT,
  ATTACKER_SYSTEM_PROMPT,
  GAP_ANALYZER_SYSTEM_PROMPT,
  CONSOLIDATION_SYSTEM_PROMPT,
} from "@coacker/brain";
import { Player } from "@coacker/player";

const OUTPUT_DIR = "/tmp/coacker-e2e-flow-review";

// ── Mock Responses ──────────────────────────────────────

const MOCK_RESPONSES = [
  // 1. Intention — 探索项目, 拆分子任务
  {
    snapshot: "[debug]",
    response: JSON.stringify([
      {
        id: "auth_system",
        intention: "Review authentication and authorization flows",
      },
      {
        id: "data_access",
        intention: "Review data access layer and query patterns",
      },
    ]),
    state: "done" as const,
    delay: 10,
  },
  // ── SubTask 1: auth_system ──
  // 2. impl step
  {
    snapshot: "[debug]",
    response: [
      "## Implementation Analysis: auth_system",
      "",
      "### Execution Path",
      "1. `loginHandler()` receives credentials",
      "2. `validateUser()` checks DB via bcrypt",
      "3. `generateToken()` creates JWT with 24h expiry",
      "",
      "### Key Functions",
      "- `loginHandler(req, res)`: Express route handler",
      "- `validateUser(email, password)`: Returns user or null",
      "- `generateToken(userId)`: Signs JWT",
      "",
      "### State Changes",
      "- Session table: new row on login",
      "- Last login timestamp updated",
    ].join("\n"),
    state: "done" as const,
    delay: 10,
  },
  // 3. review step
  {
    snapshot: "[debug]",
    response: [
      "## Code Review: auth_system",
      "",
      "**Warning**: JWT secret is loaded from env without fallback",
      "**Info**: bcrypt rounds hardcoded to 10, acceptable but should be configurable",
      "**Critical**: No rate limiting on login endpoint",
    ].join("\n"),
    state: "done" as const,
    delay: 10,
  },
  // 4. attack step
  {
    snapshot: "[debug]",
    response: [
      "## Attack Findings: auth_system",
      "",
      "**Critical**: No rate limiting → brute force login attack possible",
      "**High**: Token does not include audience claim → cross-service token reuse",
    ].join("\n"),
    state: "done" as const,
    delay: 10,
  },
  // ── SubTask 2: data_access ──
  // 5. impl step
  {
    snapshot: "[debug]",
    response: [
      "## Implementation Analysis: data_access",
      "",
      "### Key Functions",
      "- `findUser(id)`: Raw SQL query with string interpolation",
      "- `updateProfile(id, data)`: Uses ORM properly",
    ].join("\n"),
    state: "done" as const,
    delay: 10,
  },
  // 6. review step
  {
    snapshot: "[debug]",
    response: [
      "## Code Review: data_access",
      "",
      "**Critical**: `findUser()` uses string interpolation in SQL → SQL injection vulnerability",
      "**Info**: Mixed ORM and raw SQL patterns",
    ].join("\n"),
    state: "done" as const,
    delay: 10,
  },
  // 7. attack step
  {
    snapshot: "[debug]",
    response: [
      "## Attack Findings: data_access",
      "",
      "**Critical**: SQL injection in findUser — `SELECT * FROM users WHERE id = '${id}'`",
      "**Medium**: No input sanitization on updateProfile fields",
    ].join("\n"),
    state: "done" as const,
    delay: 10,
  },
  // ── Gap Analysis ──
  // 8. gap
  {
    snapshot: "[debug]",
    response: JSON.stringify({
      completeness_score: 9,
      gaps: [],
      duplicates: [],
    }),
    state: "done" as const,
    delay: 10,
  },
  // ── Consolidation ──
  // 9. consolidation
  {
    snapshot: "[debug]",
    response: [
      "## Executive Summary",
      "",
      "The codebase has two critical security vulnerabilities:",
      "1. SQL injection in `findUser()` via string interpolation",
      "2. No rate limiting on authentication endpoint",
      "",
      "## Top Issues",
      "1. **Critical** - SQL injection in data_access/findUser",
      "2. **Critical** - No rate limiting on login endpoint",
      "3. **High** - JWT missing audience claim",
      "",
      "## Risk Assessment",
      "Overall risk: **Critical**",
    ].join("\n"),
    state: "done" as const,
    delay: 10,
  },
];

// ── Expected Flow ──────────────────────────────────────

interface FlowStep {
  index: number;
  outputTag: string;
  hasRolePrompt: boolean;
  roleKeyword: string;
  hasOutputInstruction: boolean;
  promptIncludesPriorContext: boolean;
  responsePreview: string;
}

// ── Main ────────────────────────────────────────────────

async function main() {
  console.log("=== E2E Test: Conversation Flow Review ===\n");

  const backend = new MockBackend(MOCK_RESPONSES);

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
      root: ".",
      entry: "src/index.ts",
      intent: "Security review of the authentication and data access layers",
      origin: "",
    },
    audit: {
      maxGapRounds: 1,
      maxSubTasks: 5,
    },
    output: {
      dir: OUTPUT_DIR,
    },
  });

  const title = await player.connect();
  console.log(`Connected to: ${title}\n`);

  const report = await brain.run(player);

  // ── Flow Dump ──────────────────────────────────────

  console.log("╔══════════════════════════════════════════╗");
  console.log("║       CONVERSATION FLOW DUMP             ║");
  console.log("╚══════════════════════════════════════════╝\n");

  const chatHistory = backend.chatHistory;
  const steps: FlowStep[] = [];

  for (let i = 0; i < chatHistory.length; i++) {
    const entry = chatHistory[i];
    const prompt = entry.message;
    const options = entry.options;
    const mockResp = MOCK_RESPONSES[i];

    // outputTag: MockBackend 不注入文件指令, 但 tag 会通过 options 传递
    const outputTag = options?.outputTag ?? "(none)";
    const hasOutputInstr = outputTag !== "(none)";

    // 检查是否包含角色 prompt
    const hasIntention = prompt.includes("Intention Analyzer");
    const hasImpl = prompt.includes("Implementation Analyzer");
    const hasReview = prompt.includes("Ground Reviewer");
    const hasAttack = prompt.includes("Intention Attacker");
    const hasGap = prompt.includes("Gap Analyzer");
    const hasConsol = prompt.includes("Audit Consolidator");
    const roleKeyword = hasIntention
      ? "Intention"
      : hasImpl
        ? "Implementer"
        : hasReview
          ? "Reviewer"
          : hasAttack
            ? "Attacker"
            : hasGap
              ? "GapAnalyzer"
              : hasConsol
                ? "Consolidator"
                : "(none)";

    // 检查是否引用了之前的分析结果
    const hasPriorContext =
      prompt.includes("Previously analyzed") ||
      prompt.includes("Existing Implementation Reports") ||
      prompt.includes("All Review Findings");

    // 收集 step
    steps.push({
      index: i,
      outputTag,
      hasRolePrompt: roleKeyword !== "(none)",
      roleKeyword,
      hasOutputInstruction: hasOutputInstr,
      promptIncludesPriorContext: hasPriorContext,
      responsePreview: (mockResp?.response ?? mockResp?.snapshot ?? "").slice(0, 80),
    });

    // ── 打印每步 ──
    console.log(`── Step ${i + 1}/${chatHistory.length} ────────────────────`);
    console.log(`  OutputTag:       ${outputTag}`);
    console.log(`  Role:            ${roleKeyword}`);
    console.log(`  Has outputTag:   ${hasOutputInstr ? "✅" : "❌"}`);
    console.log(`  Prior context:   ${hasPriorContext ? "✅" : "—"}`);
    console.log(`  Prompt (first 120):  ${prompt.slice(0, 120).replace(/\n/g, "↵")}...`);
    console.log(`  Response (first 80): ${(mockResp?.response ?? "").slice(0, 80).replace(/\n/g, "↵")}...`);
    console.log("");
  }

  // ── Flow Assertions ────────────────────────────────

  console.log("╔══════════════════════════════════════════╗");
  console.log("║       FLOW ASSERTIONS                    ║");
  console.log("╚══════════════════════════════════════════╝\n");

  const ok = (cond: boolean, msg: string) => {
    if (cond) console.log(`  ✅ ${msg}`);
    else {
      console.log(`  ❌ FAIL: ${msg}`);
      process.exitCode = 1;
    }
  };

  // 基本计数
  ok(chatHistory.length === 9, `Total chat rounds: ${chatHistory.length} (expected 9)`);
  ok(backend.conversationCount === 5, `Conversations: ${backend.conversationCount} (expected 5: intention + 2 subtasks + gap + consolidation)`);

  // 步骤顺序 (outputTag 来自 ChatOptions)
  const tags = steps.map((s) => s.outputTag);
  ok(tags[0].includes("intention__explore"), `Step 1 tag: ${tags[0]}`);
  ok(tags[1].includes("auth_system__impl"), `Step 2 tag: ${tags[1]}`);
  ok(tags[2].includes("auth_system__review"), `Step 3 tag: ${tags[2]}`);
  ok(tags[3].includes("auth_system__attack"), `Step 4 tag: ${tags[3]}`);
  ok(tags[4].includes("data_access__impl"), `Step 5 tag: ${tags[4]}`);
  ok(tags[5].includes("data_access__review"), `Step 6 tag: ${tags[5]}`);
  ok(tags[6].includes("data_access__attack"), `Step 7 tag: ${tags[6]}`);
  ok(tags[7].includes("gap_round_1__gap"), `Step 8 tag: ${tags[7]}`);
  ok(tags[8].includes("consolidation__synthesize"), `Step 9 tag: ${tags[8]}`);

  // 所有步骤都有 outputTag (Player 自动生成)
  ok(
    steps.every((s) => s.hasOutputInstruction),
    "All steps have outputTag set in options",
  );

  // 所有步骤都有角色 prompt
  ok(
    steps.every((s) => s.hasRolePrompt),
    "All steps have role system prompt",
  );

  // 角色顺序
  const roles = steps.map((s) => s.roleKeyword);
  ok(roles[0] === "Intention", `Step 1 role: ${roles[0]}`);
  ok(roles[1] === "Implementer", `Step 2 role: ${roles[1]}`);
  ok(roles[2] === "Reviewer", `Step 3 role: ${roles[2]}`);
  ok(roles[3] === "Attacker", `Step 4 role: ${roles[3]}`);
  ok(roles[7] === "GapAnalyzer", `Step 8 role: ${roles[7]}`);
  ok(roles[8] === "Consolidator", `Step 9 role: ${roles[8]}`);

  // SubTask 2 的 prompt 应包含 Prior Knowledge (之前的分析结果)
  ok(steps[4].promptIncludesPriorContext, "SubTask 2 impl includes prior context from SubTask 1");

  // Gap Analysis 应包含之前的报告
  ok(steps[7].promptIncludesPriorContext, "Gap analysis includes existing reports");

  // Consolidation 应包含所有报告
  ok(steps[8].promptIncludesPriorContext, "Consolidation includes all findings");

  // ── Report Assertions ──
  ok(report.tasks.length === 2, `Report tasks: ${report.tasks.length} (expected 2)`);
  ok(
    report.tasks[0].implementation.includes("auth_system"),
    "Task 1 implementation contains auth_system content",
  );
  ok(
    report.tasks[1].implementation.includes("data_access"),
    "Task 2 implementation contains data_access content",
  );
  ok(report.executiveSummary.includes("SQL injection"), "Executive summary includes SQL injection finding");
  ok(
    !report.tasks[0].implementation.includes("[debug]"),
    "Implementation does NOT contain debug snapshot",
  );

  console.log(`\n=== Done (${chatHistory.length} rounds, ${steps.filter((s) => s.hasOutputInstruction).length} with file output) ===`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
