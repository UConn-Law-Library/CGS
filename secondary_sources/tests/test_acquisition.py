import hashlib
import json
from pathlib import Path
import tempfile
import unittest

from secondary_sources.acquisition import PdfSnapshotStore, discover_index_sources


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


if __name__ == "__main__":
    unittest.main()
