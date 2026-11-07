# Add CLI batch analysis

## Problem

`opencontext analyze` accepts one file. Users with several recordings need to
invoke it repeatedly and manage output names themselves.

## Scope

- Accept multiple files or a directory.
- Add `--output-dir` with collision-safe names.
- Emit a concise JSON summary unless `--quiet`.
- Preserve non-zero exit behavior on failures.

## Acceptance

- [ ] Two fixture inputs produce separate Markdown and JSON outputs.
- [ ] One invalid input does not erase successful outputs.
- [ ] Exit code reports partial failure.
- [ ] CLI help and README show the command.

## Files

- `workers/processor/src/oc_worker/cli.py`
- `workers/processor/tests/test_cli.py`
- `workers/processor/README.md`

## Verify

```bash
cd workers/processor
.venv/Scripts/python -m pytest tests/test_cli.py -q
```
