# Use one version source for the CLI

## Problem

`opencontext --version` and the `oc_worker` module both contain a hard-coded
`0.1.0` string. A release can update package metadata and leave either user-
facing value stale.

## Scope

- Read the displayed version from one package-level value.
- Add a CLI test that compares `--version` output with that value.
- Keep the release workflow's existing tag/package version check intact.

## Acceptance

- [x] `opencontext --version` prints `opencontext <package version>`.
- [x] No second literal version is added to the CLI parser.
- [x] A test fails if the printed and package-level versions drift.

## Files

- `workers/processor/src/oc_worker/__init__.py`
- `workers/processor/src/oc_worker/cli.py`
- `workers/processor/tests/test_cli.py`

## Verify

```bash
cd workers/processor
.venv/Scripts/python -m pytest tests/test_cli.py -q
.venv/Scripts/python -m oc_worker.cli --version
```
