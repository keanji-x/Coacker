import os
import shlex
import subprocess
import time
from tools.bash_tools import BashResult

POC_DIR = "tests/audit_poc"

def init_sandbox(cwd: str):
    abs_poc = os.path.join(cwd, POC_DIR)
    os.makedirs(abs_poc, exist_ok=True)
    return abs_poc

def sandbox_write_file(args: str, cwd: str) -> BashResult:
    """Takes args dynamically. Format: <filename>\n<content>"""
    parts = args.split("\n", 1)
    if len(parts) < 2:
        return BashResult("sandbox_write_file", "", "[Sandbox] Need filename and content separated by newline.", 1, 0)
    filename, content = parts[0].strip(), parts[1]
    
    abs_poc = init_sandbox(cwd)
    safe_name = os.path.basename(filename)
    filepath = os.path.join(abs_poc, safe_name)
    try:
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(content)
        return BashResult("sandbox_write_file", f"Successfully wrote to {POC_DIR}/{safe_name}", "", 0, 0)
    except Exception as e:
        return BashResult("sandbox_write_file", "", str(e), 1, 0)

def sandbox_execute(command: str, cwd: str) -> BashResult:
    """Executes a command safely, restricted to cargo and forge."""
    init_sandbox(cwd)
    try:
        cmd_parts = shlex.split(command)
    except ValueError as e:
        return BashResult("sandbox_execute", "", f"[Sandbox] Parse error: {e}", 1, 0)

    if not cmd_parts or cmd_parts[0] not in ["cargo", "forge"]:
        return BashResult("sandbox_execute", "", "[Sandbox] Only 'cargo' or 'forge' commands are permitted.", 1, 0)
    
    # Block dangerous arguments
    dangerous = {"--config", "run", "build.rs"}
    for p in cmd_parts:
        if p in dangerous:
            return BashResult("sandbox_execute", "", f"[Sandbox] Dangerous argument '{p}' blocked.", 1, 0)

    t0 = time.time()
    try:
        result = subprocess.run(
            cmd_parts,
            shell=False,
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=180
        )
        duration = int((time.time() - t0) * 1000)
        output = result.stdout
        if result.stderr:
            output += "\n--- STDERR ---\n" + result.stderr
        return BashResult(f"sandbox_execute {command}", output, result.stderr, result.returncode, duration)
    except subprocess.TimeoutExpired:
        duration = 180000
        return BashResult(f"sandbox_execute {command}", "", "[Sandbox] Timeout expired after 180s.", 1, duration)
