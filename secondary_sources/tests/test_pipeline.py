import json
from pathlib import Path
import subprocess
import tempfile
import unittest

from secondary_sources.pipeline import build_artifacts


def source_file(name):
    return {"name": name, "url": "https://example.test/source.pdf", "bytes": 100, "sha256": "a" * 64}


class PipelineTests(unittest.TestCase):
    def base_corpus(self, root):
        base = root / "base"
        (base / "chapters").mkdir(parents=True)
        catalog = {
            "schemaVersion": "1.0.0", "generatedAt": "2026-07-14T00:00:00Z",
            "titles": [{
                "id": "title-14", "number": "14", "chapters": [{
                    "id": "chapter-001", "number": "001", "path": "chapters/001.json"
                }]
            }]
        }
        chapter = {
            "sections": [{"id": "section-14-1", "citations": ["14-1"]}]
        }
        (base / "catalog.json").write_text(json.dumps(catalog), encoding="utf-8")
        (base / "manifest.json").write_text('{"fixture":true}\n', encoding="utf-8")
        (base / "chapters" / "001.json").write_text(json.dumps(chapter), encoding="utf-8")
        return base

    def test_builds_shards_reverse_links_and_validates_against_base(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            base = self.base_corpus(root)
            output = root / "secondary"
            arguments = dict(
                base_data_dir=base,
                generated_at="2026-07-14T12:00:00Z",
                infractions_entries=[{
                    "stat_no": "14-1", "citation": "14-1", "section_key": "14-1",
                    "description": "Example violation", "category": "MOTOR VEHICLES",
                    "subsequent": False, "page": 6, "amounts": {"total_due": 117.0, "fine": 50.0}
                }, {
                    "stat_no": "PA25-55", "citation": "PA 25-55", "section_key": "pa25-55",
                    "description": "Session law violation", "category": "MISCELLANEOUS",
                    "subsequent": False, "page": 40, "amounts": {"total_due": 90.0}
                }],
                infractions_source={
                    "name": "Infractions", "publisher": "Judicial Branch", "url": "https://example.test/infractions.pdf",
                    "effective": "October 1, 2025", "chartBRevision": "10-2025",
                    "pageCount": 76, "files": [source_file("infractions.pdf")]
                },
                infractions_fee_rules=[{
                    "authority_citation": "14-1(a)", "description": "Example fee",
                    "affected_text": "14-1", "comments": "Example comment", "pages": [75],
                    "affected_references": [{"display": "14-1", "section_key": "14-1"}],
                }],
                index_headings=[{
                    "h": "MOTOR VEHICLES", "items": [{
                        "l": 0, "t": "Licenses", "r": [["14-1", "14-1"], ["U.S. Const. I:9", None]],
                        "see": [["MOTOR VEHICLES", "Licenses", "Licenses"]]
                    }]
                }],
                index_source={
                    "name": "Index", "publisher": "LCO", "url": "https://example.test/index",
                    "revision": "Revised to January 1, 2025", "pageCount": 2718,
                    "files": [source_file("a.pdf"), source_file("i.pdf"), source_file("t.pdf")]
                },
            )
            manifest = build_artifacts(output_dir=output, **arguments)
            self.assertEqual(manifest["counts"], {"infractions": 2, "feeRules": 1, "indexHeadings": 1, "indexItems": 1})
            resolved = json.loads((output / "infractions" / "title-14.json").read_text(encoding="utf-8"))
            self.assertEqual(resolved["entries"][0]["amounts"]["total_due"], 11700)
            self.assertEqual(resolved["entries"][0]["resolution"]["status"], "exact")
            index_shard = next(
                path for path in (output / "statutes-index").glob("*.json")
                if path.name != "manifest.json"
            )
            index_data = json.loads(index_shard.read_text(encoding="utf-8"))
            self.assertEqual(
                index_data["headings"][0]["items"][0]["see"],
                [{"heading": "MOTOR VEHICLES", "subheading": "Licenses", "label": "Licenses"}],
            )
            links = json.loads((output / "links" / "title-14.json").read_text(encoding="utf-8"))
            self.assertEqual(len(links["sections"]["14-1"]["infractions"]), 1)
            self.assertEqual(
                {link["role"] for link in links["sections"]["14-1"]["feeRules"]},
                {"authority", "affected"},
            )
            validation = subprocess.run(
                ["node", "scripts/validate-secondary.mjs", "--data", str(output), "--base", str(base), "--schemas", "schemas"],
                cwd=Path(__file__).resolve().parents[2], capture_output=True, text=True
            )
            self.assertEqual(validation.returncode, 0, validation.stdout + validation.stderr)

            second = root / "secondary-again"
            build_artifacts(output_dir=second, **arguments)
            first_files = {
                path.relative_to(output): path.read_bytes()
                for path in output.rglob("*.json")
            }
            second_files = {
                path.relative_to(second): path.read_bytes()
                for path in second.rglob("*.json")
            }
            self.assertEqual(first_files, second_files)


if __name__ == "__main__":
    unittest.main()
