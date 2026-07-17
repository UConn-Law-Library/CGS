from pathlib import Path
import unittest

from crawler.cgs_crawler.parsing import (
    detect_section_status,
    expand_grouped_section_keys,
    extract_chapter_links,
    extract_grouped_section_content,
    extract_inline_title_chapter,
    extract_section_links,
    extract_section_text_map,
)

FIXTURES = Path(__file__).parent / "fixtures"


def fixture(name: str) -> str:
    return (FIXTURES / name).read_text(encoding="utf-8")


class ParsingTests(unittest.TestCase):
    def test_multi_letter_chapter_suffixes_sort_in_cga_order(self):
        chapters = extract_chapter_links(
            fixture("title_multi_letter_chapters.html"),
            "https://www.cga.ct.gov/current/pub/title_17b.htm",
        )
        self.assertEqual([chapter[0] for chapter in chapters], ["319y", "319aa", "368ll", "588hh"])

    def test_title_level_provisions_use_the_official_former_chapter_note(self):
        chapter = extract_inline_title_chapter(
            fixture("title_inline_former_chapter.html"),
            "https://www.cga.ct.gov/current/pub/title_04c.htm",
            "04c",
        )
        self.assertEqual(
            chapter,
            (
                "former-58",
                "Former Chapter 58",
                "Repealed and obsolete provisions",
                "https://www.cga.ct.gov/current/pub/title_04c.htm",
            ),
        )
        self.assertIsNone(
            extract_inline_title_chapter(
                '<a href="#sec_4c-3">Sec. 4c-3. Obsolete.</a>',
                "https://www.cga.ct.gov/current/pub/title_04c.htm",
                "04c",
            )
        )

    def test_visible_heading_wins_over_fragment_and_content_uses_source_anchor(self):
        html = fixture("chapter_fragment_mismatch.html")
        sections = extract_section_links(html, "https://www.cga.ct.gov/current/pub/chap_319i.htm", "17a")
        self.assertEqual([section["section_key"] for section in sections], ["17a-615", "17a-616"])
        self.assertEqual(sections[0]["source_fragment_key"], "17a-175")
        self.assertIn("disagrees", sections[0]["identifier_warning"])
        content = extract_section_text_map(html, sections)
        self.assertIn("compact text begins here", content["17a-615"]["text"])
        self.assertNotIn("administrator shall carry out", content["17a-615"]["text"])

    def test_grouped_ranges_expand_without_former_citation(self):
        html = fixture("chapter_grouped_ranges.html")
        sections = extract_section_links(html, "https://www.cga.ct.gov/current/pub/chap_034.htm", "03")
        self.assertEqual(len(sections), 1)
        self.assertEqual(sections[0]["section_keys"], ["3-114p", "3-114q", "3-114r"])
        content = extract_grouped_section_content(html, sections[0])
        self.assertEqual(content["status"], "repealed")

    def test_future_effective_text_remains_in_section_boundary(self):
        html = fixture("chapter_future_effective.html")
        sections = extract_section_links(html, "https://www.cga.ct.gov/current/pub/chap_166.htm", "10")
        content = extract_section_text_map(html, sections)
        self.assertIn("Existing subsection text", content["10-145a"]["text"])
        self.assertIn("On and after July 1, 2025", content["10-145a"]["text"])
        self.assertIn("Replacement subsection text", content["10-145a"]["text"])

    def test_group_expansion_and_legal_statuses(self):
        self.assertEqual(
            expand_grouped_section_keys("secs_20-341s_to_20-341bb"),
            ["20-341s", "20-341t", "20-341u", "20-341v", "20-341w", "20-341x", "20-341y", "20-341z", "20-341aa", "20-341bb"],
        )
        self.assertEqual(detect_section_status("Reserved for future use."), ["reserved"])
        self.assertEqual(
            detect_section_status("All sections transferred, repealed or obsolete."),
            ["repealed", "transferred", "obsolete"],
        )


if __name__ == "__main__":
    unittest.main()
