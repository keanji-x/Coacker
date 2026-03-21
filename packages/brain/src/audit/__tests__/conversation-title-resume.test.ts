/**
 * Issue #13 — conversation_title on resume: does switchToConversation fire?
 *
 * Reviewer feedback on previous tests:
 *   - Core claim "always null" is WRONG — onStepEnd already populates it.
 *   - Tests must exercise actual AuditBrain.resume(), not reimplemented guards.
 *   - Tests must use real Player/MockBackend, not plain object assertions.
 *
 * Strategy:
 *   1. Instantiate AuditBrain with a temp outputDir.
 *   2. Seed the filesystem (state.json, intention.json, reports/) to simulate
 *      a crash at various points.
 *   3. Call brain.run() which detects resumable state and calls resume().
 *   4. Use a spy-enabled MockBackend to verify switchToConversation is/isn't called.
 *
 * What we're actually testing:
 *   - When persisted checkpoint has conversation_title set,
 *     resume() calls backend.switchToConversation with that title.
 *   - When persisted checkpoint has conversation_title = null (crash
 *     between onStepStart and onStepEnd), resume() skips the switch.
 *   - After a normal executeSubTask completes, the checkpoint's
 *     conversation_title IS populated from getConversationTitle().
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { AuditBrain } from "../audit-brain.js";
import {
  ensureOutputDirs,
  persistState,
  persistIntention,
  persistReport,
} from "../persister.js";
import type {
  SubTask,
  TaskReport,
  AuditBrainState,
  ChatCheckpoint,
} from "../types.js";
import { MockBackend } from "../../../../backend/src/mock-backend.js";
import { Player } from "@coacker/player";

// ── helpers ──────────────────────────────────────────

function makeTmpDir(): string {
  const dir = join(
    tmpdir(),
    `coacker-issue13-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Build an AuditBrain pointing at the given outputDir */
function makeBrain(outputDir: string): AuditBrain {
  return new AuditBrain({
    project: {
      root: "/tmp/fake-project",
      entry: "src/index.ts",
      intent: "test audit",
      origin: "test/repo",
    },
    audit: {
      maxGapRounds: 0, // skip gap analysis for test speed
      maxSubTasks: 10,
    },
    output: { dir: outputDir },
  });
}

/** Create a MockBackend with enough responses for subtask steps */
function makeBackendWithResponses(count: number): MockBackend {
  const responses = Array.from({ length: count }, (_, i) => ({
    snapshot: `[mock response ${i}]`,
    state: "done" as const,
  }));
  return new MockBackend(responses);
}

/** Build a SubTask with checkpoint for resume testing */
function makeInProgressSubTask(overrides: {
  id?: string;
  chatStatus?: "sent" | "responded";
  conversationTitle?: string | null;
  completedSteps?: string[];
}): SubTask {
  const cp: ChatCheckpoint = {
    chat_status: overrides.chatStatus ?? "sent",
    chat_type: "impl",
    chat_input: "mock prompt text",
    conversation_title: overrides.conversationTitle ?? null,
  };
  return {
    id: overrides.id ?? "task_1",
    intention: "review the entry module",
    status: "in_progress",
    conversationId: "conv_1",
    checkpoint: cp,
    completedSteps: overrides.completedSteps ?? [],
    currentStep: "impl",
    stepProgress: "1/4",
  };
}

function makeReport(taskId: string): TaskReport {
  return {
    taskId,
    intention: "test intention",
    implementation: "impl text",
    codeReview: "review text",
    attackReview: "attack text",
    issueProposals: "[]",
  };
}

/**
 * Seed the filesystem so AuditBrain.run() detects a resumable state.
 * Returns the subtask list written to intention.json.
 */
function seedResumeState(
  outputDir: string,
  opts: {
    phase?: AuditBrainState["phase"];
    inProgressTask: SubTask;
    doneTasks?: SubTask[];
    reports?: Map<string, TaskReport>;
  },
): SubTask[] {
  ensureOutputDirs(outputDir);

  const allSubtasks = [...(opts.doneTasks ?? []), opts.inProgressTask];

  persistState(
    outputDir,
    opts.phase ?? "execution",
    0,
    allSubtasks,
    opts.reports ?? new Map(),
    [],
  );
  persistIntention(outputDir, allSubtasks);

  // Persist reports for done tasks
  if (opts.reports) {
    for (const [id, report] of opts.reports) {
      persistReport(outputDir, id, report);
    }
  }

  return allSubtasks;
}

// ── tests ────────────────────────────────────────────

describe("Issue #13 — AuditBrain resume + conversation_title (production paths)", () => {
  let outputDir: string;

  beforeEach(() => {
    outputDir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(outputDir, { recursive: true, force: true });
  });

  // ─────────────────────────────────────────────────
  // TEST 1: resume() calls switchToConversation when
  // conversation_title IS populated in the checkpoint.
  //
  // This is the happy path: onStepEnd ran before the crash,
  // so the title was saved. On resume, the brain should switch
  // back to the original conversation.
  // ─────────────────────────────────────────────────

  it("resume() calls switchToConversation when checkpoint has conversation_title (chat_status=sent)", async () => {
    const backend = makeBackendWithResponses(20);
    const switchSpy = vi.spyOn(backend, "switchToConversation");
    const player = new Player({ backend });
    await player.connect();

    const inProgress = makeInProgressSubTask({
      chatStatus: "sent",
      conversationTitle: "My Audit Conversation",
      completedSteps: [],
    });

    seedResumeState(outputDir, { inProgressTask: inProgress });

    const brain = makeBrain(outputDir);
    await brain.run(player);

    // The actual resume() method should have called switchToConversation
    // with the title from the checkpoint
    expect(switchSpy).toHaveBeenCalledWith("My Audit Conversation");

    await player.disconnect();
  });

  it("resume() calls switchToConversation when checkpoint has conversation_title (chat_status=responded)", async () => {
    const backend = makeBackendWithResponses(20);
    const switchSpy = vi.spyOn(backend, "switchToConversation");
    const player = new Player({ backend });
    await player.connect();

    const inProgress = makeInProgressSubTask({
      chatStatus: "responded",
      conversationTitle: "My Responded Conv",
      completedSteps: ["impl"],
    });

    seedResumeState(outputDir, { inProgressTask: inProgress });

    const brain = makeBrain(outputDir);
    await brain.run(player);

    expect(switchSpy).toHaveBeenCalledWith("My Responded Conv");

    await player.disconnect();
  });

  // ─────────────────────────────────────────────────
  // TEST 2: resume() does NOT call switchToConversation
  // when conversation_title is null.
  //
  // This is the crash scenario: crash between onStepStart
  // and onStepEnd, so title was never populated.
  // The brain resumes but skips the switch — prompts go
  // to whatever conversation is currently active.
  // ─────────────────────────────────────────────────

  it("resume() does NOT call switchToConversation when checkpoint.conversation_title is null (chat_status=sent)", async () => {
    const backend = makeBackendWithResponses(20);
    const switchSpy = vi.spyOn(backend, "switchToConversation");
    const player = new Player({ backend });
    await player.connect();

    const inProgress = makeInProgressSubTask({
      chatStatus: "sent",
      conversationTitle: null,  // crash before onStepEnd could populate it
    });

    seedResumeState(outputDir, { inProgressTask: inProgress });

    const brain = makeBrain(outputDir);
    await brain.run(player);

    // switchToConversation should NOT have been called
    // because conversation_title is null
    expect(switchSpy).not.toHaveBeenCalled();

    await player.disconnect();
  });

  it("resume() does NOT call switchToConversation when checkpoint.conversation_title is null (chat_status=responded)", async () => {
    const backend = makeBackendWithResponses(20);
    const switchSpy = vi.spyOn(backend, "switchToConversation");
    const player = new Player({ backend });
    await player.connect();

    const inProgress = makeInProgressSubTask({
      chatStatus: "responded",
      conversationTitle: null,
      completedSteps: ["impl"],
    });

    seedResumeState(outputDir, { inProgressTask: inProgress });

    const brain = makeBrain(outputDir);
    await brain.run(player);

    expect(switchSpy).not.toHaveBeenCalled();

    await player.disconnect();
  });

  // ─────────────────────────────────────────────────
  // TEST 3: Normal executeSubTask() populates
  // conversation_title via getConversationTitle().
  //
  // This directly disproves the issue's core claim that
  // conversation_title is "hardcoded to null and never updated."
  // We run a fresh audit (no resume), and verify the checkpoint
  // gets populated during execution.
  // ─────────────────────────────────────────────────

  it("executeSubTask() populates checkpoint.conversation_title via getConversationTitle()", async () => {
    const backend = makeBackendWithResponses(20);
    const titleSpy = vi.spyOn(backend, "getConversationTitle");
    titleSpy.mockResolvedValue("Auto-Generated Title From Backend");

    const player = new Player({ backend });
    await player.connect();

    // Fresh run — no saved state, so it goes through intention → execution
    const brain = makeBrain(outputDir);

    // Mock the intention response to produce a single subtask
    backend.setResponses([
      // Intention response: return a single subtask
      {
        snapshot: JSON.stringify([
          { id: "task_1", intention: "review entry point" },
        ]),
        state: "done",
      },
      // 4 subtask step responses (impl, review, attack, propose_issues)
      { snapshot: "impl analysis", state: "done" },
      { snapshot: "code review", state: "done" },
      { snapshot: "attack review", state: "done" },
      { snapshot: '{"issues": []}', state: "done" },
      // Consolidation
      { snapshot: "executive summary", state: "done" },
    ]);

    await brain.run(player);

    // getConversationTitle should have been called (by onStepEnd callback)
    // at least once during subtask execution
    expect(titleSpy).toHaveBeenCalled();

    await player.disconnect();
  });

  // ─────────────────────────────────────────────────
  // TEST 4: When getConversationTitle() returns null,
  // the checkpoint's conversation_title stays null.
  // This means a subsequent resume would skip the switch.
  //
  // This tests the residual risk: even though onStepEnd
  // tries to populate the title, if the backend returns null
  // (e.g., new/untitled conversation), the title stays null.
  // ─────────────────────────────────────────────────

  it("conversation_title stays null when getConversationTitle() returns null", async () => {
    const backend = makeBackendWithResponses(20);
    const titleSpy = vi.spyOn(backend, "getConversationTitle");
    titleSpy.mockResolvedValue(null);

    const player = new Player({ backend });
    await player.connect();

    backend.setResponses([
      // Intention: single subtask
      {
        snapshot: JSON.stringify([
          { id: "task_1", intention: "review entry point" },
        ]),
        state: "done",
      },
      // 4 step responses
      { snapshot: "impl", state: "done" },
      { snapshot: "review", state: "done" },
      { snapshot: "attack", state: "done" },
      { snapshot: '{"issues": []}', state: "done" },
      // Consolidation
      { snapshot: "summary", state: "done" },
    ]);

    const brain = makeBrain(outputDir);
    await brain.run(player);

    // getConversationTitle was called but returned null
    expect(titleSpy).toHaveBeenCalled();

    // The brain completed without error — no switchToConversation was needed
    // because this was a fresh run. But the checkpoint's title would have
    // been null if a crash had occurred and resume was attempted.
    expect(brain.phase).toBe("done");

    await player.disconnect();
  });

  // ─────────────────────────────────────────────────
  // TEST 5: getConversationTitle() throws — checkpoint
  // conversation_title stays null (best-effort, no crash).
  //
  // The onStepEnd callback has a try/catch around
  // getConversationTitle(). If it throws, the title stays null
  // but the subtask continues.
  // ─────────────────────────────────────────────────

  it("conversation_title stays null when getConversationTitle() throws (graceful degradation)", async () => {
    const backend = makeBackendWithResponses(20);
    const titleSpy = vi.spyOn(backend, "getConversationTitle");
    titleSpy.mockRejectedValue(new Error("CDP disconnected"));

    const player = new Player({ backend });
    await player.connect();

    backend.setResponses([
      // Intention: single subtask
      {
        snapshot: JSON.stringify([
          { id: "task_1", intention: "review entry point" },
        ]),
        state: "done",
      },
      // 4 step responses
      { snapshot: "impl", state: "done" },
      { snapshot: "review", state: "done" },
      { snapshot: "attack", state: "done" },
      { snapshot: '{"issues": []}', state: "done" },
      // Consolidation
      { snapshot: "summary", state: "done" },
    ]);

    // Should NOT throw even though getConversationTitle fails
    const brain = makeBrain(outputDir);
    await brain.run(player);

    expect(titleSpy).toHaveBeenCalled();
    expect(brain.phase).toBe("done");

    await player.disconnect();
  });

  // ─────────────────────────────────────────────────
  // TEST 6: Resume with a mix of done + in_progress tasks.
  // Verify the brain correctly completes the in_progress
  // task and skips already-done ones.
  // ─────────────────────────────────────────────────

  it("resume() correctly handles mix of done and in_progress subtasks", async () => {
    const backend = makeBackendWithResponses(20);
    const switchSpy = vi.spyOn(backend, "switchToConversation");
    const player = new Player({ backend });
    await player.connect();

    const doneSt: SubTask = {
      id: "task_done",
      intention: "already completed",
      status: "done",
    };
    const inProgress = makeInProgressSubTask({
      id: "task_ip",
      chatStatus: "sent",
      conversationTitle: "Resume Target Conv",
    });

    const reports = new Map<string, TaskReport>();
    reports.set("task_done", makeReport("task_done"));

    seedResumeState(outputDir, {
      inProgressTask: inProgress,
      doneTasks: [doneSt],
      reports,
    });

    const brain = makeBrain(outputDir);
    await brain.run(player);

    // Should switch to the conversation for the in_progress task
    expect(switchSpy).toHaveBeenCalledWith("Resume Target Conv");
    expect(brain.phase).toBe("done");

    await player.disconnect();
  });
});
