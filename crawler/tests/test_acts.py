import json
from pathlib import Path
import tempfile
import unittest

from crawler.cgs_crawler.act_text import text_bytes
from crawler.cgs_crawler.acts import attach_texts, merge_sessions, parse_acts_page, read_published, write_published

FIXTURES = Path(__file__).parent / "fixtures"
PAGE_URL = "https://www.cga.ct.gov/asp/CGATodayFileCopies/CGAAllPA.asp"


def fixture_page() -> str:
    return (FIXTURES / "acts_page.html").read_text(encoding="utf-8")


def act(number, kind="public", title="AN ACT CONCERNING TESTS."):
    prefix = "pa" if kind == "public" else "sa"
    return {
        "id": f"{prefix}-2026-regular-{number}", "type": kind, "number": number,
        "citation": f"{'P.A.' if kind == 'public' else 'S.A.'} 26-{number}", "title": title,
        "bill": "HB 1", "billUrl": "https://www.cga.ct.gov/bill", "url": "https://www.cga.ct.gov/act.pdf",
    }


SESSION = {"id": "2026-regular", "year": 2026, "name": "2026 Regular Session"}


class ParseActsPageTests(unittest.TestCase):
    def test_parses_public_and_special_acts_with_absolute_links(self):
        [entry] = parse_acts_page(fixture_page(), PAGE_URL)
        self.assertEqual(entry["session"], SESSION)
        self.assertEqual([value["citation"] for value in entry["acts"]], ["P.A. 26-150", "P.A. 26-151", "S.A. 26-1"])
        first = entry["acts"][1]
        self.assertEqual(first["id"], "pa-2026-regular-151")
        self.assertEqual(first["bill"], "HB 5557")
        self.assertTrue(first["title"].startswith("AN ACT CONCERNING A PLAN TO REVISE"))
        self.assertEqual(first["url"], "https://www.cga.ct.gov/2026/act/pa/pdf/2026PA-00151-R00HB-05557-PA.pdf")
        self.assertEqual(
            first["billUrl"],
            "https://www.cga.ct.gov/asp/cgabillstatus/cgabillstatus.asp?selBillType=Bill&bill_num=HB05557&which_year=2026",
        )
        self.assertEqual(entry["acts"][2]["type"], "special")

    def test_empty_session_is_omitted(self):
        html = fixture_page().split("<tbody>")[0] + "<tbody></tbody></table>"
        self.assertEqual(parse_acts_page(html, PAGE_URL), [])

    def test_special_sessions_get_their_own_identity(self):
        html = fixture_page().replace("</TABLE>", "</TABLE><h3>2026 June Special Session</h3>" + fixture_page().split("2026 Regular Session\n</h3>")[1].split("</TABLE>")[0] + "</TABLE>")
        sessions = parse_acts_page(html, PAGE_URL)
        self.assertEqual([entry["session"]["id"] for entry in sessions], ["2026-regular", "2026-june-special"])
        special = sessions[1]["acts"][0]
        self.assertEqual(special["id"], "pa-2026-june-special-150")
        self.assertEqual(special["citation"], "P.A. 26-150 (June Sp. Sess.)")

    def test_rejects_unexpected_markup(self):
        with self.assertRaisesRegex(ValueError, "does not look like"):
            parse_acts_page("<html><body><table></table></body></html>", PAGE_URL)
        with self.assertRaisesRegex(ValueError, "unrecognized act row"):
            parse_acts_page(fixture_page().replace("Public&nbsp;Act&nbsp;No.&nbsp;151", "Pending"), PAGE_URL)


class MergeSessionsTests(unittest.TestCase):
    def test_keeps_sessions_the_page_no_longer_lists(self):
        published = {"2025-regular": {"session": {"id": "2025-regular", "year": 2025, "name": "2025 Regular Session"}, "acts": [act(1)], "updatedAt": "2025-07-01T00:00:00Z"}}
        merged = merge_sessions([{"session": SESSION, "acts": [act(1)]}], published, retrieved_at="2026-10-05T00:00:00Z")
        self.assertEqual([entry["session"]["id"] for entry in merged], ["2026-regular", "2025-regular"])

    def test_unchanged_sessions_keep_their_update_time(self):
        published = {"2026-regular": {"session": SESSION, "acts": [act(1)], "updatedAt": "2026-07-01T00:00:00Z"}}
        [entry] = merge_sessions([{"session": SESSION, "acts": [act(1)]}], published, retrieved_at="2026-10-05T00:00:00Z")
        self.assertEqual(entry["updatedAt"], "2026-07-01T00:00:00Z")
        [entry] = merge_sessions([{"session": SESSION, "acts": [act(1), act(2)]}], published, retrieved_at="2026-10-05T00:00:00Z")
        self.assertEqual(entry["updatedAt"], "2026-10-05T00:00:00Z")

    def test_refuses_to_drop_published_acts_unless_allowed(self):
        published = {"2026-regular": {"session": SESSION, "acts": [act(1), act(2)], "updatedAt": "2026-07-01T00:00:00Z"}}
        with self.assertRaisesRegex(ValueError, "no longer lists 1 published act"):
            merge_sessions([{"session": SESSION, "acts": [act(1)]}], published, retrieved_at="2026-10-05T00:00:00Z")
        [entry] = merge_sessions([{"session": SESSION, "acts": [act(1)]}], published, retrieved_at="2026-10-05T00:00:00Z", allow_removals=True)
        self.assertEqual(len(entry["acts"]), 1)

    def test_retires_named_sessions(self):
        published = {"2025-regular": {"session": {"id": "2025-regular", "year": 2025, "name": "2025 Regular Session"}, "acts": [act(1)], "updatedAt": "2025-07-01T00:00:00Z"}}
        self.assertEqual(merge_sessions([], published, retrieved_at="2026-10-05T00:00:00Z", retire=["2025-regular"]), [])
        with self.assertRaisesRegex(ValueError, "unknown session"):
            merge_sessions([], published, retrieved_at="2026-10-05T00:00:00Z", retire=["1999-regular"])


class PublishTests(unittest.TestCase):
    def test_round_trips_and_rewrites_identically_when_unchanged(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            parsed = parse_acts_page(fixture_page(), PAGE_URL)
            manifest = write_published(merge_sessions(parsed, {}, retrieved_at="2026-10-05T00:00:00Z"), root)
            self.assertEqual(manifest["counts"], {"sessions": 1, "acts": 3, "publicActs": 2, "specialActs": 1, "textActs": 0})
            self.assertEqual(manifest["generatedAt"], "2026-10-05T00:00:00Z")
            before = {path.name: path.read_bytes() for path in root.iterdir()}
            write_published(merge_sessions(parsed, read_published(root), retrieved_at="2026-10-12T00:00:00Z"), root)
            self.assertEqual({path.name: path.read_bytes() for path in root.iterdir()}, before)

    def test_removes_files_for_retired_sessions(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            parsed = parse_acts_page(fixture_page(), PAGE_URL)
            write_published(merge_sessions(parsed, {}, retrieved_at="2026-10-05T00:00:00Z"), root)
            write_published(merge_sessions([], read_published(root), retrieved_at="2026-10-05T00:00:00Z", retire=["2026-regular"]), root)
            self.assertEqual(sorted(path.name for path in root.iterdir()), ["manifest.json"])
            self.assertEqual(json.loads((root / "manifest.json").read_text(encoding="utf-8"))["sessions"], [])


def text_for(value, words="Redemption centers"):
    return {
        "schemaVersion": "1.0.0", "id": value["id"], "citation": value["citation"], "extractorVersion": 1,
        "source": {"url": value["url"], "bytes": 100, "sha256": "0" * 64, "pages": 2},
        "front": {"bill": "House Bill No. 1", "act": "Public Act No. 26-1", "title": value["title"]},
        "sections": [{"number": "1", "anchor": "sec-1"}],
        "blocks": [{"type": "p", "page": 1, "anchor": "sec-1", "section": "1", "runs": [f"Section 1. {words}"]}],
    }


class TextPublishTests(unittest.TestCase):
    def publish(self, root, texts, published=None, retrieved_at="2026-10-05T00:00:00Z", **merge):
        sessions = merge_sessions([{"session": SESSION, "acts": [act(1), act(2)]}], published or {}, retrieved_at=retrieved_at, **merge)
        return write_published(attach_texts(sessions, texts, retrieved_at=retrieved_at), root, texts=texts)

    def test_writes_texts_and_a_search_index_as_artifacts(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            texts = {"pa-2026-regular-1": text_for(act(1))}
            manifest = self.publish(root, texts)
            session = json.loads((root / "2026-regular.json").read_text(encoding="utf-8"))
            reference = session["acts"][0]["text"]
            self.assertEqual(reference["path"], "2026-regular/text/pa-1.json")
            self.assertEqual(reference["pages"], 2)
            self.assertNotIn("text", session["acts"][1])
            self.assertEqual((root / reference["path"]).read_bytes(), text_bytes(texts["pa-2026-regular-1"]))
            index = json.loads((root / "2026-regular/search.json").read_text(encoding="utf-8"))
            self.assertEqual(index["acts"], ["pa-2026-regular-1"])
            self.assertEqual(index["terms"]["redemption"], [0])
            self.assertEqual(manifest["sessions"][0]["counts"]["textActs"], 1)
            self.assertEqual(manifest["sessions"][0]["search"]["path"], "2026-regular/search.json")
            effective = json.loads((root / "2026-regular/effective.json").read_text(encoding="utf-8"))
            self.assertEqual(effective["acts"], [{"id": "pa-2026-regular-1", "dates": [{"effective": None, "sections": ["1"]}]}])
            self.assertEqual(manifest["sessions"][0]["effective"]["path"], "2026-regular/effective.json")
            self.assertEqual(sorted(artifact["path"] for artifact in manifest["artifacts"]), ["2026-regular.json", "2026-regular/effective.json", "2026-regular/search.json", "2026-regular/text/pa-1.json"])

    def test_dates_a_session_only_when_its_texts_change(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            texts = {"pa-2026-regular-1": text_for(act(1))}
            self.publish(root, texts)
            published = read_published(root)
            self.assertEqual(published["2026-regular"]["texts"], texts)
            self.assertNotIn("text", published["2026-regular"]["acts"][0])
            manifest = self.publish(root, texts, published, retrieved_at="2026-10-12T00:00:00Z")
            self.assertEqual(manifest["sessions"][0]["updatedAt"], "2026-10-05T00:00:00Z")
            changed = {"pa-2026-regular-1": text_for(act(1), "Bottle bill")}
            manifest = self.publish(root, changed, read_published(root), retrieved_at="2026-10-19T00:00:00Z")
            self.assertEqual(manifest["sessions"][0]["updatedAt"], "2026-10-19T00:00:00Z")

    def test_removes_texts_that_are_no_longer_published(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.publish(root, {"pa-2026-regular-1": text_for(act(1))})
            self.publish(root, {}, read_published(root))
            self.assertEqual(sorted(path.relative_to(root).as_posix() for path in root.rglob("*")), ["2026-regular.json", "manifest.json"])

    def test_reading_detects_a_corrupted_text(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.publish(root, {"pa-2026-regular-1": text_for(act(1))})
            target = root / "2026-regular/text/pa-1.json"
            target.write_bytes(target.read_bytes().replace(b"Redemption", b"Reduction"))
            with self.assertRaisesRegex(RuntimeError, "integrity check: 2026-regular/text/pa-1.json"):
                read_published(root)


if __name__ == "__main__":
    unittest.main()
