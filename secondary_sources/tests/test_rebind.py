import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from secondary_sources.pipeline import build_artifacts, rebind_artifacts


TIMESTAMP = "2026-07-14T12:00:00Z"


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def write_base(root, *, chapter="001", citations=("14-1", "14-2"), title="14"):
    (root / "chapters").mkdir(parents=True, exist_ok=True)
    catalog = {
        "schemaVersion": "1.0.0", "generatedAt": TIMESTAMP,
        "titles": [{"id": f"title-{title}", "number": title, "chapters": [
            {"id": f"chapter-{chapter}", "number": chapter, "path": f"chapters/{chapter}.json"},
        ]}],
    }
    (root / "catalog.json").write_text(json.dumps(catalog), encoding="utf-8")
    (root / "manifest.json").write_text(json.dumps({"fixture": chapter, "citations": citations}), encoding="utf-8")
    (root / "chapters" / f"{chapter}.json").write_text(json.dumps({"sections": [
        {"id": f"section-{citation}", "citations": [citation]} for citation in citations
    ]}), encoding="utf-8")


def build_fixture(root):
    base = root / "base"
    write_base(base)
    source = root / "published"
    file = {"name": "source.pdf", "url": "https://example.test/source.pdf", "bytes": 10, "sha256": "a" * 64}
    common_source = {"name": "Fixture", "publisher": "Fixture", "url": file["url"], "pageCount": 1}
    build_artifacts(
        output_dir=source, base_data_dir=base, generated_at=TIMESTAMP,
        infractions_entries=[{
            "stat_no": citation, "citation": citation, "section_key": section,
            "description": f"Violation of {citation}", "category": "EXAMPLE", "page": 3,
            "amounts": {"fine": "12.34", "total_due": "56.78"}, "note": "Printed note",
        } for citation, section in [("14-1", "14-1"), ("14-2(a)", "14-2"), ("14-3", "14-3")]],
        infractions_fee_rules=[{
            "authority_citation": "14-1(a)", "description": "Fee description",
            "affected_text": "14-2(b) and 14-3", "comments": "Printed comments", "pages": [4],
            "affected_references": [
                {"display": citation, "section_key": section}
                for citation, section in [("14-2(b)", "14-2"), ("14-3", "14-3")]
            ],
        }],
        infractions_source={**common_source, "effective": "October 1, 2025", "chartBRevision": "10-2025", "files": [file]},
        index_headings=[{"h": heading, "items": [{
            "l": 1, "t": "Printed index text", "see": [["ALPHA", "Subheading", "See also"]],
            "r": [["14-1", "14-1"], ["14-2(b)", "14-2"], ["14-3", "14-3"], ["U.S. Const.", None]],
        }]} for heading in ["ZEBRA", "ALPHA"]],
        index_source={**common_source, "revision": "January 1, 2025", "files": [file, file, file]},
    )
    return base, source


def records(root):
    infractions_manifest = read_json(root / "infractions/manifest.json")
    index_manifest = read_json(root / "statutes-index/manifest.json")
    return {
        "infractions": sorted([
            entry for shard in infractions_manifest["shards"]
            for entry in read_json(root / "infractions" / shard["path"])["entries"]
        ], key=lambda entry: entry["id"]),
        "feeRules": read_json(root / "infractions/fee-rules.json")["rules"],
        "topics": sorted([
            topic for shard in index_manifest["shards"]
            for topic in read_json(root / "statutes-index" / shard["path"])["headings"]
        ], key=lambda topic: topic["position"]),
        "sources": [infractions_manifest["source"], index_manifest["source"]],
    }


def without_resolution(value):
    if isinstance(value, list):
        return [without_resolution(item) for item in value]
    if isinstance(value, dict):
        return {key: without_resolution(item) for key, item in value.items()
                if key not in {"resolution", "authorityResolution"}}
    return value


class RebindTests(unittest.TestCase):
    def validate(self, output, base):
        result = subprocess.run([
            "node", "scripts/validate-secondary.mjs", "--data", str(output), "--base", str(base),
            "--schemas", "schemas",
        ], cwd=Path(__file__).resolve().parents[2], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_unchanged_base_round_trip_is_byte_identical_and_offline(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            base, source = build_fixture(root)
            output = root / "rebound"
            with patch("requests.Session.get", side_effect=AssertionError("No network allowed")), \
                    patch("secondary_sources.pipeline.parse_infractions_pdf", side_effect=AssertionError("No PDFs allowed")), \
                    patch("secondary_sources.pipeline.parse_index_pdfs", side_effect=AssertionError("No PDFs allowed")):
                rebind_artifacts(input_dir=source, base_data_dir=base, output_dir=output, generated_at=TIMESTAMP)
            self.assertEqual(
                {path.relative_to(source): path.read_bytes() for path in source.rglob("*.json")},
                {path.relative_to(output): path.read_bytes() for path in output.rglob("*.json")},
            )
            self.validate(output, base)

    def test_new_base_rebuilds_resolutions_shards_and_reverse_links_without_changing_records(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            base, source = build_fixture(root)
            before = records(source)
            candidate = root / "candidate"
            # Exercise title/chapter relocation, a removed citation, and a newly available citation.
            write_base(candidate, chapter="002", citations=("14-2", "14-3"), title="15")
            output = candidate / "secondary"
            manifest = rebind_artifacts(input_dir=source, base_data_dir=candidate, output_dir=output)
            after = records(output)
            self.assertEqual(without_resolution(before), without_resolution(after))
            self.assertEqual(manifest["base"]["manifestSha256"], hashlib.sha256((candidate / "manifest.json").read_bytes()).hexdigest())
            by_citation = {entry["sectionCitation"]: entry for entry in after["infractions"]}
            self.assertEqual(by_citation["14-1"]["resolution"], {"status": "unresolved"})
            self.assertEqual(by_citation["14-2"]["resolution"], {"status": "section-only", "href": "#/t/15/c/002/s/14-2"})
            self.assertEqual(by_citation["14-3"]["resolution"], {"status": "exact", "href": "#/t/15/c/002/s/14-3"})
            self.assertFalse((output / "infractions/title-14.json").exists())
            self.assertEqual(len(read_json(output / "infractions/title-15.json")["entries"]), 2)
            self.assertEqual(after["feeRules"][0]["authorityResolution"], {"status": "unresolved"})
            links = read_json(output / "links/title-15.json")["sections"]
            self.assertEqual(set(links), {"14-2", "14-3"})
            self.assertEqual(links["14-3"]["feeRules"][0]["role"], "affected")
            self.assertEqual(len(links["14-3"]["indexEntries"]), 2)
            self.assertEqual(before, records(source))
            self.validate(output, candidate)

    def test_invalid_inputs_fail_before_replacing_candidate(self):
        for defect in ["corrupt-file", "wrong-count", "outside-path", "missing-file"]:
            with self.subTest(defect=defect), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                base, source = build_fixture(root)
                output = root / "candidate"
                output.mkdir()
                (output / "sentinel").write_text("keep me", encoding="utf-8")
                manifest = read_json(source / "manifest.json")
                if defect == "corrupt-file":
                    (source / manifest["artifacts"][0]["path"]).write_bytes(b"changed")
                elif defect == "wrong-count":
                    manifest["counts"]["infractions"] += 1
                elif defect == "outside-path":
                    manifest["artifacts"][0]["path"] = "../outside.json"
                else:
                    (source / manifest["artifacts"][0]["path"]).unlink()
                (source / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
                with self.assertRaises((ValueError, FileNotFoundError)):
                    rebind_artifacts(input_dir=source, base_data_dir=base, output_dir=output)
                self.assertEqual((output / "sentinel").read_text(encoding="utf-8"), "keep me")

    def test_rebind_rejects_overlapping_output_and_base_replacement(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            base, source = build_fixture(root)
            for output in [source, source / "child", root, base]:
                with self.subTest(output=output), self.assertRaises(ValueError):
                    rebind_artifacts(input_dir=source, base_data_dir=base, output_dir=output)
            self.validate(source, base)


if __name__ == "__main__":
    unittest.main()
