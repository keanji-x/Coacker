"""
Layer 1: Backend — 抽象后端接口

所有 LLM 调用统一为: 输入文本 → 输出文本
支持 LangChain 和 Bash 两种后端实现，可通过配置切换。
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Optional
import subprocess
import shlex
import os
import json
import time


@dataclass
class BackendResponse:
    """后端统一返回结构"""
    content: str
    model: str = ""
    duration_ms: int = 0
    raw: dict = field(default_factory=dict)


class Backend(ABC):
    """抽象后端基类：prompt in → text out"""

    @abstractmethod
    def query(
        self,
        prompt: str,
        system: str = "",
        temperature: float = 0.3,
        cwd: str = "",
    ) -> BackendResponse:
        """发送 prompt 到 LLM，返回文本结果。cwd 指定工作目录（bash 后端用）。"""
        ...

    @abstractmethod
    def name(self) -> str:
        """后端名称标识"""
        ...


class LangChainBackend(Backend):
    """使用 langchain-openai ChatOpenAI 的后端"""

    def __init__(self, model: str = "gpt-4o", api_key: str = "", base_url: str = ""):
        self._model = model
        self._api_key = api_key or os.environ.get("OPENAI_API_KEY", "")
        self._base_url = base_url

    def name(self) -> str:
        return f"langchain({self._model})"

    def query(
        self,
        prompt: str,
        system: str = "",
        temperature: float = 0.3,
        cwd: str = "",
    ) -> BackendResponse:
        from langchain_openai import ChatOpenAI
        from langchain_core.messages import HumanMessage, SystemMessage

        kwargs = {"model": self._model, "temperature": temperature}
        if self._api_key:
            kwargs["api_key"] = self._api_key
        if self._base_url:
            kwargs["base_url"] = self._base_url

        llm = ChatOpenAI(**kwargs)

        messages = []
        if system:
            messages.append(SystemMessage(content=system))
        messages.append(HumanMessage(content=prompt))

        t0 = time.time()
        response = llm.invoke(messages)
        duration = int((time.time() - t0) * 1000)

        return BackendResponse(
            content=response.content,
            model=self._model,
            duration_ms=duration,
            raw={"usage": getattr(response, "usage_metadata", {})},
        )


class BashBackend(Backend):
    """通过 bash subprocess 调用 CLI LLM 工具的后端

    支持:
      - claude CLI:  echo $PROMPT | claude --print
      - 自定义脚本:   scripts/llm_call.sh "$PROMPT"
    """

    def __init__(
        self,
        command: str = "claude --print",
        timeout: int = 120,
        env: dict = None,
    ):
        # 解析命令为列表, 如 "claude --print" → ["claude", "--print"]
        self._command = shlex.split(command)
        self._command_str = command
        self._timeout = timeout
        # 合并额外环境变量 (如 HTTP_PROXY)
        self._env = None
        if env:
            self._env = {**os.environ, **env}

    def name(self) -> str:
        return f"bash({self._command[0]})"

    def query(
        self,
        prompt: str,
        system: str = "",
        temperature: float = 0.3,
        cwd: str = "",
    ) -> BackendResponse:
        # 构造完整 prompt
        full_prompt = prompt
        if system:
            full_prompt = f"<system>\n{system}\n</system>\n\n{prompt}"

        max_retries = 3
        backoff_delays = [0, 10, 30]  # 第一次不等, 重试等 10s, 再重试等 30s

        for attempt in range(max_retries):
            if attempt > 0:
                delay = backoff_delays[min(attempt, len(backoff_delays) - 1)]
                import sys
                print(f"  [retry] Attempt {attempt + 1}/{max_retries}, waiting {delay}s...", file=sys.stderr)
                time.sleep(delay)

            t0 = time.time()
            try:
                result = subprocess.run(
                    self._command,
                    input=full_prompt,
                    capture_output=True,
                    text=True,
                    timeout=self._timeout,
                    env=self._env,
                    cwd=cwd or None,
                )
                duration = int((time.time() - t0) * 1000)

                if result.returncode != 0:
                    error_msg = result.stderr.strip()
                    # rate limit 或临时错误 → 重试
                    if attempt < max_retries - 1 and ("rate" in error_msg.lower() or "overloaded" in error_msg.lower() or "timeout" in error_msg.lower()):
                        continue
                    return BackendResponse(
                        content=f"[Backend Error] Command failed (exit {result.returncode}): {error_msg}",
                        duration_ms=duration,
                    )

                return BackendResponse(
                    content=result.stdout.strip(),
                    model="claude-cli",
                    duration_ms=duration,
                )
            except subprocess.TimeoutExpired:
                duration = int((time.time() - t0) * 1000)
                if attempt < max_retries - 1:
                    continue  # 超时重试
                return BackendResponse(
                    content=f"[Backend Error] Command timed out after {self._timeout}s (tried {max_retries} times)",
                    duration_ms=duration,
                )
            except FileNotFoundError:
                return BackendResponse(
                    content=f"[Backend Error] '{self._command[0]}' CLI not found. Check your config [bash].llm_command",
                    duration_ms=0,
                )


def create_backend(config: dict) -> Backend:
    """根据配置创建对应的 Backend 实例"""
    backend_type = config.get("backend", {}).get("type", "langchain")

    if backend_type == "bash":
        bash_cfg = config.get("bash", {})
        return BashBackend(
            command=bash_cfg.get("llm_command", "claude --print"),
            timeout=bash_cfg.get("timeout", 120),
            env=bash_cfg.get("env", None),
        )
    else:
        llm_cfg = config.get("llm", {})
        return LangChainBackend(
            model=llm_cfg.get("model", "gpt-4o"),
            api_key=llm_cfg.get("api_key", ""),
            base_url=llm_cfg.get("base_url", ""),
        )
