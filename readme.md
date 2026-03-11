# Coacker — AI Heuristic Code Review Agent

Multi-agent code review system powered by LLM backends (Claude CLI / LangChain). Automatically explores your codebase, analyzes implementation details, and performs security audits with role-separated agents.

## Architecture

```
Phase 1:   Intention (with tools) → Explores project → Splits into review tasks
Phase 2:   Implement × N (parallel) → Describes code implementation facts
Phase 2.5: Gap Analyzer → Finds uncovered areas → Spawns new tasks (iterative)
Phase 3:   Review + Attack × N (parallel) → Code quality + Security audit
```

### Agent Roles

| Role | Job | Doesn't Do |
|------|-----|------------|
| **Intention** | Explores project with `tree`/`find`/`cat`, creates task breakdown | — |
| **Implement** | Describes execution paths, state changes, dependencies (facts only) | No opinions or auditing |
| **Reviewer** (Blue Team) | Engineering quality: leaks, concurrency, validation, naming | No business logic |
| **Attacker** (Red Team) | Business logic flaws: auth bypass, state inconsistency, reentrancy | No style issues |
| **Gap Analyzer** | Reviews all implement reports, identifies gaps, deduplicates | — |

### 4-Layer Design

```
Backend (LLM interface)  →  Agent (role + prompt)  →  Task (agent + context)  →  TaskQueue (DAG scheduler)
```

## Quick Start

```bash
# 1. Install dependencies
pip install uv
uv venv && source .venv/bin/activate
uv pip install rich pydantic tomli pathspec

# 2. Configure
cp config.example.toml config.toml
# Edit config.toml: set project_path, backend, proxy settings, etc.

# 3. Run
PYTHONPATH=. .venv/bin/python cli/main.py
```

## Usage

```bash
# Full project audit (no entry file needed)
PYTHONPATH=. .venv/bin/python cli/main.py \
  -p /path/to/project \
  --intent "security audit for smart contracts"

# With specific entry file
PYTHONPATH=. .venv/bin/python cli/main.py \
  -p /path/to/project \
  --entry src/main.sol \
  --intent "review fund transfer logic"

# Intent is optional — defaults to comprehensive review
PYTHONPATH=. .venv/bin/python cli/main.py -p /path/to/project

# Verbose mode (show step-by-step logs)
PYTHONPATH=. .venv/bin/python cli/main.py -v

# Custom output directory
PYTHONPATH=. .venv/bin/python cli/main.py -o ./my_reports
```

## Configuration

All settings in `config.toml`:

```toml
[backend]
type = "bash"                    # "bash" (CLI) or "langchain" (SDK)

[bash]
llm_command = "claude --print"   # Any CLI LLM command
timeout = 300                    # Seconds per LLM call
allowed_commands = ["cat", "grep", "find", "tree", "wc", "git", "ls"]

[bash.env]                       # Environment variables for subprocess
HTTP_PROXY = "http://127.0.0.1:10809"

[pipeline]
max_concurrency = 4              # Parallel task limit
max_gap_rounds = 2               # Gap Analyzer iteration limit (0 = disable)

[review]
project_path = "/path/to/project"
entry_file = ""                  # Optional: leave empty for full project scan
intent = ""                      # Optional: leave empty for comprehensive review

[output]
output_dir = "./output"          # Reports directory
```

## Output

All reports are saved to `output_dir/`:

```
output/
├── progress.json                 # Checkpoint for interrupt-resume
├── intention.md                  # Task breakdown
├── implement_*.md                # Implementation analysis per task
├── gap_analysis_round_*.md       # Gap analyzer results
├── review_*.md                   # Code quality review per task
├── attack_*.md                   # Security audit per task
└── report.md                     # Final consolidated report
```

## Interrupt & Resume

Pipeline supports checkpoint-based resume. If interrupted (Ctrl+C), just re-run the same command — completed tasks are skipped automatically:

```bash
# First run (interrupted)
PYTHONPATH=. .venv/bin/python cli/main.py
# ^C

# Resume — skips completed tasks
PYTHONPATH=. .venv/bin/python cli/main.py
# ↻ Resuming from checkpoint (25/36 tasks completed)
# ⏭ intention (cached)
# ⏭ implement_genesis (cached)
# ▶ attack_runtime_config starting...  ← continues from here
```

To start fresh: delete `output/progress.json` or use a different `--output-dir`.

## Features

- **Project-wide audit**: Agents freely explore the entire project with tools
- **Parallel execution**: TaskQueue with DAG-based scheduling
- **Gap analysis**: Iterative loop to catch missed code paths
- **Deduplication**: Removes redundant analysis across tasks
- **Exponential backoff retry**: Handles rate limits and timeouts (3 attempts)
- **Checkpoint resume**: `progress.json` tracks completion for interrupt-safe runs
- **Configurable backend**: Swap between Claude CLI, OpenAI SDK, or any LLM CLI tool

## License

MIT