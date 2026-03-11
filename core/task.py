"""
Layer 3: Task — 任务封装 (Agent + Context)

每个 Task 绑定一个 Agent 和 Context，执行后产出结构化的 TaskResult。
TaskResult 包含报告正文和完整的 step logs，方便调试和审计。
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any

from pydantic import BaseModel, Field

from core.agent import Agent, AgentResult, StepLog


# ─── 数据模型 ─── #

class TaskContext(BaseModel):
    """Task 的输入上下文"""
    entry_file: str = ""
    user_intent: str = ""
    project_root: str = ""
    upstream_results: dict[str, str] = Field(default_factory=dict)
    extra: dict[str, Any] = Field(default_factory=dict)


class TaskResult(BaseModel):
    """Task 的输出结果"""
    task_id: str
    agent_role: str
    status: str = "pending"            # "pending" | "running" | "success" | "error"
    report: str = ""                   # Markdown 格式的最终报告
    steps: list[dict] = Field(default_factory=list)  # StepLog 序列化
    files_accessed: list[str] = Field(default_factory=list)
    duration_ms: int = 0
    error: str = ""


# ─── Task 类 ─── #

class Task:
    """
    任务 = Agent + Context

    封装了一次完整的 Agent 执行：
    1. 从 Context 构造 user_message
    2. 调用 Agent（带或不带工具）
    3. 将 AgentResult 包装为 TaskResult

    Example:
        task = Task(
            task_id="review_transfer",
            agent=reviewer_agent,
            context=TaskContext(entry_file="main.py", user_intent="Review fund transfer"),
            use_tools=False,
        )
        result = task.execute()
        print(result.report)
    """

    def __init__(
        self,
        task_id: str,
        agent: Agent,
        context: TaskContext,
        prompt_builder: callable = None,
        use_tools: bool = False,
    ):
        self.task_id = task_id
        self.agent = agent
        self.context = context
        self.use_tools = use_tools
        self._prompt_builder = prompt_builder or self._default_prompt

        self.result: TaskResult | None = None

    @staticmethod
    def _default_prompt(ctx: TaskContext) -> str:
        """默认 prompt 构造器"""
        parts = []
        if ctx.entry_file:
            parts.append(f"Entry File: {ctx.entry_file}")
        if ctx.user_intent:
            parts.append(f"User Intent: {ctx.user_intent}")
        for key, value in ctx.upstream_results.items():
            parts.append(f"\n--- {key} ---\n{value}")
        for key, value in ctx.extra.items():
            parts.append(f"\n{key}: {value}")
        return "\n".join(parts)

    def execute(self) -> TaskResult:
        """执行 Task，返回 TaskResult"""
        t0 = time.time()
        user_message = self._prompt_builder(self.context)

        try:
            cwd = self.context.project_root or "."
            if self.use_tools and self.agent.tools:
                agent_result = self.agent.invoke_with_tools(
                    user_message,
                    cwd=cwd,
                )
            else:
                agent_result = self.agent.invoke(user_message, cwd=cwd)

            self.result = TaskResult(
                task_id=self.task_id,
                agent_role=self.agent.role,
                status="success",
                report=agent_result.content,
                steps=[
                    {
                        "step": s.step,
                        "action": s.action,
                        "input": s.input_summary,
                        "output": s.output_summary,
                        "duration_ms": s.duration_ms,
                    }
                    for s in agent_result.steps
                ],
                files_accessed=agent_result.files_accessed,
                duration_ms=int((time.time() - t0) * 1000),
            )
        except Exception as e:
            self.result = TaskResult(
                task_id=self.task_id,
                agent_role=self.agent.role,
                status="error",
                error=str(e),
                duration_ms=int((time.time() - t0) * 1000),
            )

        return self.result

    def __repr__(self):
        status = self.result.status if self.result else "not_started"
        return f"Task(id={self.task_id!r}, agent={self.agent.role!r}, status={status!r})"
