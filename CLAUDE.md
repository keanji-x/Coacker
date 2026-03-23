# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is Coacker

Coacker is a multi-agent AI code review system that operates through IDE automation (CDP). It explores a codebase, performs security audits with role-separated agents (Blue Team / Red Team), and creates GitHub issues for critical findings. It also validates existing issues by generating tests and creating PRs.

## Commands

All development commands use `just` (task runner). Run `just` to see all recipes.

```bash
# Install
pnpm install

# Type check all packages (or one: just check-pkg shared)
just check

# Lint
just lint          # check
just lint-fix      # auto-fix

# Format
just fmt           # write
just fmt-check     # check only

# Test (vitest)
just test

# All checks (typecheck + lint + format check)
just ci

# Everything (ci + tests)
just all

# Run the CLI
just run                    # default audit
just run -- --validate      # validate mode

# E2E tests (requires IDE with CDP)
just e2e
```

Single test file: `npx vitest run packages/brain/src/audit/__tests__/toctou-split-brain.test.ts`

CLI entry point runs via tsx: `npx tsx packages/cli/src/main.ts`

## Architecture

pnpm monorepo with 5 TypeScript packages. Dependency flow is strictly one-directional:

```
CLI → Brain → Player → Backend → Shared
              ↓
           Toolkit (optional: AstAnalyzer, McpClient, Sandbox)
```

### Package Responsibilities

- **shared** (`@coacker/shared`) — Types (`Task`, `StepResult`, `TaskResult`, `Config`), TOML config loader, colored logger
- **backend** (`@coacker/backend`) — Two layers:
  - **Backend** (对话层): Unified `Backend` interface. `AgBackend` (CDP) is the primary implementation, `MockBackend` for tests
  - **Toolkit** (工具层): Optional auxiliary tools that Brain uses to pre-process context before dispatching tasks:
    - `AstAnalyzer` — TreeSitter AST extraction for millisecond-fast code slicing
    - `McpClient` — MCP protocol client for LSP tools (find_references, get_definition)
    - `Sandbox` — Restricted shell execution with command whitelist and timeout
- **player** (`@coacker/player`) — Executes multi-step `Task`s within a single IDE conversation. Manages step sequencing, prompt context building, and result collection
- **brain** (`@coacker/brain`) — State machine orchestrators with optional Toolkit enrichment:
  - `AuditBrain` — 7-phase review pipeline: Intention → (Implement → Review → Attack → Issue) × N → Gap Analysis → Consolidation
  - `ValidateBrain` — 6-phase issue validation: Preflight → Checkout → Understand → Test Gen → Review → PR/Cleanup
- **cli** (`@coacker/cli`) — CLI entry point (`main.ts`) + E2E test suite

### Key Patterns

- **Role-based prompting**: Each pipeline phase uses a different system prompt (defined in `brain/*/prompts.ts`) to simulate separate agents within the same conversation
- **Conversation continuity**: All steps in a Task execute in the same IDE conversation to maintain context
- **Toolkit enrichment**: Brain optionally uses Toolkit (AST/MCP/Sandbox) to pre-compute context before building task prompts, injecting precise code snippets and references
- **State persistence**: Brain state saved to `output/state.json` and `output/intention.json` for crash recovery. TOCTOU handling tested in `audit/__tests__/`
- **Backend factory**: `createBackend(config)` in `backend/index.ts` creates the Backend instance; `createToolkit(config)` creates the optional Toolkit

## Configuration

Runtime config in `config.toml` (git-ignored). Template: `config.example.toml`.

Key sections: `[project]` (what to review), `[backend]` (IDE connection), `[brain]` (pipeline tuning), `[player]` (timeouts). Comments in the example file are in Chinese.

## Tech Stack

- TypeScript 5.7 (strict), ES2022 target, ESNext modules, bundler resolution
- pnpm workspaces
- Vitest for testing
- ESLint 10 (flat config in `eslint.config.mjs`) + Prettier
- Playwright for CDP browser automation
- `smol-toml` for config parsing
- `tsx` for running TypeScript directly

## Conventions

- Unused variables prefixed with `_` (ESLint configured to allow)
- `no-explicit-any` is warn, not error
- `no-console` is off (logger used throughout but console allowed)
- No compiled JS checked in — `.gitignore` excludes `packages/**/src/**/*.js` and related
- Output artifacts (`output/`, `docs/`, `external/`) are git-ignored
