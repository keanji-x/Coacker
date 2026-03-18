# Coacker — development commands
# Usage: just <recipe>

set shell := ["bash", "-c", "source $HOME/.nvm/nvm.sh && eval \"$@\"", "--"]

# Default: show available recipes
default:
    @just --list

# ─── Type Check ──────────────────────────────────

# Type check all packages
check:
    npx tsc --noEmit -p packages/shared/tsconfig.json
    npx tsc --noEmit -p packages/backend/tsconfig.json
    npx tsc --noEmit -p packages/player/tsconfig.json
    npx tsc --noEmit -p packages/brain/tsconfig.json
    npx tsc --noEmit -p packages/cli/tsconfig.json

# Type check a specific package
check-pkg pkg:
    npx tsc --noEmit -p packages/{{pkg}}/tsconfig.json

# ─── Lint ────────────────────────────────────────

# Lint all source files
lint:
    npx eslint 'packages/*/src/**/*.ts'

# Lint with auto-fix
lint-fix:
    npx eslint 'packages/*/src/**/*.ts' --fix

# ─── Format ──────────────────────────────────────

# Format all TypeScript files
fmt:
    npx prettier --write 'packages/*/src/**/*.ts'

# Check formatting without writing
fmt-check:
    npx prettier --check 'packages/*/src/**/*.ts'

# ─── Test ────────────────────────────────────────

# Run all tests
test:
    npx vitest run

# ─── Combined ───────────────────────────────────

# Run all checks (type + lint + format check)
ci: check lint fmt-check

# Run everything (type + lint + format + test)
all: check lint fmt-check test

# ─── Dev ─────────────────────────────────────────

# Run the audit CLI
run *args:
    npx tsx packages/cli/src/main.ts {{args}}

# Run E2E test (requires IDE connection)
e2e:
    npx tsx packages/cli/tests/e2e-ag.test.ts
