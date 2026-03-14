# Coacker — AI Heuristic Code Review Agent

Multi-agent code review system that operates through IDE automation. Automatically explores your codebase, analyzes implementation details, and performs security audits with role-separated agents.

## Architecture

```
Brain (orchestrator)  →  Player (context + delegation)  →  Backend (IDE automation via CDP)
```

### Audit Pipeline

```
Phase 1:     Intention     → Explores project → Splits into review sub-tasks
Per task:    Implement     → Describes code implementation (facts only)
             → Review      → Code quality audit (Blue Team)  [same conversation]
             → Attack      → Business logic flaws (Red Team) [same conversation]
Phase 2.5:   Gap Analyzer  → Finds uncovered areas → Spawns new tasks (iterative)
```

### Agent Roles

| Role | Job | Focus |
|------|-----|-------|
| **Intention** | Explores project, creates task breakdown | Project structure |
| **Implement** | Describes execution paths, state changes, dependencies | Facts only |
| **Reviewer** (Blue Team) | Engineering quality: leaks, concurrency, validation | Code hygiene |
| **Attacker** (Red Team) | Business logic flaws: auth bypass, state inconsistency | Fatal logic bugs |
| **Gap Analyzer** | Reviews reports, identifies gaps, deduplicates | Completeness |

### Packages

```
packages/
├── shared/    — Types, config, logger
├── backend/   — IDE automation (Antigravity CDP + Mock)
├── player/    — Task execution (context engineering + result collection)
├── brain/     — Orchestration (dispatcher, knowledge, audit pipeline)
└── cli/       — E2E tests and CLI entry points
```

## Quick Start

```bash
# 1. Install dependencies
pnpm install

# 2. Configure
cp config.example.toml config.toml
# Edit config.toml as needed

# 3. Run audit
npx tsx packages/cli/tests/e2e-audit.test.ts
```

## Usage

```typescript
import { AgBackend } from '@coacker/backend';
import { AuditPipeline } from '@coacker/brain';
import { Player } from '@coacker/player';

// Setup
const backend = new AgBackend({ endpointUrl: 'http://localhost:9222', humanize: true });
const player = new Player({ backend, taskTimeout: 300 });
const pipeline = new AuditPipeline({ maxGapRounds: 1 });

// Connect to IDE
await player.connect('MyProject');

// Run audit
const report = await pipeline.run(player, 'src/main.ts', 'Review this project');
console.log(report.toMarkdown());

await player.disconnect();
```

## Configuration

All settings in `config.toml`:

```toml
[ag]
endpoint_url = "http://localhost:9222"
timeout = 30000
humanize = true

[brain]
max_concurrency = 4
max_gap_rounds = 2

[player]
task_timeout = 300
skills_dir = "./skills"

[knowledge]
store_dir = "./knowledge"
max_entry_size = 50000
```

## License

MIT