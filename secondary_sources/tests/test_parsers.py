import unittest

from secondary_sources.infractions_parser import clean_citation, parse_chart_b, parse_schedule, polish_entries
from secondary_sources.statutes_index_parser import IndexParser, page_column_lines


def word(text, x0, top, x1=None, size=9.0):
    return {"text": text, "x0": x0, "x1": x1 if x1 is not None else x0 + max(5, len(text) * 4), "top": top, "size": size}


class FakePage:
    def __init__(self, words=None):
        self.words = words or []

    def extract_words(self, **_kwargs):
        return [dict(value) for value in self.words]


class FakePdf:
    def __init__(self, pages):
        self.pages = pages


class ParserTests(unittest.TestCase):
    def test_infractions_parser_reconstructs_row_and_money_columns(self):
        headers = [
            word("STAT", 35, 10), word("NO", 60, 10), word("INFRACTIONS/VIOLATIONS", 100, 10),
            word("DUE", 445, 10), word("FINE", 472, 10), word("FEE", 509, 10), word("FEE", 542, 10),
            word("COST", 583, 10), word("CHARGE", 620, 10), word("STF", 657, 10), word("BIPSA", 694, 10),
            word("MF", 728, 10), word("PLUS", 754, 10),
        ]
        category = [word("MOTOR", 35, 30), word("VEHICLES", 70, 30)]
        row = [
            word("14-1", 35, 45), word("Example", 100, 45), word("violation", 145, 45),
            word("117.00", 440, 45, 466), word("50.00", 468, 45, 492), word("7.00", 505, 45, 525),
            word("35.00", 618, 45, 644), word("25.00", 692, 45, 718),
        ]
        pdf = FakePdf([FakePage() for _ in range(5)] + [FakePage(headers + category + row)])
        entries = parse_schedule(pdf)
        polish_entries(entries)
        self.assertEqual(len(entries), 1)
        self.assertEqual(entries[0]["section_key"], "14-1")
        self.assertEqual(entries[0]["category"], "MOTOR VEHICLES")
        self.assertEqual(entries[0]["amounts"]["total_due"], 117.0)
        self.assertEqual(entries[0]["amounts"]["fine"], 50.0)

    def test_citation_cleanup_preserves_section_and_rebuilds_subsections(self):
        self.assertEqual(clean_citation("14-100a(d1B*", "14-100a"), "14-100a(d)(1)(B)")

    def test_chart_b_parser_retains_cross_page_prose_and_derives_references(self):
        first = FakePage([
            word("CHART", 35, 20), word("B", 75, 20), word("(Rev.", 600, 20), word("10-2025)", 635, 20),
            word("14-212a", 35, 140), word("Additional", 110, 140), word("fee", 160, 140),
            word("14-213,", 280, 140), word("14-", 330, 140),
        ])
        second = FakePage([
            word("222", 280, 140), word("and", 310, 140), word("14-227a", 335, 140),
            word("14-212b", 35, 170), word("Speeding", 110, 170), word("14-219", 280, 170),
        ])
        rules, revision = parse_chart_b(FakePdf([first, second]))
        self.assertEqual(revision, "10-2025")
        self.assertEqual(len(rules), 2)
        self.assertEqual(rules[0]["pages"], [1, 2])
        self.assertIn("14-222", rules[0]["affected_text"])
        self.assertEqual(
            [reference["section_key"] for reference in rules[0]["affected_references"]],
            ["14-213", "14-222", "14-227a"],
        )

    def test_index_parser_preserves_hierarchy_references_and_see_targets(self):
        parser = IndexParser()
        parser.feed_line(0, "MOTOR VEHICLES")
        parser.feed_line(0, "Licenses, 14-1")
        parser.feed_line(0, "Registration—See TRANSPORTATION, at Registration.")
        headings = parser.finish()
        self.assertEqual(headings[0]["h"], "MOTOR VEHICLES")
        self.assertEqual(headings[0]["items"][0]["r"], [["14-1", "14-1"]])
        self.assertEqual(headings[0]["items"][1]["see"], [["TRANSPORTATION", "Registration"]])

    def test_index_page_geometry_reads_left_column_before_right(self):
        page = FakePage([
            word("Left", 123, 120), word("entry,", 145, 120), word("14-1", 180, 120),
            word("RIGHT", 312, 120), word("HEADING", 350, 120),
        ])
        self.assertEqual(list(page_column_lines(page)), [(0, "Left entry, 14-1"), (0, "RIGHT HEADING")])


if __name__ == "__main__":
    unittest.main()
