import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock

from crawler.cgs_crawler import act_text
from crawler.cgs_crawler.act_text import (
    EXTRACTOR_VERSION,
    ExtractionError,
    Line,
    PdfCache,
    acquire_texts,
    borderless_table,
    extract_act,
    runs_text,
    effective_index,
    search_index,
    text_bytes,
    text_document,
    tokens,
)

FIXTURES = Path(__file__).parent / "fixtures"
PDF = (FIXTURES / "act_pa_26_83.pdf").read_bytes()
URL = "https://www.cga.ct.gov/2026/act/pa/pdf/2026PA-00083-R00SB-00349-PA.pdf"
ACT = {
    "id": "pa-2026-regular-83", "type": "public", "number": 83, "citation": "P.A. 26-83",
    "title": "AN ACT CONCERNING MODIFICATIONS TO THE FIREFIGHTERS CANCER RELIEF FUND.",
    "bill": "SB 349", "billUrl": "https://www.cga.ct.gov/bill", "url": URL,
}
HEADERS = {"Content-Length": str(len(PDF)), "Last-Modified": "Tue, 02 Jun 2026 15:00:00 GMT", "Content-Type": "application/pdf"}


def char(text, x0, top, *, inserted=False, size=12.0):
    width = 0 if text == " " else 6
    return {"text": text, "x0": x0, "x1": x0 + width, "top": top, "bottom": top + size, "size": size, "inserted": inserted}


def word_chars(text, x0, top):
    return [char(value, x0 + index * 6, top) for index, value in enumerate(text)]


class ExtractActTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.document = extract_act(PDF, citation="Public Act No. 26-83")

    def test_reads_the_front_matter_and_governors_action(self):
        self.assertEqual(self.document["front"], {
            "bill": "Senate Bill No. 349",
            "act": "Public Act No. 26-83",
            "title": "AN ACT CONCERNING MODIFICATIONS TO THE FIREFIGHTERS CANCER RELIEF FUND.",
        })
        self.assertEqual(self.document["approved"], "Approved June 2, 2026")
        self.assertEqual(self.document["pages"], 2)
        self.assertEqual([runs_text(block["runs"]) for block in self.document["blocks"] if block["type"] == "action"], ["Governor's Action:", "Approved June 2, 2026"])

    def test_numbers_sections_with_effective_dates(self):
        self.assertEqual(self.document["sections"], [
            {"number": str(number), "anchor": f"sec-{number}", "effective": "Effective October 1, 2026"} for number in (1, 2, 3)
        ])
        anchored = [block for block in self.document["blocks"] if block.get("anchor")]
        self.assertEqual([runs_text(block["runs"])[:7] for block in anchored], ["Section", "Sec. 2.", "Sec. 3."])

    def test_marks_underlined_language_as_inserted_and_keeps_brackets(self):
        subsection = next(block for block in self.document["blocks"] if runs_text(block["runs"]).startswith("(a) Not later than"))
        self.assertEqual(subsection["runs"][:3], ["(a) Not later than [July 1, 2023] ", {"ins": "October 1, 2026"}, ", and annually thereafter, the State Treasurer, in consultation with the Connecticut State Firefighters Association, shall submit a report to "])
        inserted = " ".join(run["ins"] for run in subsection["runs"] if isinstance(run, dict))
        # An underline continuing across a line break stays one insertion.
        self.assertIn("the joint standing committee of the General Assembly having cognizance of matters relating to labor and public employees", inserted)

    def test_strips_running_headers_and_footers_and_joins_paragraphs_across_pages(self):
        text = "\n".join(runs_text(block["runs"]) for block in self.document["blocks"])
        self.assertNotIn("Senate Bill No. 349", text)
        self.assertNotIn("Public Act No. 26-83", text)
        self.assertEqual([block["page"] for block in self.document["blocks"]], [1, 1, 1, 2, 2, 2, 2, 2, 2])

    def test_refuses_a_pdf_for_another_act(self):
        with self.assertRaisesRegex(ExtractionError, "not Public Act No. 26-84"):
            extract_act(PDF, citation="Public Act No. 26-84")

    def test_refuses_a_text_that_loses_characters(self):
        original = act_text.assemble

        def dropping(items, **kwargs):
            result = original(items, **kwargs)
            result["blocks"].pop(1)
            return result

        with mock.patch.object(act_text, "assemble", dropping):
            with self.assertRaisesRegex(ExtractionError, "but the PDF has"):
                extract_act(PDF, citation="Public Act No. 26-83")

    def test_refuses_files_that_are_not_pdfs(self):
        with self.assertRaises(ExtractionError):
            extract_act(b"<html>not a pdf</html>")


class LayoutTests(unittest.TestCase):
    def test_justified_lines_are_not_split_into_columns(self):
        chars = word_chars("one", 117, 100) + word_chars("two", 160, 100) + word_chars("three", 205, 100)
        self.assertEqual(len(Line(chars).segments()), 1)

    def test_a_wide_gap_among_narrow_ones_separates_columns(self):
        chars = word_chars("Year", 140, 100) + [char(" ", 164, 100)] + word_chars("two", 167, 100) + word_chars("Eighty", 305, 100)
        segments = Line(chars).segments()
        self.assertEqual(["".join(value["text"] for value in segment).strip() for segment in segments], ["Year two", "Eighty"])

    def test_borderless_rows_align_to_columns_and_wrapped_cells_join(self):
        # Headings are centered over their columns, so the extents overlap.
        rows = [
            ([word_chars("Age", 173, 100), word_chars("Price", 345, 100)], "row"),
            ([word_chars("Year twelve", 144, 130), word_chars("Ten per cent", 305, 130)], "row"),
            ([word_chars("or more", 305, 148)], "wrapped"),
        ]
        table = borderless_table(rows)
        self.assertEqual([[runs_text(cell) for cell in row] for row in table], [["Age", "Price"], ["Year twelve", "Ten per cent or more"]])

    def test_inserted_runs_merge_and_spaces_between_them_stay_inserted(self):
        chars = [char("a", 100, 100), char(" ", 106, 100), char("b", 110, 100, inserted=True), char(" ", 116, 100, inserted=True), char("c", 120, 100, inserted=True)]
        paragraph = act_text.Paragraph(0)
        paragraph.add_line(Line(chars))
        self.assertEqual(paragraph.runs(), ["a ", {"ins": "b c"}])


class SearchAndSerializationTests(unittest.TestCase):
    def test_tokens_keep_citations_whole(self):
        self.assertEqual(tokens("Section 22a-245 of P.A. 26-2, the Commissioner’s"), ["section", "22a-245", "of", "p", "a", "26-2", "the", "commissioner"])

    def test_search_index_maps_terms_to_act_positions(self):
        first = {"front": {"title": "AN ACT"}, "blocks": [{"type": "p", "runs": ["Redemption centers"]}]}
        second = {"front": {"title": "AN ACT"}, "blocks": [{"type": "table", "rows": [[["Section 22a-245"]]]}]}
        index = search_index("2026-regular", [({"id": "a"}, first), ({"id": "b"}, second)])
        self.assertEqual(index["acts"], ["a", "b"])
        self.assertEqual(index["terms"]["act"], [0, 1])
        self.assertEqual(index["terms"]["redemption"], [0])
        self.assertEqual(index["terms"]["22a-245"], [1])

    def test_effective_index_groups_sections_by_effective_date(self):
        document = {
            "approved": "Approved June 4, 2026",
            "sections": [
                {"number": "1", "anchor": "sec-1", "effective": "Effective July 1, 2026"},
                {"number": "2", "anchor": "sec-2", "effective": "Effective from passage"},
                {"number": "3", "anchor": "sec-3", "effective": "Effective July 1, 2026"},
            ],
        }
        index = effective_index("2026-regular", [({"id": "a"}, document), ({"id": "b"}, {"sections": []})])
        self.assertEqual(index["session"], "2026-regular")
        self.assertEqual(index["acts"], [
            {"id": "a", "approved": "Approved June 4, 2026", "dates": [
                {"effective": "Effective July 1, 2026", "sections": ["1", "3"]},
                {"effective": "Effective from passage", "sections": ["2"]},
            ]},
            {"id": "b", "dates": []},
        ])

    def test_text_files_hold_one_block_per_line(self):
        document = text_document(ACT, PDF, HEADERS, extract_act(PDF, citation="Public Act No. 26-83"))
        content = text_bytes(document)
        self.assertEqual(json.loads(content), document)
        lines = content.decode("utf-8").splitlines()
        self.assertEqual(len(lines), len(document["blocks"]) + 2)
        self.assertEqual(json.loads(lines[1].rstrip(",")), document["blocks"][0])
        self.assertEqual(document["source"]["lastModified"], HEADERS["Last-Modified"])
        self.assertEqual(document["extractorVersion"], EXTRACTOR_VERSION)


class FakeFetcher:
    def __init__(self, headers=HEADERS, content=PDF, fail=False):
        self.headers = headers
        self.content = content
        self.fail = fail
        self.downloads = 0

    def head(self, url):
        if self.fail:
            raise RuntimeError("offline")
        return self.headers

    def fetch_bytes(self, url, *, content_type):
        self.downloads += 1
        return self.content, self.headers


class AcquireTextsTests(unittest.TestCase):
    def acquire(self, fetcher, previous=None, **kwargs):
        return acquire_texts([ACT], previous or {}, fetcher, log=lambda message: None, **kwargs)

    def test_extracts_new_acts_and_reuses_unchanged_ones(self):
        fetcher = FakeFetcher()
        texts, failures = self.acquire(fetcher)
        self.assertEqual(failures, [])
        self.assertEqual(fetcher.downloads, 1)
        again, _ = self.acquire(fetcher, texts)
        self.assertIs(again[ACT["id"]], texts[ACT["id"]])
        self.assertEqual(fetcher.downloads, 1)

    def test_extracts_again_when_the_pdf_or_extractor_changes(self):
        fetcher = FakeFetcher()
        texts, _ = self.acquire(fetcher)
        changed = FakeFetcher(headers={**HEADERS, "Last-Modified": "Wed, 03 Jun 2026 15:00:00 GMT"})
        self.acquire(changed, texts)
        self.assertEqual(changed.downloads, 1)
        stale = {ACT["id"]: {**texts[ACT["id"]], "extractorVersion": EXTRACTOR_VERSION - 1}}
        self.acquire(fetcher, stale)
        self.assertEqual(fetcher.downloads, 2)

    def test_keeps_the_published_text_when_cga_is_unreachable(self):
        texts, _ = self.acquire(FakeFetcher())
        kept, failures = self.acquire(FakeFetcher(fail=True), texts)
        self.assertIs(kept[ACT["id"]], texts[ACT["id"]])
        self.assertEqual(failures, [])
        missing, failures = self.acquire(FakeFetcher(fail=True))
        self.assertEqual(missing, {})
        self.assertEqual(failures[0]["citation"], "P.A. 26-83")

    def test_publishes_without_text_when_extraction_fails(self):
        texts, failures = self.acquire(FakeFetcher(content=b"%PDF-1.7 broken"))
        self.assertEqual(texts, {})
        self.assertEqual(failures[0]["id"], ACT["id"])

    def test_the_cache_serves_an_unchanged_pdf(self):
        with tempfile.TemporaryDirectory() as temporary:
            cache = PdfCache(Path(temporary))
            self.acquire(FakeFetcher(), cache=cache)
            fetcher = FakeFetcher()
            self.acquire(fetcher, cache=PdfCache(Path(temporary)), refresh=True)
            self.assertEqual(fetcher.downloads, 0)


if __name__ == "__main__":
    unittest.main()
