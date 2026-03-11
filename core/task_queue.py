"""
Layer 4: TaskQueue — DAG 调度器

管理 Task 的依赖关系和并行执行。
支持:
  - 添加 Task 及其依赖
  - 拓扑排序
  - 并发执行无依赖的 Task (ThreadPoolExecutor)
  - 将上游 Task 的 report 自动注入下游 Context 的 upstream_results
"""

from __future__ import annotations

import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from collections import defaultdict
from typing import Optional

from core.task import Task, TaskResult


class TaskQueue:
    """
    基于 DAG 的任务调度器

    Example:
        q = TaskQueue(max_concurrency=4)
        q.add(task_intention)
        q.add(task_implement_1, depends_on=["intention"])
        q.add(task_implement_2, depends_on=["intention"])
        q.add(task_review_1, depends_on=["implement_1"])
        q.add(task_attack_1, depends_on=["implement_1"])
        results = q.run_all()
    """

    def __init__(self, max_concurrency: int = 4):
        self.max_concurrency = max_concurrency
        self._tasks: dict[str, Task] = {}
        self._deps: dict[str, list[str]] = defaultdict(list)  # task_id → [依赖的 task_id]
        self._results: dict[str, TaskResult] = {}

    def add(self, task: Task, depends_on: list[str] | None = None) -> TaskQueue:
        """添加 task 到队列，可选指定依赖"""
        self._tasks[task.task_id] = task
        if depends_on:
            self._deps[task.task_id] = list(depends_on)
        return self  # 链式调用

    @property
    def results(self) -> dict[str, TaskResult]:
        return dict(self._results)

    def _topo_sort(self) -> list[list[str]]:
        """
        拓扑排序，返回分层列表。
        每一层内的 task 可以并行执行。

        Returns:
            [[layer0_tasks], [layer1_tasks], ...]
        """
        in_degree = {tid: 0 for tid in self._tasks}
        reverse_deps = defaultdict(list)  # dep → [dependents]

        for tid, deps in self._deps.items():
            for dep in deps:
                if dep in self._tasks:
                    in_degree[tid] += 1
                    reverse_deps[dep].append(tid)

        # BFS 分层
        layers = []
        current_layer = [tid for tid, deg in in_degree.items() if deg == 0]

        while current_layer:
            layers.append(list(current_layer))
            next_layer = []
            for tid in current_layer:
                for dependent in reverse_deps.get(tid, []):
                    in_degree[dependent] -= 1
                    if in_degree[dependent] == 0:
                        next_layer.append(dependent)
            current_layer = next_layer

        return layers

    def _inject_upstream(self, task: Task):
        """将已完成的上游 task 结果注入到当前 task 的 context.upstream_results"""
        for dep_id in self._deps.get(task.task_id, []):
            if dep_id in self._results:
                upstream_result = self._results[dep_id]
                task.context.upstream_results[dep_id] = upstream_result.report

    def run_all(self, on_task_start=None, on_task_done=None) -> dict[str, TaskResult]:
        """
        按依赖层级执行所有 Task。

        Args:
            on_task_start: 回调 (task_id) → None，task 开始时调用
            on_task_done:  回调 (task_id, result) → None，task 完成时调用

        Returns:
            { task_id: TaskResult, ... }
        """
        layers = self._topo_sort()

        for layer in layers:
            if len(layer) == 1:
                # 单 task 直接执行
                task = self._tasks[layer[0]]
                self._inject_upstream(task)
                if on_task_start:
                    on_task_start(task.task_id)
                result = task.execute()
                self._results[task.task_id] = result
                if on_task_done:
                    on_task_done(task.task_id, result)
            else:
                # 多 task 并行执行
                with ThreadPoolExecutor(max_workers=min(len(layer), self.max_concurrency)) as pool:
                    futures = {}
                    for tid in layer:
                        task = self._tasks[tid]
                        self._inject_upstream(task)
                        if on_task_start:
                            on_task_start(tid)
                        futures[pool.submit(task.execute)] = tid

                    for future in as_completed(futures):
                        tid = futures[future]
                        try:
                            result = future.result()
                        except Exception as e:
                            result = TaskResult(
                                task_id=tid,
                                agent_role=self._tasks[tid].agent.role,
                                status="error",
                                error=str(e),
                            )
                        self._results[tid] = result
                        if on_task_done:
                            on_task_done(tid, result)

        return dict(self._results)

    def summary(self) -> str:
        """返回执行概要"""
        if not self._results:
            return "No tasks executed yet."

        lines = ["## Execution Summary", ""]
        total_ms = 0
        for tid, result in self._results.items():
            icon = "✅" if result.status == "success" else "❌"
            lines.append(f"- {icon} **{tid}** ({result.agent_role}) — {result.duration_ms}ms, {len(result.steps)} steps")
            total_ms += result.duration_ms

        lines.append(f"\n**Total**: {len(self._results)} tasks, {total_ms}ms")
        return "\n".join(lines)
