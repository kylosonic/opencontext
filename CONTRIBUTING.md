# Contributing to OpenContext

Thank you for your interest in contributing. OpenContext is an MVP in active
development; contributions are welcome.

## Prerequisites

- Node.js 20 or later (24 recommended)
- npm 10 or later
- Python 3.13 or later

## Getting started

1. Fork and clone the repository.
2. `npm install` at the repository root to install all workspace dependencies.
3. Worker setup:

   ```bash
   cd workers/processor
   python -m venv .venv
   .venv/Scripts/python -m pip install -e ".[dev]"   # Windows
   # macOS/Linux: source .venv/bin/python -m pip install -e ".[dev]"
   ```

## Before submitting

Run all checks and make sure they pass:

```bash
npm run lint
npm run typecheck
npm test
npm run build

# worker
cd workers/processor
.venv/Scripts/python -m ruff check src tests
.venv/Scripts/python -m pytest
```

## Pull requests

- One focused change per PR.
- Use [Conventional Commits](https://www.conventionalcommits.org/) for commit
  messages.
- Add or update tests for changed behavior.
- CI must be green before review.

## Reporting issues

Open a GitHub issue and include: steps to reproduce, expected vs. actual
behavior, and environment details (OS, Node/Python versions).

## Repository layout

| Path | Purpose |
| --- | --- |
| `apps/web` | Next.js web application |
| `packages/schemas` | Shared Zod schemas and pipeline constants |
| `packages/config` | Environment access helpers |
| `workers/processor` | Python media processing worker |

## Governance

This repository is operated by a contract-driven engineering swarm; see
[AGENTS.md](./AGENTS.md) for the agent workflow and commit policy.
