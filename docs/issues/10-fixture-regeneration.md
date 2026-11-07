# Add a checked example-output regeneration test

## Problem

The README example output can drift from the actual fixture pipeline.

## Scope

- Reuse the generated fixture video.
- Run the offline CLI.
- Compare generated Markdown/JSON structure with checked examples, excluding
  timestamps.
- Add a command to update examples intentionally.

## Acceptance

- [ ] CI fails when example structure drifts.
- [ ] Updating examples is one documented command.
- [ ] No large binary is committed.
- [ ] Fixture output remains explicitly labeled as fixture output.

## Files

- `scripts/generate-fixture.mjs`
- `workers/processor/tests/test_cli.py`
- `docs/examples/`
- `README.md`

## Verify

```bash
npm run fixture
opencontext analyze .artifacts/opencontext-fixture.mp4 --offline \
  --out context.md --json context.json
```
