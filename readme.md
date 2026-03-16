# Coacker — AI Heuristic Code Review Agent

Multi-agent code review system that operates through IDE automation. Automatically explores your codebase, analyzes implementation details, performs security audits with role-separated agents, and creates GitHub issues for critical findings.

## Architecture

```
Brain (state machine)  →  Player (task executor)  →  Backend (IDE automation via CDP)
```

### Audit Pipeline

```
Phase 1:     Intention       → Explores project → Splits into review sub-tasks
Per task:    Implement       → Describes code implementation (facts only)
              → Review      → Code quality audit (Blue Team)  [same conversation]
              → Attack      → Business logic flaws (Red Team) [same conversation]
              → Issue       → Creates GitHub issues via `gh` CLI (Critical/High only)
Phase 2.5:   Gap Analyzer   → Finds uncovered areas → Spawns new tasks (iterative)
Phase 3:     Consolidation  → AI synthesizes executive summary
```

### Issue Validator Pipeline

```
Preflight:   Git check        → Ensure clean working tree
Per issue:   Checkout branch  → git checkout -b issue_validator/issue{N}
             Understand       → Read issue + source code, assess testability
             Test Gen         → Write test code (author perspective)
             Review           → Independent review (new conversation, reviewer perspective)
             → ACCEPT         → Commit + gh pr create
             → REJECT         → Retry (max 3) or mark draft
             Cleanup          → Ensure clean state → git checkout mainBranch
```

### Agent Roles

| Role | Job | Focus |
|------|-----|-------|
| **Intention** | Explores project, creates task breakdown | Project structure |
| **Implement** | Describes execution paths, state changes, dependencies | Facts only |
| **Reviewer** (Blue Team) | Engineering quality: leaks, concurrency, validation | Code hygiene |
| **Attacker** (Red Team) | Business logic flaws: auth bypass, state inconsistency | Fatal logic bugs |
| **Issue Proposer** | Creates GitHub issues directly via `gh` CLI | Critical/High findings |
| **Gap Analyzer** | Reviews reports, identifies gaps, deduplicates | Completeness |
| **Consolidator** | Synthesizes all findings into executive summary | Final report |

### Packages

```
packages/
├── shared/    — Types, config, logger
├── backend/   — IDE automation (Antigravity CDP + Mock)
├── player/    — Task execution (multi-step conversation management)
├── brain/     — State machine orchestrator (Audit Brain + Issue Validator Brain)
└── cli/       — CLI entry point + E2E tests
```

### Design Docs

Detailed design documents for each brain:
- [Audit Brain](packages/brain/doc/audit-brain.md) — Multi-agent code review pipeline
- [Issue Validator Brain](packages/brain/doc/issue-validator-brain.md) — Test generation & validation pipeline

## Quick Start

```bash
# 1. Install dependencies
pnpm install

# 2. Configure
cp config.example.toml config.toml
# Edit config.toml — set project entry file, intent, and origin

# 3. Run audit
npx tsx packages/cli/src/main.ts
```

### Prerequisites

- Node.js ≥ 18
- `gh` CLI authenticated (for auto issue creation)
- IDE with CDP debug port enabled (e.g. Cursor with `--remote-debugging-port=9222`)

## Usage

```typescript
import { AgBackend } from '@coacker/backend';
import { Brain, INTENTION_SYSTEM_PROMPT, IMPLEMENTATION_SYSTEM_PROMPT,
  REVIEWER_SYSTEM_PROMPT, ATTACKER_SYSTEM_PROMPT, ISSUE_PROPOSER_SYSTEM_PROMPT,
  GAP_ANALYZER_SYSTEM_PROMPT, CONSOLIDATION_SYSTEM_PROMPT } from '@coacker/brain';
import { Player } from '@coacker/player';

const origin = 'owner/repo';

// 1. Setup
const backend = new AgBackend({ endpointUrl: 'http://localhost:9222', humanize: true });
const player = new Player({
  backend,
  taskTimeout: 300,
  rolePrompts: {
    intention: INTENTION_SYSTEM_PROMPT,
    implementer: IMPLEMENTATION_SYSTEM_PROMPT,
    reviewer: REVIEWER_SYSTEM_PROMPT,
    attacker: ATTACKER_SYSTEM_PROMPT,
    issue_proposer: ISSUE_PROPOSER_SYSTEM_PROMPT(origin),
    gap_analyzer: GAP_ANALYZER_SYSTEM_PROMPT,
    consolidator: CONSOLIDATION_SYSTEM_PROMPT,
  },
});
const brain = new Brain({
  project: { root: '.', entry: 'src/main.ts', intent: 'Review this project', origin },
  audit: { maxGapRounds: 1, maxSubTasks: 5 },
});

// 2. Connect + Run
await player.connect('MyProject');
const report = await brain.run(player);
await player.disconnect();
```

## Configuration

All settings in `config.toml`:

```toml
[project]
root = "."
entry = "src/main.ts"
intent = "Comprehensive code review"
origin = "owner/repo"             # GitHub origin — enables auto issue creation
mainBranch = "main"               # Main branch name (default "main")

[output]
dir = "./output"

[backend]
type = "ag"

[backend.ag]
endpointUrl = "http://localhost:9222"
timeout = 30000
humanize = true
windowTitle = "MyProject"

[brain]
type = "audit"                    # "audit" or "validate"

[brain.audit]
maxGapRounds = 2
maxSubTasks = 20

[brain.validate]
maxReviewAttempts = 3
excludeLabels = ["wontfix", "duplicate", "invalid"]
draftOnFailure = true

[player]
taskTimeout = 300
```

### Key Config Options

| Key | Description |
|-----|-------------|
| `project.origin` | GitHub `owner/repo` — when set, AI creates issues via `gh issue create` |
| `project.entry` | Entry file for analysis (AI starts exploration here) |
| `project.mainBranch` | Main branch name, used as base for feature branches (default `main`) |
| `brain.type` | Brain type: `audit` (code review) or `validate` (issue verification) |
| `brain.audit.maxGapRounds` | How many gap analysis iterations (0 = disable) |
| `brain.audit.maxSubTasks` | Max parallel review sub-tasks |
| `brain.validate.maxReviewAttempts` | Max review-retry loops per issue (default 3) |
| `brain.validate.excludeLabels` | Skip issues with these labels |
| `backend.ag.humanize` | Simulate human typing rhythm (avoids bot detection) |

## Output

Results are saved to `output/` directory:

```
output/
├── state.json              — Brain state (resume support)
├── conversations/          — Full conversation logs per task
├── reports/                — Per-task structured reports
└── report.md               — Final consolidated audit report
```

Each step captures a **panel snapshot** (full `innerText` of the IDE panel) for debugging and audit trail purposes.

## License

MIT