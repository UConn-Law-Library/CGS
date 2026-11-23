"""Checks CGA for the Supplement expected after the active full revision.

LCO publishes a full revision in odd-numbered years and a Supplement in even-numbered years, read
with the revision before it. With the 2027 revision active, this looks for the 2028 Supplement at
https://www.cga.ct.gov/2028/sup/titles.htm and reports one of:

- ``already-published``: public/data already has that supplement (the corpus refresh keeps it current);
- ``not-published``: CGA answers 404 for the page, so the edition does not exist yet;
- ``available``: the page exists, and its heading, edition, and publisher are the expected ones.

Anything else fails: a network or TLS failure after retries (exit 3), or a page that exists but is
not the expected official edition (exit 2). A failure never changes published data.

    python -m crawler.cgs_crawler.supplement_discovery --data public/data --github-output "$GITHUB_OUTPUT"
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Callable, List, Optional

from bs4 import BeautifulSoup

from .config import FetchPolicy
from .fetch import Fetcher, PermanentFetchError
from .parsing import extract_revision_year, text_clean
from .snapshots import SnapshotStore
from .tls import tls_verification

# Statuses that mean the page is not there. CGA's IIS server answers 404 for a year directory
# that does not exist yet.
NOT_PUBLISHED_STATUSES = frozenset({404, 410})
PUBLISHER = "Legislative Commissioners"


class SourcePageError(RuntimeError):
    """The page exists but is not the official edition it should be."""


class NetworkError(RuntimeError):
    """CGA could not be reached, so whether the edition exists is unknown."""


def supplement_url(year: int) -> str:
    return f"https://www.cga.ct.gov/{year}/sup/titles.htm"


def expected_supplement_year(catalog: dict) -> int:
    revision = (catalog.get("source") or {}).get("revisionYear")
    if not isinstance(revision, int):
        raise ValueError("catalog.json does not record source.revisionYear")
    if revision % 2 == 0:
        raise ValueError(f"catalog.json is revised to {revision}; full revisions are published in odd-numbered years")
    return revision + 1


def verify_supplement_page(html: str, year: int) -> List[str]:
    """Problems that keep this page from being the official Supplement for ``year``."""
    soup = BeautifulSoup(html, "html.parser")
    problems = []
    title = text_clean(soup.title.get_text(" ", strip=True)) if soup.title else ""
    heading = " ".join(text_clean(h1.get_text(" ", strip=True)) for h1 in soup.find_all("h1")[:1])
    expected = f"{year} Supplement to the General Statutes of Connecticut"
    if expected.lower() not in title.lower() and expected.lower() not in re.sub(r"\s+", " ", heading).lower():
        problems.append(f"the page does not name the {expected}")
    revision = extract_revision_year(html)
    if revision != year:
        problems.append(f"the page is revised to January 1, {revision}, not {year}" if revision else "the page does not state \"Revised to January 1\"")
    text = text_clean(soup.get_text(" ", strip=True))
    if PUBLISHER.lower() not in text.lower():
        problems.append("the page does not name the Legislative Commissioners' Office as its publisher")
    if f"revised to january 1, {year - 1}" not in text.lower():
        problems.append(f"the page does not say it is used with the General Statutes revised to January 1, {year - 1}")
    return problems


def probe(fetch: Callable[[str], str], year: int) -> dict:
    url = supplement_url(year)
    try:
        html = fetch(url)
    except PermanentFetchError as error:
        if error.status in NOT_PUBLISHED_STATUSES:
            return {"status": "not-published", "year": year, "url": url, "detail": f"HTTP {error.status}"}
        raise SourcePageError(f"{url} answered HTTP {error.status}; expected the page or 404") from error
    except (RuntimeError, ValueError) as error:
        raise NetworkError(f"{url} could not be checked: {error}") from error
    problems = verify_supplement_page(html, year)
    if problems:
        raise SourcePageError(f"{url} is not the official {year} Supplement: {'; '.join(problems)}")
    return {"status": "available", "year": year, "url": url, "heading": f"Revised to January 1, {year}"}


def discover(data_dir: Path, fetch: Callable[[str], str], year: Optional[int] = None, *, rehearse: bool = False) -> dict:
    catalog = json.loads((data_dir / "catalog.json").read_text(encoding="utf-8"))
    expected = year or expected_supplement_year(catalog)
    revision = catalog["source"]["revisionYear"]
    if expected != revision + 1:
        raise ValueError(f"The {expected} Supplement is read with the {expected - 1} revision, but public/data is revised to {revision}")
    # A rehearsal checks the page of a supplement that is already published, to exercise the
    # whole path (verify, crawl, import, validate) against a real edition.
    if not rehearse and (data_dir / "supplements" / str(expected) / "manifest.json").exists():
        return {"status": "already-published", "year": expected, "url": supplement_url(expected)}
    return probe(fetch, expected)


def parser() -> argparse.ArgumentParser:
    value = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    value.add_argument("--data", type=Path, default=Path("public/data"))
    value.add_argument("--year", type=int, help="check this supplement year instead of the one after the active revision")
    value.add_argument("--snapshots", type=Path, default=Path(".crawl/supplement-discovery-snapshots"))
    value.add_argument("--report", type=Path, help="write the result as JSON")
    value.add_argument("--github-output", type=Path, help="append status, year, and url for GitHub Actions")
    value.add_argument("--html", type=Path, help="check a saved copy of the page instead of fetching it")
    value.add_argument("--ca-bundle", type=Path, help="Verified CA bundle (or CGS_CA_BUNDLE)")
    value.add_argument("--rehearse", action="store_true", help="check the page even when the supplement is already published")
    return value


def main(argv: Optional[List[str]] = None) -> int:
    args = parser().parse_args(argv)
    if args.html:
        def fetch(_url: str) -> str:
            return args.html.read_text(encoding="utf-8-sig")
    else:
        fetcher = Fetcher(FetchPolicy(delay=0, jitter=0, verify_ssl=tls_verification(args.ca_bundle)), SnapshotStore(args.snapshots))
        fetch = fetcher.fetch
    try:
        result = discover(args.data, fetch, args.year, rehearse=args.rehearse)
    except NetworkError as error:
        print(f"Network failure: {error}", file=sys.stderr)
        return 3
    except (SourcePageError, ValueError) as error:
        print(f"Invalid source: {error}", file=sys.stderr)
        return 2
    messages = {
        "already-published": "The {year} Supplement is already published in public/data; the corpus refresh keeps it current.",
        "not-published": "CGA has not published the {year} Supplement yet ({url} answered {detail}).",
        "available": "The {year} Supplement is published at {url} and verified: {heading}, prepared under the direction of the Legislative Commissioners' Office.",
    }
    print(messages[result["status"]].format(**{"detail": "", "heading": "", **result}))
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    if args.github_output:
        with args.github_output.open("a", encoding="utf-8") as handle:
            for key in ("status", "year", "url"):
                handle.write(f"{key}={result[key]}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
