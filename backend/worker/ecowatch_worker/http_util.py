"""HTTP helpers: host allowlisting, timeouts, and retry with backoff + jitter."""

from __future__ import annotations

import random
import time
from email.utils import parsedate_to_datetime
from typing import Any
from urllib.parse import urlparse

import httpx

RETRYABLE_STATUS = {429, 502, 503, 504}


class DisallowedHostError(ValueError):
    pass


def assert_allowed_url(url: str, allowed_hosts: tuple[str, ...]) -> None:
    """SSRF guard: only https URLs on explicitly allowlisted hosts may be fetched."""
    parsed = urlparse(url)
    if parsed.scheme != "https":
        raise DisallowedHostError(f"Only https URLs are allowed (got scheme {parsed.scheme!r})")
    host = (parsed.hostname or "").lower()
    if host not in allowed_hosts:
        raise DisallowedHostError(f"Host {host!r} is not allowlisted")


def _retry_after_seconds(response: httpx.Response) -> float | None:
    value = response.headers.get("Retry-After")
    if not value:
        return None
    try:
        return max(0.0, float(value))
    except ValueError:
        pass
    try:
        when = parsedate_to_datetime(value)
        return max(0.0, when.timestamp() - time.time())
    except (TypeError, ValueError):
        return None


def backoff_delay(attempt: int, base: float = 1.0, cap: float = 30.0) -> float:
    """Full-jitter exponential backoff."""
    return random.uniform(0, min(cap, base * (2**attempt)))


def request_json(
    client: httpx.Client,
    method: str,
    url: str,
    *,
    allowed_hosts: tuple[str, ...],
    json_body: Any = None,
    max_attempts: int = 4,
    max_retry_after: float = 60.0,
) -> Any:
    assert_allowed_url(url, allowed_hosts)
    last_error: Exception | None = None
    for attempt in range(max_attempts):
        try:
            response = client.request(method, url, json=json_body)
        except (httpx.TimeoutException, httpx.TransportError) as exc:
            last_error = exc
            time.sleep(backoff_delay(attempt))
            continue
        if response.status_code in RETRYABLE_STATUS and attempt < max_attempts - 1:
            wait = _retry_after_seconds(response)
            if wait is not None and wait > max_retry_after:
                response.raise_for_status()
            time.sleep(wait if wait is not None else backoff_delay(attempt))
            continue
        response.raise_for_status()
        return response.json()
    raise RuntimeError(f"Request to {urlparse(url).hostname} failed after {max_attempts} attempts") from last_error
