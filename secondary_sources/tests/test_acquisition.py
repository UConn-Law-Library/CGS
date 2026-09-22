import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from subprocess import CompletedProcess, TimeoutExpired

import requests

from secondary_sources.acquisition import (
    INFRACTIONS_FALLBACK_URLS,
    INFRACTIONS_URL,
    PdfAcquirer,
    PdfSnapshotStore,
    VerifiedCurlSession,
    discover_index_sources,
)


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
        self.assertEqual(session.calls[-1]["url"], INFRACTIONS_URL)

    def test_judicial_fallback_keeps_tls_verification_enabled(self):
        html = """
        <p>THE INDEX, REVISION OF 1958, REVISED TO JANUARY 1, 2025.</p>
        <a href="index/2025/Index%20A-H.pdf">A-H</a>
        <a href="index/2025/Index%20I-S.pdf">I-S</a>
        <a href="index/2025/Index%20T-Z.pdf">T-Z</a>
        """
        responses = [FakeResponse(text=html, content_type="text/html")]
        responses.extend(FakeResponse(content=f"%PDF-index-{index}".encode()) for index in range(3))
        responses.extend([
            requests.exceptions.SSLError("primary attempt one"),
            requests.exceptions.SSLError("primary attempt two"),
            FakeResponse(content=b"%PDF-official-fallback"),
        ])
        session = FakeSession(responses)
        sleeps = []
        with tempfile.TemporaryDirectory() as temporary:
            captures, _ = PdfAcquirer(
                PdfSnapshotStore(Path(temporary)),
                session=session,
                verify_ssl=True,
                cga_verify_ssl=False,
                max_attempts=2,
                sleeper=sleeps.append,
            ).capture_all("2026-01-01T00:00:00Z")
        judicial_calls = session.calls[-3:]
        self.assertEqual(
            [call["url"] for call in judicial_calls],
            [INFRACTIONS_URL, INFRACTIONS_URL, INFRACTIONS_FALLBACK_URLS[0]],
        )
        self.assertEqual([call["verify"] for call in judicial_calls], [True, True, True])
        self.assertEqual(captures[-1].url, INFRACTIONS_FALLBACK_URLS[0])
        self.assertEqual(sleeps, [1])

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

    def test_default_retry_budget_uses_four_exponential_backoffs(self):
        session = FakeSession([
            requests.ConnectionError("first"),
            requests.ConnectionError("second"),
            requests.ConnectionError("third"),
            requests.ConnectionError("fourth"),
            FakeResponse(content=b"%PDF-recovered"),
        ])
        sleeps = []
        with tempfile.TemporaryDirectory() as temporary:
            content = PdfAcquirer(
                PdfSnapshotStore(Path(temporary)),
                session=session,
                sleeper=sleeps.append,
            ).get_bytes("https://example.test/retry.pdf")
        self.assertEqual(content, b"%PDF-recovered")
        self.assertEqual(sleeps, [1, 2, 4, 8])

    def test_native_client_is_scoped_to_verified_judicial_downloads(self):
        general = FakeSession([FakeResponse(content=b"%PDF-index")])
        judicial = FakeSession([
            requests.exceptions.SSLError("primary TLS failure"),
            FakeResponse(content=b"%PDF-judicial"),
        ])
        with tempfile.TemporaryDirectory() as temporary:
            acquirer = PdfAcquirer(
                PdfSnapshotStore(Path(temporary)), session=general, judicial_session=judicial,
                cga_verify_ssl=False, max_attempts=1,
            )
            acquirer.capture_url("https://www.cga.ct.gov/index.pdf", "Index A-H.pdf", verify_ssl=False)
            capture = acquirer.capture_first_available(
                (INFRACTIONS_URL, *INFRACTIONS_FALLBACK_URLS), "infractions.pdf", verify_ssl=True,
            )
            self.assertEqual(capture.url, INFRACTIONS_FALLBACK_URLS[0])
        self.assertEqual([call["verify"] for call in general.calls], [False])
        self.assertEqual([call["verify"] for call in judicial.calls], [True, True])

    def test_native_curl_keeps_binary_pdf_and_rejects_insecure_requests(self):
        content = b"%PDF-1.7\n\xff\x00fixture"
        client = VerifiedCurlSession("native-curl")

        def run(command, **kwargs):
            self.assertEqual(command[:2], ["native-curl", "--disable"])
            self.assertIn("--fail", command)
            self.assertEqual(command[command.index("--proto") + 1], "=https")
            self.assertEqual(command[command.index("--proto-redir") + 1], "=https")
            self.assertNotIn("--insecure", command)
            self.assertNotIn("--ssl-no-revoke", command)
            Path(command[command.index("--output") + 1]).write_bytes(content)
            return CompletedProcess(command, 0, f"application/pdf\n{INFRACTIONS_URL}", "")

        with patch("secondary_sources.acquisition.subprocess.run", side_effect=run) as mocked:
            response = client.get(INFRACTIONS_URL, timeout=60, verify=True)
            self.assertEqual(response.content, content)
            self.assertEqual(response.headers["Content-Type"], "application/pdf")
            self.assertEqual(mocked.call_args.kwargs["timeout"], 70)
        with self.assertRaisesRegex(ValueError, "requires verified TLS"):
            client.get(INFRACTIONS_URL, timeout=60, verify=False)

    def test_native_curl_failures_are_retriable_and_fail_closed(self):
        client = VerifiedCurlSession("native-curl")
        failures = [
            CompletedProcess([], 35, "", "TLS handshake failure"),
            TimeoutExpired("native-curl", 70),
            FileNotFoundError("native client missing"),
        ]
        for failure in failures:
            with self.subTest(failure=failure):
                options = {"side_effect": failure} if isinstance(failure, Exception) else {"return_value": failure}
                with patch("secondary_sources.acquisition.subprocess.run", **options):
                    with tempfile.TemporaryDirectory() as temporary:
                        store = PdfSnapshotStore(Path(temporary))
                        acquirer = PdfAcquirer(store, judicial_session=client, max_attempts=1)
                        with self.assertRaisesRegex(RuntimeError, "verified official endpoints"):
                            acquirer.capture_first_available(
                                (INFRACTIONS_URL, *INFRACTIONS_FALLBACK_URLS), "infractions.pdf", verify_ssl=True,
                            )
                        self.assertFalse((Path(temporary) / "manifest.json").exists())

    def test_native_curl_html_response_cannot_be_captured_as_a_pdf(self):
        def run(command, **kwargs):
            Path(command[command.index("--output") + 1]).write_bytes(b"<html>Blocked</html>")
            return CompletedProcess(command, 0, f"text/html\n{INFRACTIONS_URL}", "")

        with patch("secondary_sources.acquisition.subprocess.run", side_effect=run):
            with tempfile.TemporaryDirectory() as temporary:
                acquirer = PdfAcquirer(
                    PdfSnapshotStore(Path(temporary)), judicial_session=VerifiedCurlSession("native-curl"),
                )
                with self.assertRaisesRegex(ValueError, "Expected PDF"):
                    acquirer.capture_url(INFRACTIONS_URL, "infractions.pdf", verify_ssl=True)


if __name__ == "__main__":
    unittest.main()
