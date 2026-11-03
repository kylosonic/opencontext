"""Error types shared across the worker.

`PermanentFailure` never retries (jobs.md B6); `TransientFailure` is
retried automatically with backoff and stays invisible to the user
unless the attempts are exhausted (jobs.md B7). `StageFailure` carries
the failure kind so a caller can map a stage error onto the API fail
payload `{stage, error, failureKind, retryable}`.
"""

from __future__ import annotations


class PermanentFailure(Exception):
    """A failure that must never be retried."""


class TransientFailure(Exception):
    """A failure worth a bounded number of automatic retries."""


class StageFailure(Exception):
    """A stage-level failure carrying the failure kind."""

    def __init__(self, message: str, failure_kind: str) -> None:
        super().__init__(message)
        self.failure_kind = failure_kind
