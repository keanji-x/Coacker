"""
Layer 1: Bash Tools — Agent 可用的 bash 工具集

所有工具通过 subprocess 调用系统命令，提供文件读取、搜索、目录浏览等能力。
带安全沙箱：路径限制、命令白名单、超时。
"""

import os
import subprocess
from dataclasses import dataclass
from typing import Optional


# ─── 安全配置 ─── #

ALLOWED_COMMANDS = {"cat", "head", "tail", "grep", "find", "tree", "wc", "git", "ls", "file"}

DEFAULT_TIMEOUT = 30  # seconds


@dataclass
class BashResult:
    """Bash 命令执行结果"""
    command: str
    stdout: str
    stderr: str
    returncode: int
    duration_ms: int


def run_bash(
    cmd: str,
    cwd: str,
    timeout: int = DEFAULT_TIMEOUT,
    allowed_commands: set = None,
) -> BashResult:
    """
    安全执行 bash 命令。

    安全措施:
    - 命令白名单检查
    - 工作目录锁定
    - 超时限制
    - 禁止写操作命令
    """
    import time
    import shlex

    if allowed_commands is None:
        allowed_commands = ALLOWED_COMMANDS

    # 提取首个命令词做白名单检查
    try:
        parts = shlex.split(cmd)
    except ValueError:
        parts = cmd.split()

    if not parts:
        return BashResult(cmd, "", "Empty command", 1, 0)

    base_cmd = os.path.basename(parts[0])
    if base_cmd not in allowed_commands:
        return BashResult(
            cmd, "",
            f"[Sandbox] Command '{base_cmd}' not in allowed list: {sorted(allowed_commands)}",
            1, 0,
        )

    # 禁止危险参数
    dangerous_flags = {"--delete", "--force", "-rf", "--exec"}
    for part in parts:
        if part in dangerous_flags:
            return BashResult(cmd, "", f"[Sandbox] Dangerous flag '{part}' blocked", 1, 0)

    t0 = time.time()
    try:
        result = subprocess.run(
            cmd,
            shell=True,
            capture_output=True,
            text=True,
            cwd=cwd,
            timeout=timeout,
        )
        duration = int((time.time() - t0) * 1000)
        return BashResult(
            command=cmd,
            stdout=result.stdout,
            stderr=result.stderr,
            returncode=result.returncode,
            duration_ms=duration,
        )
    except subprocess.TimeoutExpired:
        duration = int((time.time() - t0) * 1000)
        return BashResult(cmd, "", f"[Sandbox] Command timed out after {timeout}s", 1, duration)


# ─── 高层工具函数 ─── #

def bash_cat(path: str, cwd: str, max_bytes: int = 50 * 1024) -> BashResult:
    """读取文件内容，超大文件自动截断"""
    abs_path = os.path.abspath(os.path.join(cwd, path))
    abs_cwd = os.path.abspath(cwd)

    if not abs_path.startswith(abs_cwd):
        return BashResult(f"cat {path}", "", f"[Sandbox] Path escapes project root: {path}", 1, 0)

    if max_bytes > 0:
        return run_bash(f"head -c {max_bytes} {shlex.quote(path)}", cwd)
    return run_bash(f"cat {shlex.quote(path)}", cwd)


def bash_grep(pattern: str, path: str, cwd: str, max_results: int = 50) -> BashResult:
    """在文件或目录中搜索模式"""
    import shlex as _shlex
    cmd = f"grep -rn --include='*.py' --include='*.js' --include='*.ts' --include='*.go' --include='*.rs' {_shlex.quote(pattern)} {_shlex.quote(path)} | head -n {max_results}"
    return run_bash(cmd, cwd)


def bash_find(pattern: str, cwd: str, max_depth: int = 5, max_results: int = 50) -> BashResult:
    """搜索文件名"""
    import shlex as _shlex
    cmd = f"find . -maxdepth {max_depth} -name {_shlex.quote(pattern)} -not -path '*/.git/*' -not -path '*/node_modules/*' -not -path '*/__pycache__/*' -not -path '*/.venv/*' | head -n {max_results}"
    return run_bash(cmd, cwd)


def bash_tree(cwd: str, path: str = ".", depth: int = 3) -> BashResult:
    """显示目录树"""
    import shlex as _shlex
    cmd = f"tree -L {depth} -I '.git|node_modules|__pycache__|.venv|*.pyc' {_shlex.quote(path)}"
    result = run_bash(cmd, cwd)
    # fallback 如果没有 tree 命令
    if result.returncode != 0 and "not found" in result.stderr:
        cmd = f"find {_shlex.quote(path)} -maxdepth {depth} -not -path '*/.git/*' | head -n 100 | sort"
        result = run_bash(cmd, cwd)
    return result


def bash_git_diff(cwd: str, staged: bool = False) -> BashResult:
    """查看 git diff"""
    flag = "--staged" if staged else ""
    return run_bash(f"git diff {flag}", cwd)


def bash_wc(path: str, cwd: str) -> BashResult:
    """统计文件行数"""
    import shlex as _shlex
    return run_bash(f"wc -l {_shlex.quote(path)}", cwd)


# ─── 工具注册表 ─── #

import shlex

TOOL_REGISTRY = {
    "cat": {
        "description": "Read file contents. Usage: cat <filepath>",
        "fn": lambda args, cwd: bash_cat(args, cwd),
    },
    "grep": {
        "description": "Search for pattern in files. Usage: grep <pattern> <path>",
        "fn": lambda args, cwd: bash_grep(
            args.split(" ", 1)[0] if " " in args else args,
            args.split(" ", 1)[1] if " " in args else ".",
            cwd,
        ),
    },
    "find": {
        "description": "Find files by name pattern. Usage: find <pattern>",
        "fn": lambda args, cwd: bash_find(args, cwd),
    },
    "tree": {
        "description": "Show directory structure. Usage: tree [path] [depth]",
        "fn": lambda args, cwd: bash_tree(cwd, args.split()[0] if args.strip() else ".", int(args.split()[1]) if len(args.split()) > 1 else 3),
    },
    "git_diff": {
        "description": "Show git diff of current changes. Usage: git_diff",
        "fn": lambda args, cwd: bash_git_diff(cwd),
    },
    "wc": {
        "description": "Count lines in file. Usage: wc <filepath>",
        "fn": lambda args, cwd: bash_wc(args, cwd),
    },
}


def execute_tool(tool_name: str, args: str, cwd: str) -> BashResult:
    """根据工具名执行对应的 bash 工具"""
    tool = TOOL_REGISTRY.get(tool_name)
    if not tool:
        return BashResult(
            f"{tool_name} {args}", "",
            f"[Error] Unknown tool: '{tool_name}'. Available: {list(TOOL_REGISTRY.keys())}",
            1, 0,
        )
    return tool["fn"](args.strip(), cwd)


def get_tools_description(tool_names: list[str]) -> str:
    """生成可用工具的描述文本，供 LLM 理解"""
    lines = ["Available tools:"]
    for name in tool_names:
        tool = TOOL_REGISTRY.get(name)
        if tool:
            lines.append(f"  - {name}: {tool['description']}")
    return "\n".join(lines)
