import json
from pathlib import Path
import tempfile
import unittest

import requests

from crawler.cgs_crawler.config import FetchPolicy
from crawler.cgs_crawler.fetch import Fetcher
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

    def test_offline_mode_fails_closed_when_snapshot_is_absent(self):
        with tempfile.TemporaryDirectory() as temporary:
            fetcher = Fetcher(FetchPolicy(delay=0), SnapshotStore(Path(temporary)), offline=True)
            with self.assertRaisesRegex(RuntimeError, "missing URL"):
                fetcher.fetch("https://example.test/missing")


if __name__ == "__main__":
    unittest.main()
