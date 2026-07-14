from __future__ import annotations

import argparse
import json
from pathlib import Path

from .config import CrawlConfig, FetchPolicy
from .parsing import normalize_title_key
from .pipeline import crawl


def parser() -> argparse.ArgumentParser:
    value = argparse.ArgumentParser(description="Acquire and parse Connecticut General Statutes into the legacy adapter format.")
    value.add_argument("--output", type=Path, default=Path(".crawl/legacy"))
    value.add_argument("--snapshots", type=Path, default=Path(".crawl/snapshots"))
    value.add_argument("--edition", choices=("current", "supplement"), default="current")
    value.add_argument("--supplement-year", type=int)
    value.add_argument("--titles", default="", help="Comma-separated normalized or unpadded title keys")
    value.add_argument("--offline", action="store_true", help="Replay only from the snapshot store; make no network requests")
    value.add_argument("--generated-at", help="ISO-8601 timestamp used in generated indexes")
    value.add_argument("--timeout", type=float, default=30.0)
    value.add_argument("--attempts", type=int, default=4)
    value.add_argument("--backoff", type=float, default=1.0)
    value.add_argument("--delay", type=float, default=0.3)
    value.add_argument("--jitter", type=float, default=0.2)
    value.add_argument("--no-ssl-verify", action="store_true")
    return value


def main() -> None:
    args = parser().parse_args()
    if args.edition == "supplement" and not args.supplement_year:
        raise SystemExit("--supplement-year is required for the supplement edition")
    titles = frozenset(normalize_title_key(value) for value in args.titles.split(",") if value.strip())
    if not args.no_ssl_verify:
        try:
            import truststore
            truststore.inject_into_ssl()
        except ImportError:
            pass
    config = CrawlConfig(
        output_dir=args.output,
        snapshot_dir=args.snapshots,
        edition=args.edition,
        supplement_year=args.supplement_year,
        only_titles=titles,
        offline=args.offline,
        generated_at=args.generated_at,
        fetch=FetchPolicy(
            timeout=args.timeout,
            attempts=args.attempts,
            backoff=args.backoff,
            delay=args.delay,
            jitter=args.jitter,
            verify_ssl=not args.no_ssl_verify,
        ),
    )
    print(json.dumps(crawl(config), indent=2))


if __name__ == "__main__":
    main()
