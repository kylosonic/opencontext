# Add machine-readable output to `opencontext doctor`

## Problem

`opencontext doctor` prints a human-readable table. Setup scripts and CI
preflight checks need a stable structured result without parsing spaces or
terminal formatting.

## Scope

- Add `opencontext doctor --json`.
- Emit one JSON document containing an overall `ok` value and ordered checks.
- Preserve the existing text output when `--json` is omitted.
- Prove that credential values never appear in either output.

## Acceptance

- [x] `opencontext doctor --offline --json` emits valid JSON and exits 0 when
      required dependencies are present.
- [x] Missing required dependencies produce `ok: false` and exit 1.
- [x] JSON contains check names, statuses, and details but no secret values.
- [x] Existing text-mode tests continue to pass.

## Files

- `workers/processor/src/oc_worker/cli.py`
- `workers/processor/tests/test_cli.py`
- `workers/processor/README.md`

## Verify

```bash
cd workers/processor
.venv/Scripts/python -m pytest tests/test_cli.py -q
.venv/Scripts/python -m oc_worker.cli doctor --offline --json
```
