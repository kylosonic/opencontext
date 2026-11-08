"""Consistent HTTP failure classification for model providers."""

from __future__ import annotations

import httpx

from oc_worker.errors import PermanentFailure, TransientFailure


def raise_for_provider_status(provider: str, response: httpx.Response) -> None:
    """Raise a retryable or permanent failure for an unsuccessful response."""
    status = response.status_code
    if status < 400:
        return
    if status in (408, 409, 425, 429) or status >= 500:
        raise TransientFailure(f"{provider} provider returned {status}")
    if status in (401, 403):
        raise PermanentFailure(f"{provider} provider rejected credentials ({status})")
    raise PermanentFailure(f"{provider} provider rejected the request ({status})")
