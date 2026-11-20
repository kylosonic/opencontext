"""Consistent HTTP failure classification for model providers."""

from __future__ import annotations

from datetime import UTC, datetime

import httpx

from oc_worker.errors import PermanentFailure, TransientFailure, check_abort


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
    check_abort()
    status = response.status_code
    if status < 400:
        return
    if status in (408, 409, 425, 429) or status >= 500:
        raise TransientFailure(
            f"{provider} provider returned {status}",
            retry_after_seconds=retry_after_seconds(response),
        )
    if status in (401, 403):
        raise PermanentFailure(f"{provider} provider rejected credentials ({status})")
    raise PermanentFailure(f"{provider} provider rejected the request ({status})")


def retry_after_seconds(response: httpx.Response) -> float | None:
    """Parse the standard Retry-After header without allowing an unbounded wait."""
    raw = response.headers.get("retry-after", "").strip()
    if not raw:
        return None
    try:
        seconds = float(raw)
    except ValueError:
        try:
            retry_at = datetime.fromisoformat(raw.replace("Z", "+00:00"))
            if retry_at.tzinfo is None:
                retry_at = retry_at.replace(tzinfo=UTC)
            seconds = (retry_at - datetime.now(UTC)).total_seconds()
        except (TypeError, ValueError):
            return None
    return min(120.0, max(0.0, seconds))
