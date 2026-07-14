from __future__ import annotations

import argparse
import json
from pathlib import Path

from .acquisition import PdfAcquirer, PdfSnapshotStore
from .pipeline import import_pdfs


def main():
    parser = argparse.ArgumentParser(description="Acquire and import CGS secondary-source PDFs")
    commands = parser.add_subparsers(dest="command", required=True)

    acquire = commands.add_parser("acquire", help="capture all four official PDFs content-addressably")
    acquire.add_argument("--output", default=".crawl/secondary/sources")
    acquire.add_argument("--captured-at")
    acquire.add_argument("--infractions-file", help="use a manually retrieved Judicial Branch PDF")
    acquire.add_argument("--no-ssl-verify", action="store_true", help="explicit workaround for the CGA certificate chain")

    build = commands.add_parser("import", help="parse PDFs into canonical static artifacts")
    build.add_argument("--sources", help="snapshot manifest produced by the acquire command")
    build.add_argument("--infractions")
    build.add_argument("--index", action="append", help="repeat for the three index PDFs")
    build.add_argument("--revision")
    build.add_argument("--base", default="public/data")
    build.add_argument("--output", default=".crawl/secondary/canonical")
    build.add_argument("--generated-at")

    args = parser.parse_args()
    if args.command == "acquire":
        if not args.no_ssl_verify:
            try:
                import truststore
                truststore.inject_into_ssl()
            except ImportError:
                pass
        captures, revision = PdfAcquirer(
            PdfSnapshotStore(Path(args.output)), verify_ssl=not args.no_ssl_verify
        ).capture_all(
            args.captured_at, Path(args.infractions_file) if args.infractions_file else None
        )
        print(f"Captured {len(captures)} PDFs; {revision or 'revision not detected'}")
        return
    indexes = args.index or []
    index_urls = None
    infractions = args.infractions
    infractions_url = None
    revision = args.revision
    if args.sources:
        source_manifest = Path(args.sources)
        source_root = source_manifest.parent
        captured = json.loads(source_manifest.read_text(encoding="utf-8"))
        values = [{**entry, "url": url} for url, entry in captured.get("sources", {}).items()]
        infractions_entry = next((entry for entry in values if entry.get("name") == "infractions.pdf"), None)
        index_entries = sorted((entry for entry in values if str(entry.get("name", "")).startswith("Index ")), key=lambda entry: entry["name"])
        if not infractions_entry:
            parser.error("snapshot manifest does not contain infractions.pdf")
        infractions = str(source_root / infractions_entry["path"])
        infractions_url = infractions_entry["url"]
        indexes = [str(source_root / entry["path"]) for entry in index_entries]
        index_urls = [entry["url"] for entry in index_entries]
        revision = revision or captured.get("indexRevision")
    if not infractions:
        parser.error("--infractions is required unless --sources is provided")
    if len(indexes) != 3:
        parser.error("--index must be provided exactly three times")
    if not revision:
        parser.error("--revision is required unless the snapshot manifest records it")
    manifest = import_pdfs(
        output_dir=args.output,
        base_data_dir=args.base,
        infractions_pdf=infractions,
        index_pdfs=indexes,
        revision=revision,
        generated_at=args.generated_at,
        infractions_url=infractions_url or "https://www.jud.ct.gov/webforms/forms/infractions.pdf",
        index_urls=index_urls,
    )
    print(
        f"Imported {manifest['counts']['infractions']} infractions and "
        f"{manifest['counts']['indexHeadings']} index headings into {args.output}"
    )


if __name__ == "__main__":
    main()
