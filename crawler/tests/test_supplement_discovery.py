import json
from pathlib import Path
import tempfile
import unittest

import requests

from crawler.cgs_crawler.config import FetchPolicy
from crawler.cgs_crawler.fetch import Fetcher
from crawler.cgs_crawler.snapshots import SnapshotStore
from crawler.cgs_crawler.supplement_discovery import (
    NetworkError,
    SourcePageError,
    discover,
    expected_supplement_year,
    main,
    verify_supplement_page,
)

FIXTURES = Path(__file__).parent / "fixtures"
# Captured from CGA on 2026-11-16: the 2026 Supplement's titles page (trimmed after the heading)
# and the IIS 404 page CGA returns for https://www.cga.ct.gov/2028/sup/titles.htm.
PUBLISHED_PAGE = (FIXTURES / "supplement_2026_titles.html").read_text(encoding="utf-8-sig")
NOT_FOUND_PAGE = (FIXTURES / "supplement_not_published_404.html").read_text(encoding="utf-8")


class Response:
    def __init__(self, status, body, content_type="text/html; charset=utf-8"):
        self.status_code = status
        self.content = body.encode("utf-8")
        self.text = body
        self.headers = {"Content-Type": content_type}
        self.encoding = "utf-8"
        self.apparent_encoding = "utf-8"

    def raise_for_status(self):
        if self.status_code >= 400:
            raise requests.HTTPError(f"HTTP {self.status_code}")


class Session:
    def __init__(self, *answers):
        self.answers = list(answers)
        self.headers = {}
        self.calls = 0

    def get(self, *args, **kwargs):
        self.calls += 1
        answer = self.answers.pop(0) if len(self.answers) > 1 else self.answers[0]
        if isinstance(answer, Exception):
            raise answer
        return answer


def data_dir(root: Path, revision_year: int, supplements=()) -> Path:
    data = root / "data"
    data.mkdir()
    (data / "catalog.json").write_text(json.dumps({"source": {"revisionYear": revision_year}}), encoding="utf-8")
    for year in supplements:
        (data / "supplements" / str(year)).mkdir(parents=True)
        (data / "supplements" / str(year) / "manifest.json").write_text("{}", encoding="utf-8")
    return data


class DiscoveryTests(unittest.TestCase):
    def fetcher(self, root: Path, session: Session) -> Fetcher:
        return Fetcher(FetchPolicy(delay=0, jitter=0, backoff=0, attempts=3), SnapshotStore(root / "snapshots"), session=session)

    def test_expected_year_follows_the_active_revision(self):
        self.assertEqual(expected_supplement_year({"source": {"revisionYear": 2027}}), 2028)
        with self.assertRaisesRegex(ValueError, "odd-numbered"):
            expected_supplement_year({"source": {"revisionYear": 2026}})

    def test_a_404_means_not_yet_published(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            session = Session(Response(404, NOT_FOUND_PAGE))
            result = discover(data_dir(root, 2027), self.fetcher(root, session).fetch)
            self.assertEqual(result, {"status": "not-published", "year": 2028, "url": "https://www.cga.ct.gov/2028/sup/titles.htm", "detail": "HTTP 404"})
            self.assertEqual(session.calls, 1)

    def test_a_verified_page_is_available(self):
        # The published 2026 Supplement exercises the same check the 2028 one will get.
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            result = discover(data_dir(root, 2025), self.fetcher(root, Session(Response(200, PUBLISHED_PAGE))).fetch)
            self.assertEqual(result["status"], "available")
            self.assertEqual(result["heading"], "Revised to January 1, 2026")

    def test_an_already_published_supplement_needs_no_work(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            session = Session(Response(200, PUBLISHED_PAGE))
            result = discover(data_dir(root, 2025, supplements=[2026]), self.fetcher(root, session).fetch)
            self.assertEqual(result["status"], "already-published")
            self.assertEqual(session.calls, 0)

    def test_a_network_failure_is_not_reported_as_unpublished(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            data = data_dir(root, 2027)
            for answer in (requests.ConnectionError("reset"), Response(503, "busy"), requests.exceptions.SSLError("certificate verify failed")):
                session = Session(answer)
                with self.assertRaises(NetworkError):
                    discover(data, self.fetcher(root, session).fetch)
                self.assertEqual(session.calls, 3, "a network failure is retried before it is reported")

    def test_a_page_that_is_not_the_expected_edition_is_invalid(self):
        self.assertEqual(verify_supplement_page(PUBLISHED_PAGE, 2026), [])
        problems = verify_supplement_page(PUBLISHED_PAGE, 2028)
        self.assertTrue(any("2028 Supplement" in problem for problem in problems))
        self.assertTrue(any("revised to January 1, 2026, not 2028" in problem for problem in problems))
        unsigned = PUBLISHED_PAGE.replace("Legislative Commissioners", "Someone")
        self.assertIn("the page does not name the Legislative Commissioners' Office as its publisher", verify_supplement_page(unsigned, 2026))
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            # A redirect to a placeholder, a forbidden page, or the wrong edition all fail.
            for answer in (Response(200, "<html><title>Page moved</title><body>Moved</body></html>"), Response(403, "Forbidden"), Response(200, PUBLISHED_PAGE)):
                data = root / f"case-{id(answer)}"
                data.mkdir()
                with self.assertRaises(SourcePageError):
                    discover(data_dir(data, 2027), self.fetcher(data, Session(answer)).fetch)

    def test_the_command_reports_outcomes_and_exit_codes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            data = data_dir(root, 2025)
            output = root / "github-output"
            report = root / "report.json"
            page = root / "titles.htm"
            page.write_text(PUBLISHED_PAGE, encoding="utf-8")
            self.assertEqual(main(["--data", str(data), "--html", str(page), "--github-output", str(output), "--report", str(report)]), 0)
            self.assertEqual(output.read_text(encoding="utf-8"), "status=available\nyear=2026\nurl=https://www.cga.ct.gov/2026/sup/titles.htm\n")
            self.assertEqual(json.loads(report.read_text(encoding="utf-8"))["status"], "available")
            self.assertEqual(main(["--data", str(data), "--year", "2028", "--html", str(page)]), 2)


if __name__ == "__main__":
    unittest.main()
