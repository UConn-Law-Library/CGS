import hashlib
import json
from pathlib import Path
import tempfile
import unittest

import requests

from secondary_sources.acquisition import PdfAcquirer, PdfSnapshotStore, discover_index_sources


class FakeResponse:
    def __init__(self, content=b"", text="", content_type="application/pdf"):
        self.content = content
        self.text = text
        self.headers = {"Content-Type": content_type}

    def raise_for_status(self):
        return None


class FakeSession:
    def __init__(self, responses):
        self.responses = iter(responses)
        self.headers = {}
        self.calls = []

    def get(self, url, timeout, verify):
        self.calls.append({"url": url, "timeout": timeout, "verify": verify})
        response = next(self.responses)
        if isinstance(response, Exception):
            raise response
        return response


class AcquisitionTests(unittest.TestCase):
    def test_discovers_all_year_scoped_index_pdfs_and_revision(self):
        html = """
        <p>THE INDEX, REVISION OF 1958, REVISED TO JANUARY 1, 2025.</p>
        <a href="index/2025/Index%20A-H.pdf">A-H</a>
        <a href="index/2025/Index%20I-S.pdf">I-S</a>
        <a href="index/2025/Index%20T-Z.pdf">T-Z</a>
        """
        urls, revision = discover_index_sources(html, "https://www.cga.ct.gov/lco/statutes-index.asp")
        self.assertEqual(len(urls), 3)
        self.assertEqual(urls["Index A-H.pdf"], "https://www.cga.ct.gov/lco/index/2025/Index%20A-H.pdf")
        self.assertEqual(revision, "Revision of 1958, revised to JANUARY 1, 2025")

    def test_pdf_snapshots_are_content_addressed_and_integrity_checked(self):
        with tempfile.TemporaryDirectory() as temporary:
            store = PdfSnapshotStore(Path(temporary))
            content = b"%PDF-1.7\nfixture"
            store.set_index_revision("Revision of 1958, revised to January 1, 2025")
            captured = store.capture("https://example.test/a.pdf", "a.pdf", content, "2026-01-01T00:00:00Z")
            self.assertEqual(captured.sha256, hashlib.sha256(content).hexdigest())
            self.assertEqual(store.resolve(captured.url).path, captured.path)
            manifest = json.loads((Path(temporary) / "manifest.json").read_text(encoding="utf-8"))
            self.assertEqual(manifest["sources"][captured.url]["bytes"], len(content))
            self.assertEqual(manifest["indexRevision"], "Revision of 1958, revised to January 1, 2025")

    def test_rejects_non_pdf_content(self):
        with tempfile.TemporaryDirectory() as temporary:
            with self.assertRaisesRegex(ValueError, "Expected PDF"):
                PdfSnapshotStore(Path(temporary)).capture(
                    "https://example.test/not.pdf", "not.pdf", b"<html>blocked</html>", "2026-01-01T00:00:00Z"
                )

    def test_cga_tls_exception_does_not_disable_judicial_tls(self):
        html = """
        <p>THE INDEX, REVISION OF 1958, REVISED TO JANUARY 1, 2025.</p>
        <a href="index/2025/Index%20A-H.pdf">A-H</a>
        <a href="index/2025/Index%20I-S.pdf">I-S</a>
        <a href="index/2025/Index%20T-Z.pdf">T-Z</a>
        """
        responses = [FakeResponse(text=html, content_type="text/html")]
        responses.extend(FakeResponse(content=f"%PDF-{index}".encode()) for index in range(4))
        session = FakeSession(responses)
        with tempfile.TemporaryDirectory() as temporary:
            PdfAcquirer(
                PdfSnapshotStore(Path(temporary)),
                session=session,
                verify_ssl=True,
                cga_verify_ssl=False,
                sleeper=lambda _: None,
            ).capture_all("2026-01-01T00:00:00Z")
        self.assertEqual([call["verify"] for call in session.calls], [False, False, False, False, True])

    def test_retries_transient_download_failures(self):
        session = FakeSession([
            requests.ConnectionError("first"),
            requests.ConnectionError("second"),
            FakeResponse(content=b"%PDF-recovered"),
        ])
        sleeps = []
        with tempfile.TemporaryDirectory() as temporary:
            content = PdfAcquirer(
                PdfSnapshotStore(Path(temporary)),
                session=session,
                max_attempts=3,
                sleeper=sleeps.append,
            ).get_bytes("https://example.test/retry.pdf")
        self.assertEqual(content, b"%PDF-recovered")
        self.assertEqual(sleeps, [1, 2])


if __name__ == "__main__":
    unittest.main()
