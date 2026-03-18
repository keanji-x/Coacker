/**
 * @coacker/brain/validate — ValidateBrain 状态机
 *
 * Brain 是决策者：驱动验证流程，管理状态，委托任务构造/解析/持久化给子模块。
 *
 * 流程:
 *   Phase 0:   Fetch Issues → 从 GitHub 拉取待验证 issues
 *   Phase 1:   Understanding + Test Generation (Conv A — 作者视角)
 *   Phase 2:   Review (Conv B — 审查者视角, 新对话)
 *   Phase 2b:  Retry loop (最多 maxReviewAttempts 次)
 *   Phase 3:   PR Create (ACCEPT) 或 Draft (REJECT/untestable)
 */

import type { Player } from "@coacker/player";
import type { TaskResult } from "@coacker/shared";
import { Logger } from "@coacker/shared";

import type {
  IssueItem,
  ValidationResult,
  ValidatePhase,
  ValidateBrainOptions,
  ValidateBrainState,
  ReviewVerdict,
} from "./types.js";
import {
  buildUnderstandAndGenTask,
  buildReviewTask,
  buildRetryGenTask,
  buildPrCreateTask,
} from "./task-builder.js";
import {
  getStepSnapshot,
  parseUnderstanding,
  parseTestGenResult,
  parseReviewVerdict,
} from "./result-parser.js";
import {
  ensureOutputDirs,
  persistState,
  persistResult,
  persistConversation,
  persistMarkdownReport,
  loadState,
  loadResults,
} from "./persister.js";

export class ValidateBrain {
  // ── 配置 ──
  private readonly maxReviewAttempts: number;
  private readonly excludeLabels: string[];
  private readonly draftOnFailure: boolean;
  private readonly origin: string;
  private readonly outputDir: string;

  // ── 状态机 ──
  private _phase: ValidatePhase = "idle";
  private issueQueue: IssueItem[] = [];
  private results: ValidationResult[] = [];
  private currentIssueIndex = 0;
  private reviewAttempt = 0;

  // ── 历史 ──
  private _history: TaskResult[] = [];

  private log: Logger;

  constructor(options: ValidateBrainOptions) {
    this.maxReviewAttempts = options.validate.maxReviewAttempts;
    this.excludeLabels = options.validate.excludeLabels;
    this.draftOnFailure = options.validate.draftOnFailure;
    this.origin = options.project.origin;
    this.outputDir = options.output.dir;
    this.log = new Logger("brain:validate");

    ensureOutputDirs(this.outputDir);
  }

  /** 当前阶段 */
  get phase(): ValidatePhase {
    return this._phase;
  }

  /** 所有任务执行历史 */
  get history(): readonly TaskResult[] {
    return this._history;
  }

  /** 验证结果 */
  get validationResults(): readonly ValidationResult[] {
    return this.results;
  }

  /**
   * 运行完整的验证流程
   */
  async run(player: Player, issues?: IssueItem[]): Promise<ValidationResult[]> {
    this.log.info("▶ ValidateBrain starting");

    // ── 检查是否可恢复 ──
    const savedState = loadState(this.outputDir);
    if (
      savedState &&
      savedState.phase !== "idle" &&
      savedState.phase !== "done"
    ) {
      this.log.info(
        `♻ Found resumable state: phase=${savedState.phase}, ` +
          `issues=${savedState.issueQueue.length}, ` +
          `completed=${savedState.results.length}`,
      );
      return this.resume(player, savedState);
    }

    // ── Phase 0: Fetch Issues ──
    this._phase = "fetch_issues";
    this.log.info("── Phase 0: Fetch Issues ──");

    if (issues) {
      // 直接注入 (测试/编程用)
      this.issueQueue = issues;
    } else {
      // 从 GitHub 拉取
      this.issueQueue = await this.fetchIssuesFromGitHub(player);
    }

    this.log.info(`  📋 ${this.issueQueue.length} issues to validate`);
    this.persistCurrentState();

    if (this.issueQueue.length === 0) {
      this._phase = "done";
      this.persistCurrentState();
      return [];
    }

    // ── 逐个验证 ──
    for (let i = 0; i < this.issueQueue.length; i++) {
      this.currentIssueIndex = i;
      await this.validateSingleIssue(this.issueQueue[i], player);
    }

    // ── Done ──
    this._phase = "done";
    persistMarkdownReport(this.outputDir, this.results);
    this.persistCurrentState();
    this.log.info(
      `✅ ValidateBrain finished. ${this.results.length} issues validated, ` +
        `${this._history.length} total executions.`,
    );
    return this.results;
  }

  // ─── Private Helpers ───────────────────────────

  /**
   * 验证单个 Issue (核心循环)
   */
  private async validateSingleIssue(
    issue: IssueItem,
    player: Player,
  ): Promise<void> {
    this.log.info(`\n── Validating Issue #${issue.number}: ${issue.title} ──`);

    // Phase 1: Understanding + Test Generation (同一对话)
    this._phase = "understanding";
    this.reviewAttempt = 0;
    this.persistCurrentState();

    const genTask = buildUnderstandAndGenTask(issue);
    const genResult = await player.executeTask(genTask);
    this._history.push(genResult);
    persistConversation(this.outputDir, genTask, genResult);

    // 检查 understanding 是否标记 untestable
    const understandingSnapshot = getStepSnapshot(genResult, "understand");
    const understanding = parseUnderstanding(understandingSnapshot);

    if (!understanding.testable) {
      this.log.info(
        `  ⏭ Issue #${issue.number} marked untestable: ${understanding.untestable_reason}`,
      );
      const result: ValidationResult = {
        issueNumber: issue.number,
        issueTitle: issue.title,
        outcome: "untestable",
        reviewAttempts: 0,
        testCode: "",
      };
      this.results.push(result);
      persistResult(this.outputDir, issue.number, result);
      this.persistCurrentState();
      return;
    }

    // 检查 test_gen 是否标记 untestable
    this._phase = "test_generation";
    this.persistCurrentState();

    const testGenSnapshot = getStepSnapshot(genResult, "test_gen");
    const testGenParsed = parseTestGenResult(testGenSnapshot);

    if (testGenParsed.untestable) {
      this.log.info(
        `  ⏭ Issue #${issue.number} test gen marked untestable: ${testGenParsed.reason}`,
      );
      const result: ValidationResult = {
        issueNumber: issue.number,
        issueTitle: issue.title,
        outcome: "untestable",
        reviewAttempts: 0,
        testCode: "",
      };
      this.results.push(result);
      persistResult(this.outputDir, issue.number, result);
      this.persistCurrentState();
      return;
    }

    // Phase 2: Review loop
    let testCode = testGenParsed.testCode;
    let testOutput = testGenParsed.testOutput;
    let lastVerdict: ReviewVerdict | undefined;

    for (
      this.reviewAttempt = 1;
      this.reviewAttempt <= this.maxReviewAttempts;
      this.reviewAttempt++
    ) {
      this._phase = "review";
      this.persistCurrentState();

      this.log.info(
        `  🔍 Review attempt ${this.reviewAttempt}/${this.maxReviewAttempts}`,
      );

      // Review (新对话 — 视角隔离)
      const reviewTask = buildReviewTask(issue, testCode, testOutput);
      const reviewResult = await player.executeTask(reviewTask);
      this._history.push(reviewResult);
      persistConversation(this.outputDir, reviewTask, reviewResult);

      const reviewSnapshot = getStepSnapshot(reviewResult, "review");
      lastVerdict = parseReviewVerdict(reviewSnapshot);

      if (lastVerdict.verdict === "ACCEPT") {
        this.log.info(`  ✅ Issue #${issue.number} ACCEPTED`);

        // PR Create
        this._phase = "pr_create";
        this.persistCurrentState();

        const prTask = buildPrCreateTask(issue, this.origin);
        const prResult = await player.executeTask(prTask);
        this._history.push(prResult);
        persistConversation(this.outputDir, prTask, prResult);

        const result: ValidationResult = {
          issueNumber: issue.number,
          issueTitle: issue.title,
          outcome: "accepted",
          reviewAttempts: this.reviewAttempt,
          testCode,
          reviewReport: lastVerdict,
        };
        this.results.push(result);
        persistResult(this.outputDir, issue.number, result);
        this.persistCurrentState();
        return;
      }

      // REJECTED — 重试 (如果还有机会)
      this.log.info(
        `  ❌ Issue #${issue.number} REJECTED: ${lastVerdict.summary}`,
      );

      if (this.reviewAttempt < this.maxReviewAttempts) {
        // 新对话, 携带 reviewer 反馈重新生成
        const retryTask = buildRetryGenTask(
          issue,
          lastVerdict,
          this.reviewAttempt + 1,
        );
        const retryResult = await player.executeTask(retryTask);
        this._history.push(retryResult);
        persistConversation(this.outputDir, retryTask, retryResult);

        const retryTestSnapshot = getStepSnapshot(retryResult, "test_gen");
        const retryParsed = parseTestGenResult(retryTestSnapshot);

        if (retryParsed.untestable) {
          this.log.info(`  ⏭ Issue #${issue.number} retry marked untestable`);
          break;
        }

        testCode = retryParsed.testCode;
        testOutput = retryParsed.testOutput;
      }
    }

    // 所有重试用尽 → draft
    this._phase = "draft";
    this.persistCurrentState();

    const outcome = this.draftOnFailure ? "draft" : "rejected";
    this.log.info(
      `  📝 Issue #${issue.number} marked ${outcome} after ${this.reviewAttempt} attempts`,
    );

    const result: ValidationResult = {
      issueNumber: issue.number,
      issueTitle: issue.title,
      outcome,
      reviewAttempts: this.reviewAttempt,
      testCode,
      reviewReport: lastVerdict,
    };
    this.results.push(result);
    persistResult(this.outputDir, issue.number, result);
    this.persistCurrentState();
  }

  /**
   * 从 GitHub 拉取待验证 issues (使用 gh CLI)
   *
   * 拉取 origin repo 的所有 open issues, 然后过滤掉 excludeLabels 黑名单
   */
  private async fetchIssuesFromGitHub(_player: Player): Promise<IssueItem[]> {
    const { execSync } = await import("node:child_process");

    if (!this.origin) {
      this.log.warn("No origin configured — cannot fetch issues from GitHub");
      return [];
    }

    this.log.info(`  📡 Fetching issues from ${this.origin}...`);

    try {
      const raw = execSync(
        `gh issue list --repo ${this.origin} --state open --json number,title,body,labels --limit 100`,
        { encoding: "utf-8", timeout: 30_000 },
      );

      const issues = JSON.parse(raw) as Array<{
        number: number;
        title: string;
        body: string;
        labels: Array<{ name: string }>;
      }>;

      // 黑名单过滤: 排除带有 excludeLabels 的 issues
      const filtered = issues.filter((issue) => {
        const labelNames = issue.labels.map((l) => l.name);
        return !labelNames.some((name) => this.excludeLabels.includes(name));
      });

      this.log.info(
        `  📋 Fetched ${issues.length} issues, ${filtered.length} after exclude filter`,
      );

      return filtered.map((issue) => ({
        number: issue.number,
        title: issue.title,
        body: issue.body,
        labels: issue.labels.map((l) => l.name),
      }));
    } catch (err) {
      this.log.error(`Failed to fetch issues: ${err}`);
      return [];
    }
  }

  /**
   * 从断点恢复验证流程
   */
  private async resume(
    player: Player,
    savedState: ValidateBrainState,
  ): Promise<ValidationResult[]> {
    this._phase = savedState.phase;
    this.issueQueue = savedState.issueQueue;
    this.results = loadResults(this.outputDir);
    this.currentIssueIndex = savedState.currentIssueIndex;
    this.reviewAttempt = savedState.reviewAttempt;

    this.log.info(
      `  ♻ Restored: phase=${this._phase}, ` +
        `issues=${this.issueQueue.length}, ` +
        `completed=${this.results.length}`,
    );

    // 从上次中断的 issue 继续
    const completedNumbers = new Set(this.results.map((r) => r.issueNumber));
    for (let i = this.currentIssueIndex; i < this.issueQueue.length; i++) {
      if (completedNumbers.has(this.issueQueue[i].number)) continue;
      this.currentIssueIndex = i;
      await this.validateSingleIssue(this.issueQueue[i], player);
    }

    this._phase = "done";
    persistMarkdownReport(this.outputDir, this.results);
    this.persistCurrentState();
    this.log.info(
      `✅ ValidateBrain resumed and finished. ${this.results.length} issues validated.`,
    );
    return this.results;
  }

  /** 持久化当前状态快照 */
  private persistCurrentState(): void {
    persistState(this.outputDir, {
      phase: this._phase,
      currentIssueIndex: this.currentIssueIndex,
      reviewAttempt: this.reviewAttempt,
      issueQueue: this.issueQueue,
      results: this.results,
      updatedAt: new Date().toISOString(),
    });
  }
}
