# Replay captured video context in CI

## Problem

Media analysis requires FFmpeg and provider credentials, but a repository may
need to reuse an already captured workflow on every CI build. A context
artifact must remain self-consistent and reproducible after analysis ends.

## Scope

- Validate evidence IDs, source references, timestamps, timeline bounds, and
  transcript bounds.
- Regenerate the deterministic implementation brief without source media or
  provider calls.
- Emit a machine-readable report with canonical context and brief hashes.
- Run a published 70-record context through the check on every CI build.

## Acceptance

- [x] Valid captured context produces a brief without network or FFmpeg.
- [x] Dangling sources, mismatched text, duplicate IDs, and invalid time bounds
  fail with actionable paths and codes.
- [x] A machine-readable replay report records counts and SHA-256 digests.
- [x] CI replays the published OpenCode Go measured context.

## Files

- `workers/processor/src/oc_worker/replay.py`
- `workers/processor/tests/test_replay.py`
- `.github/workflows/ci.yml`
- `docs/agent-integration.md`
