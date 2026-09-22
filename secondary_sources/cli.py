from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

from .acquisition import INFRACTIONS_URL, PdfAcquirer, PdfSnapshotStore, VerifiedCurlSession
from .pipeline import import_pdfs, rebind_artifacts


def main():
    parser = argparse.ArgumentParser(description="Acquire, import, and rebind CGS secondary sources")
    commands = parser.add_subparsers(dest="command", required=True)

    acquire = commands.add_parser("acquire", help="capture all four official PDFs content-addressably")
    acquire.add_argument("--output", default=".crawl/secondary/sources")
    acquire.add_argument("--captured-at")
    acquire.add_argument("--infractions-file", help="use a manually retrieved Judicial Branch PDF")
    acquire.add_argument(
        "--judicial-client", choices=("requests", "windows-curl"), default="requests",
        help="use Windows native curl/Schannel for the Judicial PDF on Windows runners",
    )
    acquire.add_argument(
        "--no-cga-ssl-verify",
        "--no-ssl-verify",
        dest="no_cga_ssl_verify",
        action="store_true",
        help="explicit CGA-only certificate-chain workaround; Judicial Branch TLS remains verified",
    )

    build = commands.add_parser("import", help="parse PDFs into canonical static artifacts")
    build.add_argument("--sources", help="snapshot manifest produced by the acquire command")
    build.add_argument("--infractions")
    build.add_argument("--index", action="append", help="repeat for the three index PDFs")
    build.add_argument("--revision")
    build.add_argument("--base", default="public/data")
    build.add_argument("--output", default=".crawl/secondary/canonical")
    build.add_argument("--generated-at")

    rebind = commands.add_parser("rebind", help="resolve published records against a new base without downloading PDFs")
    rebind.add_argument("--input", default="public/data/secondary")
    rebind.add_argument("--base", default="public/data")
    rebind.add_argument("--output", default=".crawl/secondary/rebound")
    rebind.add_argument("--generated-at")

    args = parser.parse_args()
    if args.command == "rebind":
        manifest = rebind_artifacts(
            input_dir=args.input, base_data_dir=args.base, output_dir=args.output,
            generated_at=args.generated_at,
        )
        print(
            f"Rebound {manifest['counts']['infractions']} published infractions and "
            f"{manifest['counts']['indexHeadings']} index headings into {args.output}; no PDFs acquired"
        )
        return
    if args.command == "acquire":
        judicial_session = None
        if args.judicial_client == "windows-curl":
            if os.name != "nt":
                parser.error("--judicial-client windows-curl requires Windows")
            judicial_session = VerifiedCurlSession(Path(os.environ["SystemRoot"]) / "System32" / "curl.exe")
        try:
            import truststore
            truststore.inject_into_ssl()
        except ImportError:
            pass
        captures, revision = PdfAcquirer(
            PdfSnapshotStore(Path(args.output)),
            judicial_session=judicial_session,
            verify_ssl=True,
            cga_verify_ssl=not args.no_cga_ssl_verify,
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
        infractions_url=infractions_url or INFRACTIONS_URL,
        index_urls=index_urls,
    )
    print(
        f"Imported {manifest['counts']['infractions']} infractions and "
        f"{manifest['counts']['indexHeadings']} index headings into {args.output}"
    )


if __name__ == "__main__":
    main()
