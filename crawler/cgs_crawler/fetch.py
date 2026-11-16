from __future__ import annotations

import codecs
import random
import re
import time
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from typing import Callable, Mapping, Optional, Tuple, TypeVar

import requests

from .config import FetchPolicy
from .snapshots import SnapshotStore

T = TypeVar("T")

# Statuses worth retrying. Anything else (404, 410, 403) is a permanent answer.
RETRYABLE_STATUSES = frozenset({408, 425, 429, 500, 502, 503, 504})
HEADER_CHARSET_RE = re.compile(r"charset\s*=\s*[\"']?([\w.:-]+)", re.IGNORECASE)
META_CHARSET_RE = re.compile(rb"<meta[^>]+charset\s*=\s*[\"']?([\w.:-]+)", re.IGNORECASE)


class PermanentFetchError(RuntimeError):
    """The server answered, and retrying will not change the answer."""


def _known_codec(name: Optional[str]) -> Optional[str]:
    if not name:
        return None
    try:
        return codecs.lookup(name).name
    except LookupError:
        return None


def decode_html(content: bytes, content_type: str = "") -> Tuple[str, str]:
    """Decode a page from its declared charset, never a statistical guess.

    The HTTP header wins, then a <meta> charset in the first 4 KB. An undeclared page must be
    valid UTF-8, or else is read as Windows-1252. A decoded page containing U+FFFD has lost
    characters such as section signs, so it is rejected.
    """
    header = HEADER_CHARSET_RE.search(content_type or "")
    meta = META_CHARSET_RE.search(content[:4096])
    declared = _known_codec(header.group(1) if header else None) or _known_codec(
        meta.group(1).decode("ascii", "ignore") if meta else None
    )
    candidates = [declared] if declared else ["utf-8", "cp1252"]
    for encoding in candidates:
        try:
            text = content.decode(encoding)
        except UnicodeDecodeError:
            continue
        if "�" in text:
            raise ValueError(f"page decoded as {encoding} contains replacement characters")
        return text, encoding
    raise ValueError(f"page does not decode as {' or '.join(candidates)}")


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

        def read(response):
            content_type = (response.headers.get("Content-Type") or "").lower()
            if content_type and "html" not in content_type:
                raise ValueError(f"Expected HTML from {url}, received {content_type!r}")
            if not response.content:
                raise ValueError(f"Empty response body from {url}")
            try:
                html, encoding = decode_html(response.content, response.headers.get("Content-Type") or "")
            except ValueError as error:
                raise PermanentFetchError(f"{url}: {error}") from error
            self.snapshots.put(
                url,
                response.content,
                content_type=content_type or "text/html",
                encoding=encoding,
                captured_at=datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            )
            return html

        return self._retrying("GET", url, read)

    def fetch_bytes(self, url: str, *, content_type: str) -> Tuple[bytes, Mapping[str, str]]:
        """Fetch a binary document such as a PDF. Binary bodies are not snapshotted."""
        if self.offline:
            raise RuntimeError(f"Offline mode cannot fetch {url}")

        def read(response):
            received = (response.headers.get("Content-Type") or "").lower()
            if received and content_type not in received:
                raise ValueError(f"Expected {content_type} from {url}, received {received!r}")
            if not response.content:
                raise ValueError(f"Empty response body from {url}")
            return response.content, response.headers

        return self._retrying("GET", url, read)

    def head(self, url: str) -> Mapping[str, str]:
        if self.offline:
            raise RuntimeError(f"Offline mode cannot fetch {url}")
        return self._retrying("HEAD", url, lambda response: response.headers)

    def _retrying(self, method: str, url: str, read: Callable[[requests.Response], T]) -> T:
        attempts = max(1, self.policy.attempts)
        last_error: Optional[Exception] = None
        for attempt in range(1, attempts + 1):
            self._pause()
            retry_after: Optional[float] = None
            try:
                send = self.session.head if method == "HEAD" else self.session.get
                response = send(url, timeout=self.policy.timeout, verify=self.policy.verify_ssl)
                status = getattr(response, "status_code", 200)
                if status >= 400:
                    if status not in RETRYABLE_STATUSES:
                        raise PermanentFetchError(f"Failed to fetch {url}: HTTP {status}")
                    retry_after = _retry_after(response)
                response.raise_for_status()
                return read(response)
            except PermanentFetchError:
                raise
            except (requests.RequestException, ValueError) as error:
                last_error = error
                if attempt == attempts:
                    break
                delay = min(self.policy.max_backoff, max(0.0, self.policy.backoff) * (2 ** (attempt - 1)))
                if retry_after is not None:
                    delay = min(self.policy.max_backoff, max(delay, retry_after))
                print(f"WARNING: fetch failed for {url} ({attempt}/{attempts}): {error}; retrying in {delay:.1f}s")
                if delay:
                    time.sleep(delay)
        raise RuntimeError(f"Failed to fetch {url} after {attempts} attempt(s): {last_error}") from last_error

    def _pause(self) -> None:
        if self.policy.delay <= 0:
            return
        jitter = random.random() * self.policy.jitter if self.policy.jitter > 0 else 0
        time.sleep(self.policy.delay + jitter)


def _retry_after(response: requests.Response) -> Optional[float]:
    value = (getattr(response, "headers", None) or {}).get("Retry-After")
    if not value:
        return None
    try:
        return max(0.0, float(value))
    except ValueError:
        pass
    try:
        return max(0.0, (parsedate_to_datetime(value) - datetime.now(timezone.utc)).total_seconds())
    except (TypeError, ValueError):
        return None
