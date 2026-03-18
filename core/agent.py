"""
Layer 2: Agent — 角色封装

每个 Agent 有固定的 role、system_prompt、output_format，
并通过注入的 Backend 实例执行 LLM 调用。

支持两种调用模式:
1. invoke()           — 单次 prompt → response（无工具）
2. invoke_with_tools() — ReAct 循环: LLM 决策 → 调用工具 → 反馈 → 再推理
"""

from __future__ import annotations

import json
import re
import time
from dataclasses import dataclass, field
from typing import Optional, Type

from pydantic import BaseModel

from core.backend import Backend, BackendResponse
from tools.bash_tools import execute_tool, get_tools_description, BashResult


@dataclass
class StepLog:
    """记录一次执行步骤"""
    step: int
    action: str         # "llm_query" | "tool:cat" | "tool:grep" | ...
    input_summary: str  # 命令或 prompt 的摘要（截断）
    output_summary: str # 结果摘要（截断）
    duration_ms: int = 0


@dataclass
class AgentResult:
    """Agent 执行的完整结果"""
    content: str            # 最终输出文本
    steps: list[StepLog] = field(default_factory=list)
    total_duration_ms: int = 0
    files_accessed: list[str] = field(default_factory=list)


def _truncate(text: str, limit: int = 500) -> str:
    if len(text) <= limit:
        return text
    return text[:limit] + f"... [{len(text) - limit} chars truncated]"


class Agent:
    """
    角色 Agent：绑定 role + system_prompt + backend

    Example:
        agent = Agent(
            role="reviewer",
            system_prompt="You are a code reviewer...",
            backend=my_backend,
            tools=["cat", "grep"],
        )
        result = agent.invoke_with_tools("Review this file: main.py", cwd="/project")
    """

    def __init__(
        self,
        role: str,
        system_prompt: str,
        backend: Backend,
        tools: list[str] | None = None,
        output_format: str = "markdown",  # "markdown" | "json"
        output_schema: Type[BaseModel] | None = None,
        temperature: float = 0.3,
        max_steps: int = 15,
        read_only: bool = True,
    ):
        self.role = role
        self.system_prompt = system_prompt
        self.backend = backend
        self.tools = tools or []
        self.output_format = output_format
        self.output_schema = output_schema
        self.temperature = temperature
        self.max_steps = max_steps
        self.read_only = read_only

    def invoke(self, user_message: str, cwd: str = "") -> AgentResult:
        """单次调用（无工具），适合 intention/reviewer/attacker"""
        t0 = time.time()

        system = self.system_prompt
        if self.output_format == "json" and self.output_schema:
            system += f"\n\nOutput STRICTLY valid JSON matching this schema:\n{json.dumps(self.output_schema.model_json_schema(), indent=2)}"

        response = self.backend.query(
            prompt=user_message,
            system=system,
            temperature=self.temperature,
            cwd=cwd,
        )

        step = StepLog(
            step=1,
            action="llm_query",
            input_summary=_truncate(user_message, 200),
            output_summary=_truncate(response.content, 200),
            duration_ms=response.duration_ms,
        )

        return AgentResult(
            content=response.content,
            steps=[step],
            total_duration_ms=int((time.time() - t0) * 1000),
        )

    def invoke_with_tools(self, user_message: str, cwd: str) -> AgentResult:
        """
        带工具的 ReAct 循环:
        1. LLM 收到 prompt + tools 描述
        2. LLM 输出 TOOL_CALL: tool_name arg1 arg2  或 最终报告
        3. 执行工具，把结果反馈给 LLM
        4. 重复直到 LLM 给出最终答案或达到 max_steps
        """
        t0 = time.time()
        steps: list[StepLog] = []
        files_accessed: list[str] = []

        tools_desc = get_tools_description(self.tools, cwd)

        react_instruction = f"""{self.system_prompt}

{tools_desc}

## Interaction Protocol
To use a tool, output a line starting with `TOOL_CALL:` followed by the tool name and arguments.
Example:
  TOOL_CALL: cat src/main.py
  TOOL_CALL: grep "def transfer" .
  TOOL_CALL: find "*.py"
  TOOL_CALL: tree . 2

You will receive the tool output, then you can make another tool call or provide your final answer.
When you are ready to give your final answer, output it WITHOUT any TOOL_CALL prefix.
Do NOT output TOOL_CALL and final answer in the same response.
Maximum {self.max_steps} tool calls allowed."""

        conversation = user_message
        step_num = 0
        tool_history = ""

        for i in range(self.max_steps + 1):
            step_num += 1

            # 构造 prompt：包含工具历史
            if tool_history:
                full_prompt = f"{conversation}\n\n--- Tool History ---\n{tool_history}\n\nContinue your analysis. Use another TOOL_CALL or provide your FINAL answer."
            else:
                full_prompt = conversation

            response = self.backend.query(
                prompt=full_prompt,
                system=react_instruction,
                temperature=self.temperature,
                cwd=cwd,
            )

            content = response.content.strip()

            # 检查是否有 TOOL_CALL
            tool_call_match = re.search(r"TOOL_CALL:\s*(\w+)\s*(.*)", content)

            if tool_call_match:
                tool_name = tool_call_match.group(1)
                tool_args = tool_call_match.group(2).strip()

                # 记录 LLM 步骤
                steps.append(StepLog(
                    step=step_num,
                    action="llm_query",
                    input_summary=_truncate(full_prompt, 200),
                    output_summary=_truncate(content, 200),
                    duration_ms=response.duration_ms,
                ))

                # 执行工具 (并检查 RBAC)
                step_num += 1
                
                is_ro = __import__('tools.bash_tools', fromlist=['']).is_tool_read_only(tool_name)
                if self.read_only and not is_ro:
                    from tools.bash_tools import BashResult
                    tool_result = BashResult(
                        command=f"{tool_name} {tool_args}",
                        stdout="",
                        stderr=f"[Security Denied] Agent '{self.role}' is restricted to Read-Only mode and cannot execute '{tool_name}'.",
                        returncode=403,
                        duration_ms=0
                    )
                else:
                    tool_result = execute_tool(tool_name, tool_args, cwd)

                if tool_name == "cat" and tool_result.returncode == 0:
                    files_accessed.append(tool_args)

                tool_output = tool_result.stdout if tool_result.returncode == 0 else tool_result.stderr
                steps.append(StepLog(
                    step=step_num,
                    action=f"tool:{tool_name}",
                    input_summary=f"{tool_name} {tool_args}",
                    output_summary=_truncate(tool_output, 300),
                    duration_ms=tool_result.duration_ms,
                ))

                # 追加到工具历史
                tool_history += f"\n[Step {step_num}] {tool_name} {tool_args}\n"
                tool_history += f"Output:\n{_truncate(tool_output, 2000)}\n"

            else:
                # 没有 TOOL_CALL → 这就是最终答案
                steps.append(StepLog(
                    step=step_num,
                    action="llm_query",
                    input_summary=_truncate(full_prompt, 200),
                    output_summary=_truncate(content, 200),
                    duration_ms=response.duration_ms,
                ))
                break

        total_ms = int((time.time() - t0) * 1000)

        return AgentResult(
            content=content,
            steps=steps,
            total_duration_ms=total_ms,
            files_accessed=files_accessed,
        )

    def __repr__(self):
        return f"Agent(role={self.role!r}, backend={self.backend.name()}, tools={self.tools})"
