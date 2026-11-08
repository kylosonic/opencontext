"""Consistent HTTP failure classification for model providers."""

from __future__ import annotations

import httpx

from oc_worker.errors import PermanentFailure, TransientFailure


def openai_compatible_headers(
    api_key: str,
    base_url: str,
    session_id: str | None = None,
) -> dict[str, str]:
    headers = {"Authorization": f"Bearer {api_key}"}
    if "opencode.ai" in base_url:
        headers["x-opencode-session"] = session_id or "opencontext-local"
        headers["User-Agent"] = "opencontext-video"
    return headers


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
