/**
 * @coacker/brain/validate — Issue Validator 类型定义
 */

/** 验证阶段 */
export type ValidatePhase =
  | "idle"
  | "fetch_issues"
  | "understanding"
  | "test_generation"
  | "review"
  | "pr_create"
  | "untestable"
  | "draft"
  | "done";

/** 从 GitHub 拉取的 Issue */
export interface IssueItem {
  number: number;
  title: string;
  body: string;
  labels: string[];
}

/** Reviewer 输出的裁决 */
export interface ReviewVerdict {
  verdict: "ACCEPT" | "REJECT";
  logic_review: string;
  audit_review: string;
  verification: string;
  issues: string[];
  summary: string;
}

/** AI 理解分析的输出 */
export interface UnderstandingResult {
  /** 问题本质描述 */
  summary: string;
  /** 影响范围 */
  scope: string;
  /** 预期行为 vs 实际行为 */
  expected_vs_actual: string;
  /** 需要测试的核心逻辑路径 */
  test_targets: string[];
  /** 是否可测试 */
  testable: boolean;
  /** 不可测试的原因 (仅 testable=false 时) */
  untestable_reason?: string;
}

/** 单个 Issue 的验证结果 */
export interface ValidationResult {
  issueNumber: number;
  issueTitle: string;
  outcome: "accepted" | "rejected" | "untestable" | "draft";
  reviewAttempts: number;
  /** 生成的测试代码 */
  testCode?: string;
  /** 测试运行输出 */
  testOutput?: string;
  /** Reviewer 的裁决报告 */
  reviewReport?: ReviewVerdict;
  /** 创建的 PR URL */
  prUrl?: string;
}

/** ValidateBrain 可序列化状态快照 */
export interface ValidateBrainState {
  phase: ValidatePhase;
  currentIssueIndex: number;
  reviewAttempt: number;
  issueQueue: IssueItem[];
  results: ValidationResult[];
  updatedAt: string;
}

/** ValidateBrain 构造参数 */
export interface ValidateBrainOptions {
  /** 项目配置 */
  project: {
    root: string;
    origin: string;
  };
  /** 验证管道配置 */
  validate: {
    maxReviewAttempts: number;
    excludeLabels: string[];
    draftOnFailure: boolean;
  };
  /** 输出配置 */
  output: {
    dir: string;
  };
}
