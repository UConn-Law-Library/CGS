import json
from pathlib import Path
import tempfile
import unittest

from crawler.cgs_crawler.config import CrawlConfig, CURRENT_TITLES_URL, FetchPolicy
from crawler.cgs_crawler.pipeline import crawl


TITLE_URL = "https://www.cga.ct.gov/current/pub/title_01.htm"
CHAPTER_URL = "https://www.cga.ct.gov/current/pub/chap_001.htm"


class MappingFetcher:
    def __init__(self, pages):
        self.pages = pages

    def fetch(self, url):
        if url not in self.pages:
            raise RuntimeError(f"unexpected URL {url}")
        return self.pages[url]


def pages(chapter_html):
    return {
        CURRENT_TITLES_URL: '<a href="title_01.htm">Title 1</a><a href="title_01.htm">General Provisions</a>',
        TITLE_URL: '<a href="chap_001.htm">Chapter 1</a><a href="chap_001.htm">Construction</a>',
        CHAPTER_URL: chapter_html,
    }


class PipelineTests(unittest.TestCase):
    def test_pipeline_writes_valid_legacy_adapter_files_transactionally(self):
        chapter = (
            '<p><a href="chap_001.htm#sec_1-1">Sec. 1-1. Construction.</a></p>'
            '<p class="section"><a id="sec_1-1"></a>Sec. 1-1. Construction. Statutory text.</p>'
        )
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            config = CrawlConfig(
                output_dir=root / "legacy",
                snapshot_dir=root / "snapshots",
                only_titles=frozenset({"01"}),
                generated_at="2026-01-01T00:00:00Z",
                fetch=FetchPolicy(delay=0),
            )
            result = crawl(config, fetcher=MappingFetcher(pages(chapter)))
            self.assertEqual(result["counts"], {"titles": 1, "chapters": 1, "sections": 1})
            title = json.loads((root / "legacy" / "title_01.json").read_text(encoding="utf-8"))
            self.assertEqual(title["chapters"][0]["sections"][0]["content"]["text"], "Statutory text.")
            index = json.loads((root / "legacy" / "titles_index.json").read_text(encoding="utf-8"))
            self.assertEqual(index["source"]["generated_at_utc"], "2026-01-01T00:00:00Z")

    def test_failed_validation_preserves_previous_output(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            output = root / "legacy"
            output.mkdir()
            (output / "sentinel.txt").write_text("published", encoding="utf-8")
            config = CrawlConfig(
                output_dir=output,
                snapshot_dir=root / "snapshots",
                only_titles=frozenset({"01"}),
                fetch=FetchPolicy(delay=0),
            )
            with self.assertRaisesRegex(RuntimeError, "contains no sections"):
                crawl(config, fetcher=MappingFetcher(pages("<html><body>No provisions</body></html>")))
            self.assertEqual((output / "sentinel.txt").read_text(encoding="utf-8"), "published")
            self.assertFalse((output / "title_01.json").exists())

    def test_supplement_mode_uses_the_same_pipeline_and_builds_overlay(self):
        supplement_titles = "https://www.cga.ct.gov/2026/sup/titles.htm"
        supplement_title = "https://www.cga.ct.gov/2026/sup/title_01.htm"
        supplement_chapter = "https://www.cga.ct.gov/2026/sup/chap_001.htm"
        supplement_pages = {
            supplement_titles: '<a href="title_01.htm">Title 1</a><a href="title_01.htm">General Provisions</a>',
            supplement_title: '<a href="chap_001.htm">Chapter 1</a><a href="chap_001.htm">Construction</a>',
            supplement_chapter: (
                '<p><a href="chap_001.htm#sec_1-1">Sec. 1-1. Construction.</a></p>'
                '<p class="section"><a id="sec_1-1"></a>Sec. 1-1. Construction. Amended text.</p>'
            ),
        }
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            config = CrawlConfig(
                output_dir=root / "supplement",
                snapshot_dir=root / "snapshots",
                edition="supplement",
                supplement_year=2026,
                only_titles=frozenset({"01"}),
                generated_at="2026-01-01T00:00:00Z",
                fetch=FetchPolicy(delay=0),
            )
            result = crawl(config, fetcher=MappingFetcher(supplement_pages))
            self.assertEqual(result["counts"]["sections"], 1)
            overlay = json.loads((root / "supplement" / "supplement_map.json").read_text(encoding="utf-8"))
            self.assertEqual(overlay["sections"]["1-1"]["c"], "001")
            self.assertTrue((root / "supplement" / "supplement_index.json").is_file())
            self.assertTrue((root / "supplement" / "titles_index.json").is_file())


if __name__ == "__main__":
    unittest.main()
