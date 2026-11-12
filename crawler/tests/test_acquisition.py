import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock

import requests

from crawler.cgs_crawler.config import FetchPolicy
from crawler.cgs_crawler.fetch import Fetcher, PermanentFetchError, decode_html
from crawler.cgs_crawler.snapshots import SnapshotStore


class Response:
    headers = {"Content-Type": "text/html; charset=utf-8"}
    content = b"<html><body>ok</body></html>"
    apparent_encoding = "utf-8"
    encoding = "utf-8"
    text = "<html><body>ok</body></html>"

    @staticmethod
    def raise_for_status():
        return None


class RetryingSession:
    def __init__(self):
        self.calls = 0
        self.headers = {}

    def get(self, *args, **kwargs):
        self.calls += 1
        if self.calls == 1:
            raise requests.ConnectionError("temporary failure")
        return Response()


class AcquisitionTests(unittest.TestCase):
    def test_fetch_retries_and_records_a_replayable_snapshot(self):
        with tempfile.TemporaryDirectory() as temporary:
            store = SnapshotStore(Path(temporary))
            session = RetryingSession()
            policy = FetchPolicy(delay=0, jitter=0, backoff=0, attempts=2)
            fetcher = Fetcher(policy, store, session=session)
            url = "https://example.test/page"
            self.assertIn("<body>ok</body>", fetcher.fetch(url))
            self.assertEqual(session.calls, 2)
            self.assertEqual(store.count, 1)
            offline = Fetcher(policy, store, offline=True, session=RetryingSession())
            self.assertEqual(offline.fetch(url), Response.text)

    def test_content_addressing_deduplicates_identical_pages(self):
        with tempfile.TemporaryDirectory() as temporary:
            store = SnapshotStore(Path(temporary))
            for url in ("https://example.test/a", "https://example.test/b"):
                store.put(url, "<p>same</p>", content_type="text/html", encoding="utf-8", captured_at="2026-01-01T00:00:00Z")
            self.assertEqual(store.count, 2)
            self.assertEqual(len(list((Path(temporary) / "pages").glob("*.html"))), 1)
            manifest = json.loads((Path(temporary) / "manifest.json").read_text(encoding="utf-8"))
            self.assertEqual(manifest["pages"]["https://example.test/a"]["sha256"], manifest["pages"]["https://example.test/b"]["sha256"])

    def test_pages_decode_from_their_declared_charset(self):
        section = "Sec. 1-1 § — ½".encode("utf-8")
        self.assertEqual(decode_html(b'<meta charset="utf-8"/>' + section), ('<meta charset="utf-8"/>' + section.decode("utf-8"), "utf-8"))
        self.assertEqual(decode_html("§ 1-1".encode("cp1252"), "text/html; charset=windows-1252")[1], "cp1252")
        # Undeclared: UTF-8 when valid, otherwise Windows-1252 rather than a guess.
        self.assertEqual(decode_html(section)[1], "utf-8")
        self.assertEqual(decode_html("§ —".encode("cp1252")), ("§ —", "cp1252"))
        with self.assertRaisesRegex(ValueError, "does not decode"):
            decode_html(b'<meta charset="utf-8"/>\xa7')
        with self.assertRaisesRegex(ValueError, "replacement characters"):
            decode_html("�".encode("utf-8"))

    def test_permanent_http_errors_are_not_retried_and_retry_after_is_honoured(self):
        class StatusResponse(Response):
            def __init__(self, status, headers=None):
                self.status_code = status
                self.headers = {**Response.headers, **(headers or {})}

            def raise_for_status(self):
                if self.status_code >= 400:
                    raise requests.HTTPError(f"HTTP {self.status_code}")

        class Session:
            def __init__(self, responses):
                self.responses = list(responses)
                self.calls = 0
                self.headers = {}

            def get(self, *args, **kwargs):
                self.calls += 1
                return self.responses.pop(0)

        with tempfile.TemporaryDirectory() as temporary:
            store = SnapshotStore(Path(temporary))
            policy = FetchPolicy(delay=0, jitter=0, backoff=0, attempts=4)
            missing = Session([StatusResponse(404), StatusResponse(200)])
            with self.assertRaisesRegex(PermanentFetchError, "HTTP 404"):
                Fetcher(policy, store, session=missing).fetch("https://example.test/missing")
            self.assertEqual(missing.calls, 1)

            waits = []
            busy = Session([StatusResponse(503, {"Retry-After": "7"}), StatusResponse(200)])
            with mock.patch("crawler.cgs_crawler.fetch.time.sleep", waits.append):
                self.assertIn("ok", Fetcher(policy, store, session=busy).fetch("https://example.test/busy"))
            self.assertEqual((busy.calls, waits), (2, [7.0]))

            waits.clear()
            capped = Session([StatusResponse(429, {"Retry-After": "3600"}), StatusResponse(200)])
            with mock.patch("crawler.cgs_crawler.fetch.time.sleep", waits.append):
                Fetcher(policy, store, session=capped).fetch("https://example.test/capped")
            self.assertEqual(waits, [policy.max_backoff])

    def test_offline_mode_fails_closed_when_snapshot_is_absent(self):
        with tempfile.TemporaryDirectory() as temporary:
            fetcher = Fetcher(FetchPolicy(delay=0), SnapshotStore(Path(temporary)), offline=True)
            with self.assertRaisesRegex(RuntimeError, "missing URL"):
                fetcher.fetch("https://example.test/missing")


if __name__ == "__main__":
    unittest.main()
