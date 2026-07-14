from __future__ import annotations

import random
import time
from datetime import datetime, timezone
from typing import Optional

import requests

from .config import FetchPolicy
from .snapshots import SnapshotStore


class Fetcher:
    def __init__(
        self,
        policy: FetchPolicy,
        snapshots: SnapshotStore,
        *,
        offline: bool = False,
        session: Optional[requests.Session] = None,
    ):
        self.policy = policy
        self.snapshots = snapshots
        self.offline = offline
        self.session = session or requests.Session()
        self.session.headers.update({"User-Agent": policy.user_agent})

    def fetch(self, url: str) -> str:
        if self.offline:
            cached = self.snapshots.get(url)
            if cached is None:
                raise RuntimeError(f"Offline snapshot is missing URL: {url}")
            return cached

        attempts = max(1, self.policy.attempts)
        last_error: Optional[Exception] = None
        for attempt in range(1, attempts + 1):
            self._pause()
            try:
                response = self.session.get(
                    url,
                    timeout=self.policy.timeout,
                    verify=self.policy.verify_ssl,
                )
                response.raise_for_status()
                content_type = (response.headers.get("Content-Type") or "").lower()
                if content_type and "html" not in content_type:
                    raise ValueError(f"Expected HTML from {url}, received {content_type!r}")
                if not response.content:
                    raise ValueError(f"Empty response body from {url}")
                response.encoding = response.apparent_encoding or response.encoding or "utf-8"
                html = response.text
                self.snapshots.put(
                    url,
                    response.content,
                    content_type=content_type or "text/html",
                    encoding=response.encoding or "utf-8",
                    captured_at=datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
                )
                return html
            except (requests.RequestException, ValueError) as error:
                last_error = error
                if attempt == attempts:
                    break
                delay = max(0.0, self.policy.backoff) * (2 ** (attempt - 1))
                print(f"WARNING: fetch failed for {url} ({attempt}/{attempts}): {error}; retrying in {delay:.1f}s")
                if delay:
                    time.sleep(delay)
        raise RuntimeError(f"Failed to fetch {url} after {attempts} attempt(s): {last_error}") from last_error

    def _pause(self) -> None:
        if self.policy.delay <= 0:
            return
        jitter = random.random() * self.policy.jitter if self.policy.jitter > 0 else 0
        time.sleep(self.policy.delay + jitter)
