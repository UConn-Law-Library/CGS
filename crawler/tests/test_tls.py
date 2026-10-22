import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from crawler.cgs_crawler.tls import prepare_ca_bundle, tls_verification, INTERMEDIATE


class TlsTests(unittest.TestCase):
    def test_reviewed_bundle_and_explicit_path(self):
        with tempfile.TemporaryDirectory() as directory:
            bundle = prepare_ca_bundle(Path(directory) / "ca.pem")
            self.assertEqual(tls_verification(bundle), str(bundle))
            self.assertIn(INTERMEDIATE.read_bytes().strip(), bundle.read_bytes())

    def test_modified_certificate_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            certificate = Path(directory) / "changed.pem"
            certificate.write_text(INTERMEDIATE.read_text().replace("MIIE", "MIIF", 1))
            with self.assertRaises(ValueError):
                prepare_ca_bundle(Path(directory) / "ca.pem", certificate)

    def test_production_cannot_disable_authentication(self):
        with patch.dict(os.environ, {"GITHUB_ACTIONS": "true"}):
            with self.assertRaisesRegex(ValueError, "cannot be disabled"):
                tls_verification(insecure=True)

    def test_missing_bundle_fails_closed(self):
        with self.assertRaises(FileNotFoundError):
            tls_verification(Path("missing-cgs-ca-bundle.pem"))
