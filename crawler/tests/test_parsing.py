from pathlib import Path
import unittest

from crawler.cgs_crawler.parsing import (
    detect_section_status,
    expand_grouped_section_keys,
    extract_chapter_links,
    extract_grouped_section_content,
    extract_inline_title_chapter,
    extract_revision_year,
    extract_section_links,
    extract_section_text_map,
)

FIXTURES = Path(__file__).parent / "fixtures"


def fixture(name: str) -> str:
    return (FIXTURES / name).read_text(encoding="utf-8")


class ParsingTests(unittest.TestCase):
    def test_revision_year_comes_from_the_titles_heading_not_the_supplement_note(self):
        page = (
            "<h1>GENERAL STATUTES OF CONNECTICUT</h1><h2><i>Revised to January 1, 2025</i></h2>"
            '<p><a href="/2026/sup/titles.htm">Note: Readers should refer to the 2026 Supplement, '
            "revised to January 1, 2026, for updated versions of statutes.</a></p>"
        )
        self.assertEqual(extract_revision_year(page), 2025)
        self.assertEqual(extract_revision_year('<p>Revised to January 1, 2025</p>'), None)

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

    def test_cross_references_are_annotations_not_statutory_text(self):
        html = fixture("chapter_cross_references.html")
        content = extract_section_text_map(html, [{
            "section_key": "51-277",
            "label": "Sec. 51-277. Powers and duties of division.",
            "url": "https://www.cga.ct.gov/current/pub/chap_886.htm#sec_51-277",
        }])["51-277"]
        self.assertEqual(content["body_paragraphs"], [
            "(a) The division shall exercise all powers and duties conferred upon it by this chapter.",
            "(b) See section 31-290d for additional duties.",
        ])
        self.assertEqual(content["text"], "\n\n".join(content["body_paragraphs"]))
        self.assertEqual(content["source"], ["(P.A. 73-122, S. 3, 27.)"])
        self.assertEqual(content["history"], ["History: P.A. 05-288 made a technical change."])
        self.assertEqual(content["annotations"], [
            {"first": True, "text": "See Sec. 31-290d re workers' compensation fraud unit within the office of the Chief State's Attorney in the Division of Criminal Justice."},
            {"first": False, "text": "See Sec. 2-1 re additional information."},
            {"first": True, "text": "Cited. 234 C. 539."},
            {"first": False, "text": "Cited. 43 CS 38."},
        ])

    def test_grouped_cross_references_are_annotations(self):
        content = extract_grouped_section_content(fixture("chapter_cross_references.html"), {
            "label": "Secs. 51-278 and 51-279.",
            "url": "https://www.cga.ct.gov/current/pub/chap_886.htm#secs_51-278_51-279",
        })
        self.assertEqual(content["body_paragraphs"], ["Sections 51-278 and 51-279 are repealed."])
        self.assertEqual(content["text"], "Sections 51-278 and 51-279 are repealed.")
        self.assertEqual(content["annotations"], [
            {"first": True, "text": "See Sec. 51-277 re powers and duties."},
            {"first": False, "text": "See Sec. 51-275 re definitions."},
            {"first": True, "text": "Cited. 100 C. 1."},
        ])

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
