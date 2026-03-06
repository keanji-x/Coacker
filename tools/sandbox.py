import os
import pathspec
from core.config import get_sandbox_config

def _get_max_file_size():
    cfg = get_sandbox_config()
    return cfg.get("max_file_size_kb", 50) * 1024

def _get_ignore_patterns():
    cfg = get_sandbox_config()
    return cfg.get("ignore_patterns", [".git/", "node_modules/", "venv/", "__pycache__/"])

def get_ignore_spec(root_path: str) -> pathspec.PathSpec:
    """Read .gitignore if exists, merge with config patterns."""
    patterns = list(_get_ignore_patterns())
    gitignore_path = os.path.join(root_path, '.gitignore')
    if os.path.exists(gitignore_path):
        with open(gitignore_path, 'r') as f:
            patterns.extend(f.read().splitlines())
    return pathspec.PathSpec.from_lines('gitwildmatch', patterns)

def read_file_safely(file_path: str, root_dir: str) -> str:
    """Read a file with size truncation and blacklist checks."""
    abs_path = os.path.abspath(file_path)
    abs_root = os.path.abspath(root_dir)

    if not abs_path.startswith(abs_root):
        return f"[Error] Access denied. Path {file_path} is outside the project root {root_dir}."

    rel_path = os.path.relpath(abs_path, abs_root)
    spec = get_ignore_spec(abs_root)

    if spec.match_file(rel_path):
        return f"[Error] Path {rel_path} is ignored by .gitignore / config rules."

    if not os.path.exists(abs_path):
        return f"[Error] File not found: {rel_path}"

    if not os.path.isfile(abs_path):
        return f"[Error] Path is not a file: {rel_path}"

    max_size = _get_max_file_size()
    size = os.path.getsize(abs_path)
    try:
        with open(abs_path, 'r', encoding='utf-8') as f:
            if size > max_size:
                content = f.read(max_size)
                return content + f"\n\n...[Truncated: file size {size} bytes exceeds limit {max_size} bytes]"
            return f.read()
    except UnicodeDecodeError:
        return f"[Error] Cannot read {rel_path} as text. It might be a binary file."
    except Exception as e:
        return f"[Error] Failed to read {rel_path}: {str(e)}"

# Simple cache dictionary acting as the Visited Cache
_read_cache = {}

def read_file_with_cache(file_path: str, root_dir: str) -> str:
    abs_path = os.path.abspath(file_path)
    if abs_path in _read_cache:
        return _read_cache[abs_path]

    content = read_file_safely(file_path, root_dir)
    if not content.startswith("[Error]"):
        _read_cache[abs_path] = content
    return content
