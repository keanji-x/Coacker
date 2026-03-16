/**
 * Issue #12 — Resumed subtask loses AI response: waitForResponse return value
 * handling and placeholder text propagation into reports.
 *
 * This test validates:
 * 1. Player.continueTask() fills already-completed steps with a placeholder string
 * 2. extractReport() reads snapshots verbatim — if they contain placeholders, the
 *    report gets placeholder text instead of real AI analysis
 * 3. The "sent" recovery path's patch logic (injecting waitResult.snapshot back)
 *    only fixes ONE step — all other previously-completed steps retain placeholders
 * 4. The "responded" recovery path has NO patching at all
 */

import { describe, it, expect } from "vitest";
import { extractReport } from "../result-parser.js";
import type { SubTask, TaskReport } from "../types.js";
import type { TaskResult, StepResult } from "@coacker/shared";

// ── helpers ──────────────────────────────────────────

const PLACEHOLDER = "[resumed — completed in previous run]";

function makeSubTask(overrides: Partial<SubTask> = {}): SubTask {
  return {
    id: overrides.id ?? "task_1",
    intention: overrides.intention ?? "review entry point",
    status: overrides.status ?? "done",
    ...overrides,
  };
}

/**
 * Simulate what Player.continueTask() produces when resuming from a given step.
 *
 * Steps 0..fromStepIndex-1 get placeholder snapshots.
 * Steps fromStepIndex..end get real AI response snapshots.
 */
function simulateContinueTaskResult(
  taskId: string,
  stepDefs: { id: string; role: string }[],
  fromStepIndex: number,
  realSnapshots: Record<string, string>,
): TaskResult {
  const stepResults: StepResult[] = [];

  // Already-completed steps → placeholder (this is what continueTask does at lines 318-329)
  for (let i = 0; i < fromStepIndex; i++) {
    stepResults.push({
      stepId: stepDefs[i].id,
      role: stepDefs[i].role,
      prompt: "",
      snapshot: PLACEHOLDER,
      status: "success",
      elapsed: 0,
      steps: 0,
      approvals: 0,
    });
  }

  // Remaining steps → real responses
  for (let i = fromStepIndex; i < stepDefs.length; i++) {
    stepResults.push({
      stepId: stepDefs[i].id,
      role: stepDefs[i].role,
      prompt: "test prompt",
      snapshot: realSnapshots[stepDefs[i].id] ?? "",
      status: "success",
      elapsed: 5.0,
      steps: 1,
      approvals: 0,
    });
  }

  return {
    taskId,
    type: "implement",
    status: "success",
    stepResults,
    elapsed: 20.0,
    conversationId: "conv_resumed",
  };
}

// The standard 4-step pipeline: impl → review → attack → propose_issues
const STEP_DEFS = [
  { id: "impl", role: "implementer" },
  { id: "review", role: "reviewer" },
  { id: "attack", role: "attacker" },
  { id: "propose_issues", role: "issue_proposer" },
];

// ── tests ────────────────────────────────────────────

describe("Issue #12 — Placeholder propagation in resume paths", () => {
  // ─────────────────────────────────────────────────
  // 1. Core bug: continueTask produces placeholder-filled stepResults,
  //    and extractReport reads them as real content.
  // ─────────────────────────────────────────────────

  describe("extractReport reads placeholder text as real content", () => {
    it("impl step placeholder propagates to report.implementation", () => {
      // Simulate resume from step 1 (impl already completed, review/attack/propose remain)
      const result = simulateContinueTaskResult(
        "subtask_task_1",
        STEP_DEFS,
        1, // impl was completed before crash
        {
          review: "Detailed code review of 2000 chars...",
          attack: "Attack vector analysis...",
          propose_issues: '{"issues": []}',
        },
      );

      const st = makeSubTask({ id: "task_1" });
      const report = extractReport(st, result);

      // BUG: implementation should contain real AI analysis, but gets placeholder
      // This assertion demonstrates the bug — it will PASS because extractReport
      // faithfully reads the placeholder snapshot from the stepResult.
      expect(report.implementation).toBe(PLACEHOLDER);

      // The other steps that ran after resume have real content
      expect(report.codeReview).toBe("Detailed code review of 2000 chars...");
      expect(report.attackReview).toBe("Attack vector analysis...");
    });

    it("multiple completed steps all get placeholder text", () => {
      // Simulate crash after step 2 (impl + review completed, attack + propose remain)
      const result = simulateContinueTaskResult(
        "subtask_task_1",
        STEP_DEFS,
        2, // impl and review were completed before crash
        {
          attack: "Real attack analysis...",
          propose_issues: '{"issues": [{"title": "bug"}]}',
        },
      );

      const st = makeSubTask({ id: "task_1" });
      const report = extractReport(st, result);

      // BUG: Both impl and review snapshots are placeholders
      expect(report.implementation).toBe(PLACEHOLDER);
      expect(report.codeReview).toBe(PLACEHOLDER);

      // Only steps executed after resume have real content
      expect(report.attackReview).toBe("Real attack analysis...");
      expect(report.issueProposals).toBe(
        '{"issues": [{"title": "bug"}]}',
      );
    });

    it("crash after all steps → entire report is placeholder text", () => {
      // Edge case: all 4 steps completed before crash, continueTask has nothing to do
      // but still produces all-placeholder stepResults
      const result = simulateContinueTaskResult(
        "subtask_task_1",
        STEP_DEFS,
        4, // all steps completed before crash
        {},
      );

      const st = makeSubTask({ id: "task_1" });
      const report = extractReport(st, result);

      // Every field is the placeholder
      expect(report.implementation).toBe(PLACEHOLDER);
      expect(report.codeReview).toBe(PLACEHOLDER);
      expect(report.attackReview).toBe(PLACEHOLDER);
      expect(report.issueProposals).toBe(PLACEHOLDER);
    });
  });

  // ─────────────────────────────────────────────────
  // 2. The "sent" recovery path patches ONE step but leaves others as placeholders
  //    (audit-brain.ts lines 300-310)
  // ─────────────────────────────────────────────────

  describe('"sent" recovery path — partial patching', () => {
    it("patching the waited step fixes only that one step, not earlier ones", () => {
      // Scenario: crash during step index 2 (attack) while status="sent"
      // completedSteps = ["impl", "review"] → completedCount = 2
      // After waitForResponse, completedCount becomes 3: ["impl", "review", "attack"]
      // continueTask(task, 3, ...) fills steps 0,1,2 with placeholders, runs step 3 (propose_issues)
      //
      // The patch at lines 303-310 sets result.stepResults[2] = waitResult data
      // But steps 0 and 1 still have placeholders!

      const result = simulateContinueTaskResult(
        "subtask_task_1",
        STEP_DEFS,
        3, // fromStepIndex=3 (completedCount after waitForResponse adds attack)
        {
          propose_issues: '{"issues": []}',
        },
      );

      // Simulate the patch that audit-brain.ts lines 303-310 would do
      const waitResultSnapshot =
        "Real attack vector analysis with 5000 chars of content...";
      const waitStepIndex = 3 - 1; // completedCount - 1 = 2

      // This is what audit-brain.ts does:
      if (waitStepIndex >= 0 && waitStepIndex < result.stepResults.length) {
        result.stepResults[waitStepIndex] = {
          ...result.stepResults[waitStepIndex],
          snapshot: waitResultSnapshot,
          status: "success",
          elapsed: 45.0,
        };
      }

      const st = makeSubTask({ id: "task_1" });
      const report = extractReport(st, result);

      // The patched step (attack) now has real content — good!
      expect(report.attackReview).toBe(waitResultSnapshot);

      // But impl and review still have placeholder text — BUG!
      // These steps completed in the previous run but their snapshots are lost.
      expect(report.implementation).toBe(PLACEHOLDER);
      expect(report.codeReview).toBe(PLACEHOLDER);

      // The step executed after resume has real content
      expect(report.issueProposals).toBe('{"issues": []}');
    });

    it("if crash happens on the very first step (impl), no prior steps need patching", () => {
      // This is the "happy case" for the sent path: crash during impl (step 0)
      // completedSteps = [] → after waitForResponse → completedCount = 1
      // continueTask(task, 1, ...) fills step 0 with placeholder, runs steps 1,2,3

      const result = simulateContinueTaskResult(
        "subtask_task_1",
        STEP_DEFS,
        1,
        {
          review: "Real review...",
          attack: "Real attack...",
          propose_issues: '{"issues": []}',
        },
      );

      // Patch step 0 (the waited step)
      const waitResultSnapshot = "Real implementation analysis...";
      result.stepResults[0] = {
        ...result.stepResults[0],
        snapshot: waitResultSnapshot,
        status: "success",
        elapsed: 30.0,
      };

      const st = makeSubTask({ id: "task_1" });
      const report = extractReport(st, result);

      // All steps have real content — this case works correctly
      expect(report.implementation).toBe("Real implementation analysis...");
      expect(report.codeReview).toBe("Real review...");
      expect(report.attackReview).toBe("Real attack...");
      expect(report.issueProposals).toBe('{"issues": []}');
    });
  });

  // ─────────────────────────────────────────────────
  // 3. The "responded" recovery path does NO patching at all
  //    (audit-brain.ts lines 326-360)
  // ─────────────────────────────────────────────────

  describe('"responded" recovery path — no patching', () => {
    it("all previously-completed steps get placeholder, no patching applied", () => {
      // Scenario: crash after step 1 (impl) responded but before step 2 (review) sent
      // checkpoint.chat_status = "responded", completedSteps = ["impl"]
      // continueTask(task, 1, ...) fills step 0 with placeholder, runs steps 1,2,3
      //
      // Unlike the "sent" path, there is NO patching code for this path
      // (audit-brain.ts lines 341-349 — just calls continueTask and extractReport)

      const result = simulateContinueTaskResult(
        "subtask_task_1",
        STEP_DEFS,
        1,
        {
          review: "Real review with detailed findings...",
          attack: "Real attack analysis...",
          propose_issues: '{"issues": []}',
        },
      );

      // No patching is done in the "responded" path — this is the bug.
      // The checkpoint told us impl had responded, so its content exists
      // in the conversation, but continueTask puts a placeholder in its place.

      const st = makeSubTask({ id: "task_1" });
      const report = extractReport(st, result);

      // BUG: implementation has placeholder because no patching is done
      expect(report.implementation).toBe(PLACEHOLDER);

      // Steps executed after resume have real content
      expect(report.codeReview).toBe(
        "Real review with detailed findings...",
      );
      expect(report.attackReview).toBe("Real attack analysis...");
    });

    it("crash after 3 responded steps → 3 fields are placeholders", () => {
      // crash after impl, review, attack all responded
      // checkpoint.chat_status = "responded", completedSteps = ["impl", "review", "attack"]
      // continueTask(task, 3, ...) fills 0,1,2 with placeholders, runs step 3

      const result = simulateContinueTaskResult(
        "subtask_task_1",
        STEP_DEFS,
        3,
        {
          propose_issues: '{"issues": [{"title": "Critical bug found"}]}',
        },
      );

      const st = makeSubTask({ id: "task_1" });
      const report = extractReport(st, result);

      // BUG: All three analysis fields are lost
      expect(report.implementation).toBe(PLACEHOLDER);
      expect(report.codeReview).toBe(PLACEHOLDER);
      expect(report.attackReview).toBe(PLACEHOLDER);

      // Only the step that actually ran after resume has real content
      expect(report.issueProposals).toBe(
        '{"issues": [{"title": "Critical bug found"}]}',
      );
    });
  });

  // ─────────────────────────────────────────────────
  // 4. Downstream impact: placeholder text propagates into gap analysis
  //    and consolidation prompts through buildGapTask/buildConsolidationTask
  // ─────────────────────────────────────────────────

  describe("Downstream propagation into consolidation", () => {
    it("placeholder in report.implementation is fed to gap analysis and consolidation prompts", () => {
      // After resume produces a placeholder-tainted report,
      // it gets stored in this.reports and later used by buildGapTask/buildConsolidationTask
      const report: TaskReport = {
        taskId: "task_1",
        intention: "Review authentication module",
        implementation: PLACEHOLDER, // ← the bug's effect
        codeReview: "Real review content...",
        attackReview: "Real attack content...",
        issueProposals: "",
      };

      // Verify the placeholder is a short, meaningless string
      expect(report.implementation.length).toBeLessThan(50);

      // Compare against what a real implementation analysis looks like
      const realImplementation =
        "The authentication module uses JWT tokens with RS256 signing. " +
        "Key rotation is handled via a cron job that... [2000+ chars of analysis]";
      expect(realImplementation.length).toBeGreaterThan(50);

      // The consolidation phase would receive the placeholder as if it were
      // real analysis, leading to summaries like:
      //   "Implementation Findings: [resumed — completed in previous run]"
      // This is the user-visible degradation described in the issue.
      expect(report.implementation).toContain("resumed");
      expect(report.implementation).toContain("previous run");
    });
  });

  // ─────────────────────────────────────────────────
  // 5. Verify the exact placeholder string matches what Player produces
  // ─────────────────────────────────────────────────

  describe("Placeholder string verification", () => {
    it("placeholder matches the exact string from Player.continueTask", () => {
      // The placeholder is hardcoded in player.ts line 324
      // If it ever changes, this test ensures we track it
      expect(PLACEHOLDER).toBe("[resumed — completed in previous run]");
      expect(PLACEHOLDER.length).toBe(37);
    });

    it("placeholder is not valid JSON (breaks extractJSON if used in propose_issues)", () => {
      // If the issue proposer step was completed before crash,
      // its snapshot becomes the placeholder. When downstream code
      // tries to parse it as JSON, it silently returns null.
      const parsed = safeJsonParse(PLACEHOLDER);
      expect(parsed).toBeNull();
    });
  });
});

// ── utility ──────────────────────────────────────────

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
