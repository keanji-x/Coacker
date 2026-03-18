/**
 * Issue #14 — TOCTOU: state.json and intention.json can diverge on crash,
 * causing split-brain resume.
 *
 * These tests simulate crash scenarios where the two files are written at
 * different times, producing inconsistent snapshots.  On resume the Brain
 * reads `phase` / `gapRound` from state.json but subtask data from
 * intention.json — they can disagree, producing unpredictable behavior.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  ensureOutputDirs,
  persistState,
  persistIntention,
  loadState,
  loadIntention,
} from "../persister.js";
import type { SubTask, TaskReport, AuditPhase } from "../types.js";

// ── helpers ──────────────────────────────────────────

function makeTmpDir(): string {
  const dir = join(
    tmpdir(),
    `coacker-toctou-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeSubTask(overrides: Partial<SubTask> = {}): SubTask {
  return {
    id: overrides.id ?? "task_1",
    intention: overrides.intention ?? "review entry point",
    status: overrides.status ?? "pending",
    ...overrides,
  };
}

const emptyReports: Map<string, TaskReport> = new Map();
const emptyHistory: never[] = [];

// ── tests ────────────────────────────────────────────

describe("Issue #14 — TOCTOU split-brain between state.json and intention.json", () => {
  let outputDir: string;

  beforeEach(() => {
    outputDir = makeTmpDir();
    ensureOutputDirs(outputDir);
  });

  afterEach(() => {
    rmSync(outputDir, { recursive: true, force: true });
  });

  // ─────────────────────────────────────────────────
  // 1. Demonstrate that the two files are written independently
  //    and can therefore represent different snapshots.
  // ─────────────────────────────────────────────────

  it("persistState and persistIntention write to separate files", () => {
    const subtasks = [makeSubTask({ status: "done" })];

    // Write state.json with phase "intention" (older)
    persistState(
      outputDir,
      "intention",
      0,
      subtasks,
      emptyReports,
      emptyHistory,
    );

    // Write intention.json with a different subtask status (newer)
    const newerSubtasks = [makeSubTask({ status: "done" })];
    persistIntention(outputDir, newerSubtasks);

    // Both files exist independently
    const stateRaw = JSON.parse(
      readFileSync(join(outputDir, "state.json"), "utf-8"),
    );
    const intentionRaw = JSON.parse(
      readFileSync(join(outputDir, "intention.json"), "utf-8"),
    );

    // They are separate − this is the root cause of the bug.
    expect(stateRaw.phase).toBe("intention");
    expect(intentionRaw[0].status).toBe("done");

    // state.json also carries subtasks, but resume() ignores them in favour
    // of intention.json.  This demonstrates the dual-source problem.
    expect(stateRaw.subtasks[0].status).toBe("done");
  });

  // ─────────────────────────────────────────────────
  // 2. Simulate crash AFTER persistIntention but BEFORE persistState.
  //    intention.json is updated (all subtasks "done") but state.json
  //    still says phase="execution".
  //    On resume, phase will be "execution" but there's nothing to do.
  // ─────────────────────────────────────────────────

  it("crash after persistIntention → stale phase in state.json", () => {
    const subtasks = [
      makeSubTask({ id: "t1", status: "in_progress" }),
      makeSubTask({ id: "t2", status: "pending" }),
    ];

    // 1) state.json last written during execution, with in_progress subtasks
    persistState(
      outputDir,
      "execution",
      0,
      subtasks,
      emptyReports,
      emptyHistory,
    );

    // 2) subtask completes → intention.json updated, but crash before state.json is updated
    const updatedSubtasks = [
      makeSubTask({ id: "t1", status: "done" }),
      makeSubTask({ id: "t2", status: "done" }),
    ];
    persistIntention(outputDir, updatedSubtasks);
    // *** crash here — persistCurrentState() never ran ***

    // 3) On resume, loadState gives phase="execution"
    const savedState = loadState(outputDir);
    expect(savedState).not.toBeNull();
    expect(savedState!.phase).toBe("execution");

    // 4) loadIntention says all subtasks are done
    const savedIntention = loadIntention(outputDir);
    expect(savedIntention).not.toBeNull();
    expect(savedIntention!.every((s) => s.status === "done")).toBe(true);

    // BUG: resume() will set this._phase = "execution" but find no
    // pending or in_progress subtasks -> falls through to finalize()
    // with phase still incorrectly set to "execution".
    // The inconsistency between phase and subtask status is the bug.
    expect(savedState!.phase).toBe("execution");
    expect(savedState!.subtasks.some((s) => s.status !== "done")).toBe(true); // stale in state.json
    expect(savedIntention!.every((s) => s.status === "done")).toBe(true); // fresh in intention.json

    // This proves the TOCTOU: the two files disagree about subtask completion.
  });

  // ─────────────────────────────────────────────────
  // 3. Simulate crash AFTER persistState but BEFORE persistIntention.
  //    state.json says phase="execution" with subtasks marked "done",
  //    but intention.json still shows them as "in_progress".
  // ─────────────────────────────────────────────────

  it("crash after persistState → stale subtask status in intention.json", () => {
    // 1) Older intention.json — subtask is in_progress
    const oldSubtasks = [makeSubTask({ id: "t1", status: "in_progress" })];
    persistIntention(outputDir, oldSubtasks);

    // 2) Subtask completes; state.json now updated with status "done"
    const newSubtasks = [makeSubTask({ id: "t1", status: "done" })];
    persistState(
      outputDir,
      "execution",
      0,
      newSubtasks,
      emptyReports,
      emptyHistory,
    );
    // *** crash here — persistIntention() never ran for the "done" version ***

    const savedState = loadState(outputDir);
    const savedIntention = loadIntention(outputDir);

    // state.json thinks t1 is done
    expect(savedState!.subtasks[0].status).toBe("done");
    // intention.json thinks t1 is still in_progress
    expect(savedIntention![0].status).toBe("in_progress");

    // BUG: resume() will use subtasks from intention.json (in_progress),
    // and phase from state.json (execution). It will try to resume an
    // already-completed subtask, potentially re-executing it.
  });

  // ─────────────────────────────────────────────────
  // 4. The most dangerous scenario: state.json says phase="intention"
  //    (very stale) but intention.json has all subtasks "done" (very fresh).
  //    resume() will re-enter intention phase and find nothing to do.
  // ─────────────────────────────────────────────────

  it("extreme divergence: phase='intention' with all-done subtasks → nonsensical resume", () => {
    const doneSubtasks = [
      makeSubTask({ id: "t1", status: "done" }),
      makeSubTask({ id: "t2", status: "done" }),
    ];

    // Simulate: state.json was last written at intention phase
    persistState(outputDir, "intention", 0, [], emptyReports, emptyHistory);
    // But intention.json was written much later, after all execution
    persistIntention(outputDir, doneSubtasks);

    const savedState = loadState(outputDir);
    const savedIntention = loadIntention(outputDir);

    // resume() would do:
    //   this._phase = "intention"  (from state.json)
    //   this.subtasks = doneSubtasks  (from intention.json)
    expect(savedState!.phase).toBe("intention");
    expect(savedIntention!.every((s) => s.status === "done")).toBe(true);

    // This is nonsensical: "intention" phase implies we haven't started execution,
    // but all subtasks are already completed.  resume() will skip all subtasks
    // (none pending/in_progress) and call finalize() with _phase still "intention".
  });

  // ─────────────────────────────────────────────────
  // 5. loadState returns subtasks[] in AuditBrainState, but resume()
  //    completely ignores them in favour of loadIntention().
  //    This test shows that state.json.subtasks are always discarded.
  // ─────────────────────────────────────────────────

  it("resume always prefers intention.json subtasks, discarding state.json subtasks", () => {
    // state.json subtasks say 2 tasks, both pending
    const stateSubtasks = [
      makeSubTask({ id: "t1", status: "pending" }),
      makeSubTask({ id: "t2", status: "pending" }),
    ];
    persistState(
      outputDir,
      "execution",
      0,
      stateSubtasks,
      emptyReports,
      emptyHistory,
    );

    // intention.json subtasks say 3 tasks, mixed statuses
    const intentionSubtasks = [
      makeSubTask({ id: "t1", status: "done" }),
      makeSubTask({ id: "t2", status: "done" }),
      makeSubTask({ id: "t3", status: "pending" }),
    ];
    persistIntention(outputDir, intentionSubtasks);

    const savedState = loadState(outputDir);
    const savedIntention = loadIntention(outputDir);

    // state.json has 2 subtasks
    expect(savedState!.subtasks).toHaveLength(2);
    // intention.json has 3 subtasks
    expect(savedIntention).toHaveLength(3);

    // resume() uses intention.json, so list length disagrees with state.json.
    // The subtask counts diverge — there is no consistency check.
  });

  // ─────────────────────────────────────────────────
  // 6. Gap round divergence: state.json may have gapRound=0,
  //    but we're actually on round 2 based on subtask evidence.
  //    resume() trusts the stale gapRound, re-running gap analysis.
  // ─────────────────────────────────────────────────

  it("gapRound in state.json can lag behind actual progress", () => {
    // In finalize(), gap analysis increments gapRound and calls
    // persistCurrentState(), then executes new subtasks.  A crash during
    // subtask execution means gapRound was incremented in state.json but
    // the new subtasks may not be fully in intention.json yet (or vice versa).

    const subtasksAfterGap = [
      makeSubTask({ id: "orig_1", status: "done" }),
      makeSubTask({ id: "gap_1", status: "in_progress" }), // gap-discovered, was executing
    ];

    // state.json written with gapRound=1, but BEFORE gap subtask completed
    persistState(
      outputDir,
      "execution",
      1,
      subtasksAfterGap,
      emptyReports,
      emptyHistory,
    );

    // intention.json was written AFTER gap subtask was marked in_progress
    // but crash happened before it was marked done
    persistIntention(outputDir, subtasksAfterGap);

    const savedState = loadState(outputDir);
    const savedIntention = loadIntention(outputDir);

    expect(savedState!.gapRound).toBe(1);
    expect(savedIntention!.find((s) => s.id === "gap_1")!.status).toBe(
      "in_progress",
    );

    // This is recoverable IF gapRound and subtask status agree.
    // But consider: if persistState wrote gapRound=1 while intention.json
    // still has the old subtasks (without gap_1), resume would think
    // gap round 1 already ran but see no evidence of its subtasks.
  });

  // ─────────────────────────────────────────────────
  // 7. No consistency validation on load — loadState and loadIntention
  //    are completely independent; there is no sequence number, checksum,
  //    or any mechanism to detect divergence.
  // ─────────────────────────────────────────────────

  it("no consistency validation exists between the two files", () => {
    // Write completely unrelated data to each file
    persistState(outputDir, "gap_analysis", 2, [], emptyReports, emptyHistory);
    persistIntention(outputDir, [
      makeSubTask({ id: "x", status: "done" }),
      makeSubTask({ id: "y", status: "pending" }),
    ]);

    const savedState = loadState(outputDir);
    const savedIntention = loadIntention(outputDir);

    // Both load successfully — no error, no warning, no cross-check
    expect(savedState).not.toBeNull();
    expect(savedIntention).not.toBeNull();

    // The loaded data is wildly inconsistent:
    // - phase is gap_analysis (round 2) but subtasks include a "pending" one
    // - state.json has 0 subtasks, intention.json has 2
    // No existing validation catches this.
    expect(savedState!.subtasks).toHaveLength(0);
    expect(savedIntention).toHaveLength(2);
    expect(savedState!.phase).toBe("gap_analysis");
    expect(savedState!.gapRound).toBe(2);

    // A proper fix would reject or reconcile these on load.
  });
});
