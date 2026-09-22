import io
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from secondary_sources.cli import main


class AcquisitionCliTests(unittest.TestCase):
    def run_acquire(self, client, executable):
        with patch("sys.argv", ["secondary", "acquire", "--judicial-client", client]), \
                patch("secondary_sources.cli.shutil.which", return_value=executable), \
                patch("secondary_sources.cli.PdfSnapshotStore"), \
                patch("secondary_sources.cli.PdfAcquirer") as acquirer, \
                patch.dict("sys.modules", {"truststore": SimpleNamespace(inject_into_ssl=lambda: None)}), \
                patch("sys.stdout", new_callable=io.StringIO):
            acquirer.return_value.capture_all.return_value = ([], "fixture")
            main()
            return acquirer.call_args.kwargs

    def test_curl_selection_uses_path_lookup_and_keeps_judicial_tls_verified(self):
        arguments = self.run_acquire("curl", "/usr/bin/curl")
        self.assertEqual(arguments["judicial_session"].executable, "/usr/bin/curl")
        self.assertIs(arguments["verify_ssl"], True)
        self.assertIs(arguments["cga_verify_ssl"], True)

    def test_missing_curl_fails_without_silently_changing_client(self):
        with patch("sys.stderr", new_callable=io.StringIO) as error:
            with self.assertRaises(SystemExit) as stopped:
                self.run_acquire("curl", None)
        self.assertEqual(stopped.exception.code, 2)
        self.assertIn("requires curl in PATH", error.getvalue())

    def test_default_python_client_remains_available(self):
        arguments = self.run_acquire("requests", None)
        self.assertIsNone(arguments["judicial_session"])
        self.assertIs(arguments["verify_ssl"], True)


if __name__ == "__main__":
    unittest.main()
