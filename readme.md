# Coacker — AI Heuristic Code Review Agent

Multi-agent code review system that operates through IDE automation. Automatically explores your codebase, analyzes implementation details, and performs security audits with role-separated agents.

## Architecture

```
Brain (state machine)  →  Player (task executor)  →  Backend (IDE automation via CDP)
```

### Audit Pipeline

```
Phase 1:     Intention     → Explores project → Splits into review sub-tasks
Per task:    Implement     → Describes code implementation (facts only)
             → Review      → Code quality audit (Blue Team)  [same conversation]
             → Attack      → Business logic flaws (Red Team) [same conversation]
Phase 2.5:   Gap Analyzer  → Finds uncovered areas → Spawns new tasks (iterative)
Phase 3:     Consolidation → AI synthesizes executive summary
```

### Agent Roles

| Role | Job | Focus |
|------|-----|-------|
| **Intention** | Explores project, creates task breakdown | Project structure |
| **Implement** | Describes execution paths, state changes, dependencies | Facts only |
| **Reviewer** (Blue Team) | Engineering quality: leaks, concurrency, validation | Code hygiene |
| **Attacker** (Red Team) | Business logic flaws: auth bypass, state inconsistency | Fatal logic bugs |
| **Gap Analyzer** | Reviews reports, identifies gaps, deduplicates | Completeness |
| **Consolidator** | Synthesizes all findings into executive summary | Final report |

### Packages

```
packages/
├── shared/    — Types, config, logger
├── backend/   — IDE automation (Antigravity CDP + Mock)
├── player/    — Task execution (multi-step conversation management)
├── brain/     — State machine orchestrator + audit prompts
└── cli/       — CLI entry point + E2E tests
```

## Quick Start

```bash
# 1. Install dependencies
pnpm install

# 2. Configure
cp config.example.toml config.toml
# Edit config.toml — set project entry file and intent

# 3. Run audit
npx tsx packages/cli/src/main.ts
```

## Usage

```typescript
import { AgBackend } from '@coacker/backend';
import { Brain, INTENTION_SYSTEM_PROMPT, IMPLEMENTATION_SYSTEM_PROMPT,
  REVIEWER_SYSTEM_PROMPT, ATTACKER_SYSTEM_PROMPT,
  GAP_ANALYZER_SYSTEM_PROMPT, CONSOLIDATION_SYSTEM_PROMPT } from '@coacker/brain';
import { Player } from '@coacker/player';

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
    gap_analyzer: GAP_ANALYZER_SYSTEM_PROMPT,
    consolidator: CONSOLIDATION_SYSTEM_PROMPT,
  },
});
const brain = new Brain({
  project: { root: '.', entry: 'src/main.ts', intent: 'Review this project' },
  audit: { maxGapRounds: 1, maxSubTasks: 5 },
});

// 2. Connect + Run
await player.connect('MyProject');
const report = await brain.run(player);
console.log(report.toMarkdown());
await player.disconnect();
```

## Configuration

All settings in `config.toml`:

```toml
[project]
root = "."
entry = "src/main.ts"
intent = "Comprehensive code review"

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
type = "audit"

[brain.audit]
maxGapRounds = 2
maxSubTasks = 20

[player]
taskTimeout = 300
```

## License

MIT