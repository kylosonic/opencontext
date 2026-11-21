"""Error types shared across the worker.

`PermanentFailure` never retries (jobs.md B6); `TransientFailure` is
retried automatically with backoff and stays invisible to the user
unless the attempts are exhausted (jobs.md B7). `StageFailure` carries
the failure kind so a caller can map a stage error onto the API fail
payload `{stage, error, failureKind, retryable}`.
"""

from __future__ import annotations

import threading
import time


class PermanentFailure(Exception):
    """A failure that must never be retried."""


class ProcessingCancelled(PermanentFailure):
    """The job exceeded its processing deadline."""


class TransientFailure(Exception):
    """A failure worth a bounded number of automatic retries."""

    def __init__(
        self,
        message: str = "",
        *,
        retry_after_seconds: float | None = None,
    ) -> None:
        super().__init__(message)
        self.retry_after_seconds = retry_after_seconds


_abort_local = threading.local()


class JobAbort:
    """Cooperative abort signal for provider work and aggregate stages."""

    def __init__(self, reason: str = "Processing exceeded the worker job time limit") -> None:
        self._event = threading.Event()
        self.reason = reason
        self._deadline = 0.0

    def abort(self) -> None:
        self._event.set()

    def set_deadline(self, seconds: float) -> None:
        self._deadline = seconds

    def check_deadline(self) -> None:
        if self._deadline > 0 and time.monotonic() >= self._deadline:
            self.abort()

    @property
    def aborted(self) -> bool:
        return self._event.is_set()

    def check(self) -> None:
        self.check_deadline()
        if self.aborted:
            raise ProcessingCancelled(self.reason)

    def sleep(self, seconds: float) -> None:
        """Sleep interruptibly and raise promptly when the deadline expires."""
        self.check()
        if seconds <= 0:
            return
        self._event.wait(seconds)
        self.check()


def bind_abort(signal: JobAbort | None) -> JobAbort | None:
    """Bind the active abort to the current worker thread."""
    previous = getattr(_abort_local, "signal", None)
    _abort_local.signal = signal
    return previous


def current_abort() -> JobAbort | None:
    return getattr(_abort_local, "signal", None)


def check_abort() -> None:
    signal = current_abort()
    if signal is not None:
        signal.check()


class ProviderConfigurationError(ValueError):
    """Invalid provider settings that need operator action."""


class StageFailure(Exception):
    """A stage-level failure carrying the failure kind."""

    def __init__(self, message: str, failure_kind: str) -> None:
        super().__init__(message)
        self.failure_kind = failure_kind
