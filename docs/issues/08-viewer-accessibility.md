# Improve results-viewer keyboard accessibility

## Problem

Evidence markers and timeline ranges are clickable, but keyboard users need a
clear focus model and predictable seeking behavior.

## Scope

- Review tab order, focus visibility, labels, and ARIA state.
- Add keyboard tests for evidence and timeline navigation.
- Ensure video controls remain usable when playback is unavailable.
- Avoid changing visual behavior beyond focus and semantics.

## Acceptance

- [ ] Every interactive result control is reachable by keyboard.
- [ ] Focus is visible and does not jump unexpectedly.
- [ ] Screen-reader labels identify evidence ID, timestamp, and review status.
- [ ] Existing result-viewer tests remain green.

## Files

- `apps/web/src/components/results/`
- `apps/web/src/components/__tests__/` (new if needed)

## Verify

```bash
cd apps/web
npx vitest run
```
