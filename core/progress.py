"""
Progress Tracker — 断点续跑支持

在 output_dir 中维护 progress.json，记录每个 task 的完成状态。
Pipeline 启动时加载已有进度，跳过已完成的 task。
"""

from __future__ import annotations

import json
import os
import time
from typing import Optional

from core.task import TaskResult


class ProgressTracker:
    """
    追踪 pipeline 执行进度，支持中断续跑。

    progress.json 结构:
    {
        "started_at": "2025-03-11T15:00:00",
        "entry_file": "src/Genesis.sol",
        "user_intent": "...",
        "tasks": {
            "intention":           {"status": "done", "duration_ms": 12345},
            "implement_abc":       {"status": "done", "duration_ms": 67890},
            "review_abc":          {"status": "pending"},
            ...
        },
        "sub_tasks": [...],
        "gap_round": 0
    }
    """

    def __init__(self, output_dir: str):
        self.output_dir = output_dir
        self.filepath = os.path.join(output_dir, "progress.json") if output_dir else ""
        self._data: dict = {}

        if self.filepath and os.path.exists(self.filepath):
            self._load()

    def _load(self):
        """从文件加载进度"""
        try:
            with open(self.filepath, "r", encoding="utf-8") as f:
                self._data = json.load(f)
        except (json.JSONDecodeError, OSError):
            self._data = {}

    def _save(self):
        """保存进度到文件"""
        if not self.filepath:
            return
        os.makedirs(self.output_dir, exist_ok=True)
        with open(self.filepath, "w", encoding="utf-8") as f:
            json.dump(self._data, f, indent=2, ensure_ascii=False)

    def init_run(self, entry_file: str, user_intent: str):
        """初始化新的运行（如果没有已有进度）"""
        if not self._data:
            self._data = {
                "started_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
                "entry_file": entry_file,
                "user_intent": user_intent,
                "tasks": {},
                "sub_tasks": [],
                "gap_round": 0,
            }
            self._save()

    def is_done(self, task_id: str) -> bool:
        """检查 task 是否已完成"""
        task = self._data.get("tasks", {}).get(task_id, {})
        return task.get("status") == "done"

    def mark_done(self, task_id: str, result: TaskResult):
        """标记 task 完成"""
        self._data.setdefault("tasks", {})[task_id] = {
            "status": "done",
            "duration_ms": result.duration_ms,
            "agent_role": result.agent_role,
            "steps": len(result.steps),
        }
        self._save()

    def load_result(self, task_id: str, output_dir: str) -> Optional[TaskResult]:
        """从已保存的中间报告加载 TaskResult"""
        filepath = os.path.join(output_dir, f"{task_id}.md")
        if not os.path.exists(filepath):
            return None

        task_info = self._data.get("tasks", {}).get(task_id, {})
        if task_info.get("status") != "done":
            return None

        try:
            with open(filepath, "r", encoding="utf-8") as f:
                content = f.read()

            # 从 md 文件提取 report 部分
            report = ""
            in_report = False
            lines = content.split("\n")
            for line in lines:
                if line.strip() == "## Report":
                    in_report = True
                    continue
                elif line.strip().startswith("## Step Logs"):
                    break
                elif in_report:
                    report += line + "\n"

            return TaskResult(
                task_id=task_id,
                agent_role=task_info.get("agent_role", ""),
                status="success",
                report=report.strip(),
                duration_ms=task_info.get("duration_ms", 0),
            )
        except OSError:
            return None

    def save_sub_tasks(self, sub_tasks: list[dict]):
        """保存子任务列表（intention 输出）"""
        self._data["sub_tasks"] = sub_tasks
        self._save()

    def get_sub_tasks(self) -> list[dict]:
        """获取已保存的子任务列表"""
        return self._data.get("sub_tasks", [])

    def save_gap_round(self, round_num: int):
        """保存当前 gap round"""
        self._data["gap_round"] = round_num
        self._save()

    def get_gap_round(self) -> int:
        """获取上次的 gap round"""
        return self._data.get("gap_round", 0)

    def summary(self) -> str:
        """返回进度摘要"""
        tasks = self._data.get("tasks", {})
        done = sum(1 for t in tasks.values() if t.get("status") == "done")
        total = len(tasks)
        return f"{done}/{total} tasks completed"
