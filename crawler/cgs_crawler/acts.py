"""Acquire the General Assembly's list of Public and Special Acts.

The CGA page lists only the current session's acts and empties when a new
session begins, long before LCO folds the prior session into the statutes.
Publishing therefore keeps previously published sessions until a reviewer
retires them, and refuses to drop an act that disappears from the page.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Iterable, List, Optional
from urllib.parse import urljoin

from bs4 import BeautifulSoup

from .config import FetchPolicy
from .fetch import Fetcher
from .snapshots import SnapshotStore

ACTS_URL = "https://www.cga.ct.gov/asp/CGATodayFileCopies/CGAAllPA.asp"
SCHEMA_VERSION = "1.0.0"
SESSION_PATTERN = re.compile(r"^((?:19|20)\d\d)\s+(.*\bSession)$", re.IGNORECASE)
ACT_PATTERN = re.compile(r"^(Public|Special)\s+Act\s+No\.\s*(\d+)$", re.IGNORECASE)
BILL_PATTERN = re.compile(r"^(HB|SB)0*(\d+)$", re.IGNORECASE)


def clean_text(value: str) -> str:
    return re.sub(r"\s+", " ", value.replace("\xa0", " ")).strip()


def session_identity(heading: str):
    match = SESSION_PATTERN.match(clean_text(heading))
    if not match:
        return None
    year = int(match.group(1))
    name = f"{year} {match.group(2)}"
    slug = re.sub(r"[^a-z0-9]+", "-", match.group(2).lower().removesuffix("session")).strip("-")
    return {"id": f"{year}-{slug or 'session'}", "year": year, "name": name}


def parse_act_row(cells, session, source_url: str):
    bill_link = cells[0].find("a")
    act_link = cells[2].find("a")
    if not bill_link or not act_link:
        raise ValueError(f"{session['name']}: act row is missing its bill or act link")
    bill = BILL_PATTERN.match(clean_text(bill_link.get_text()))
    act = ACT_PATTERN.match(clean_text(act_link.get_text()))
    if not bill or not act:
        raise ValueError(f"{session['name']}: unrecognized act row {clean_text(cells[0].get_text())!r}")
    kind = act.group(1).lower()
    number = int(act.group(2))
    title = clean_text(cells[1].get_text())
    if not title:
        raise ValueError(f"{session['name']}: {kind} act {number} has no title")
    citation = f"{'P.A.' if kind == 'public' else 'S.A.'} {session['year'] % 100:02d}-{number}"
    if not session["id"].endswith("-regular"):
        # Special sessions number their acts separately, e.g. "P.A. 21-2 (June Sp. Sess.)".
        label = session["name"].split(" ", 1)[1].replace("Special Session", "Sp. Sess.")
        citation += f" ({label})"
    return {
        "id": f"{'pa' if kind == 'public' else 'sa'}-{session['id']}-{number}",
        "type": kind,
        "number": number,
        "citation": citation,
        "title": title,
        "bill": f"{bill.group(1).upper()} {int(bill.group(2))}",
        "billUrl": urljoin(source_url, bill_link["href"]),
        "url": urljoin(source_url, act_link["href"]),
    }


def act_sort_key(act):
    return (act["type"] != "public", act["number"])


def parse_acts_page(html: str, source_url: str = ACTS_URL) -> List[dict]:
    """Return each session's acts. Sessions without acts are omitted."""
    soup = BeautifulSoup(html, "html.parser")
    if not soup.find(string=re.compile(r"Public and Special Acts", re.IGNORECASE)):
        raise ValueError("The page does not look like the CGA Public and Special Acts list")
    sessions = []
    seen_sessions = set()
    for table in soup.find_all("table"):
        heading = table.find_previous(["h2", "h3", "h4"])
        session = session_identity(heading.get_text()) if heading else None
        if not session:
            raise ValueError("An acts table is not preceded by a recognizable session heading")
        if session["id"] in seen_sessions:
            raise ValueError(f"{session['name']} appears more than once")
        seen_sessions.add(session["id"])
        acts = []
        for row in table.find_all("tr"):
            cells = row.find_all("td")
            if len(cells) < 3:
                continue  # Header rows and the "no acts yet" placeholder.
            acts.append(parse_act_row(cells, session, source_url))
        ids = [act["id"] for act in acts]
        if len(ids) != len(set(ids)):
            raise ValueError(f"{session['name']} lists an act more than once")
        if acts:
            sessions.append({"session": session, "acts": sorted(acts, key=act_sort_key)})
    return sessions


def iso_timestamp(value: Optional[str] = None) -> str:
    if value:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    else:
        parsed = datetime.now(timezone.utc)
    return parsed.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def json_bytes(value) -> bytes:
    return (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


def read_published(directory: Path) -> Dict[str, dict]:
    """Read previously published sessions, verifying each recorded digest."""
    manifest_path = directory / "manifest.json"
    if not manifest_path.is_file():
        return {}
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    published = {}
    for entry in manifest.get("sessions", []):
        content = (directory / entry["path"]).read_bytes()
        if hashlib.sha256(content).hexdigest() != entry["sha256"]:
            raise RuntimeError(f"Published acts file failed its integrity check: {entry['path']}")
        value = json.loads(content)
        published[entry["id"]] = {"session": value["session"], "acts": value["acts"], "updatedAt": entry["updatedAt"]}
    return published


def merge_sessions(
    parsed: Iterable[dict],
    published: Dict[str, dict],
    *,
    retrieved_at: str,
    retire: Iterable[str] = (),
    allow_removals: bool = False,
) -> List[dict]:
    retire = set(retire)
    unknown = retire - set(published) - {entry["session"]["id"] for entry in parsed}
    if unknown:
        raise ValueError(f"Cannot retire unknown session(s): {', '.join(sorted(unknown))}")
    merged = {key: value for key, value in published.items() if key not in retire}
    for entry in parsed:
        session_id = entry["session"]["id"]
        if session_id in retire:
            continue
        previous = merged.get(session_id)
        if previous:
            missing = {act["id"] for act in previous["acts"]} - {act["id"] for act in entry["acts"]}
            if missing and not allow_removals:
                raise ValueError(
                    f"{entry['session']['name']} no longer lists {len(missing)} published act(s) "
                    f"({', '.join(sorted(missing)[:5])}); rerun with --allow-removals after review"
                )
            if previous["acts"] == entry["acts"] and previous["session"] == entry["session"]:
                continue
        merged[session_id] = {**entry, "updatedAt": retrieved_at}
    return sorted(merged.values(), key=lambda value: (-value["session"]["year"], value["session"]["id"]))


def counts_for(acts: List[dict]) -> dict:
    public = sum(1 for act in acts if act["type"] == "public")
    return {"acts": len(acts), "publicActs": public, "specialActs": len(acts) - public}


def write_published(sessions: List[dict], output_dir: Path, source_url: str = ACTS_URL) -> dict:
    output_dir.mkdir(parents=True, exist_ok=True)
    entries = []
    artifacts = []
    for value in sessions:
        session = value["session"]
        relative = f"{session['id']}.json"
        content = json_bytes({"schemaVersion": SCHEMA_VERSION, "session": session, "acts": value["acts"]})
        (output_dir / relative).write_bytes(content)
        identity = {"path": relative, "bytes": len(content), "sha256": hashlib.sha256(content).hexdigest()}
        artifacts.append(identity)
        entries.append({**session, "updatedAt": value["updatedAt"], **identity, "counts": counts_for(value["acts"])})
    for stale in output_dir.glob("*.json"):
        if stale.name != "manifest.json" and stale.name not in {artifact["path"] for artifact in artifacts}:
            stale.unlink()
    all_acts = [act for value in sessions for act in value["acts"]]
    manifest = {
        "schemaVersion": SCHEMA_VERSION,
        "generatedAt": max((value["updatedAt"] for value in sessions), default=iso_timestamp()),
        "source": {
            "publisher": "Connecticut General Assembly",
            "name": "Public and Special Acts",
            "url": source_url,
        },
        "counts": {"sessions": len(sessions), **counts_for(all_acts)},
        "sessions": entries,
        "artifacts": artifacts,
    }
    (output_dir / "manifest.json").write_bytes(json_bytes(manifest))
    return manifest


def parser() -> argparse.ArgumentParser:
    value = argparse.ArgumentParser(description="Acquire the CGA list of Public and Special Acts into static app data.")
    value.add_argument("--output", type=Path, default=Path("public/data/acts"))
    value.add_argument("--previous", type=Path, help="published acts to retain (defaults to --output)")
    value.add_argument("--snapshots", type=Path, default=Path(".crawl/acts-snapshots"))
    value.add_argument("--html", type=Path, help="parse a saved copy of the page instead of fetching it")
    value.add_argument("--retrieved-at", help="ISO-8601 timestamp recorded for changed sessions")
    value.add_argument("--retire", action="append", default=[], help="drop a published session id, such as 2025-regular")
    value.add_argument("--allow-removals", action="store_true", help="accept acts that no longer appear on the page")
    value.add_argument("--no-ssl-verify", action="store_true")
    return value


def main() -> None:
    args = parser().parse_args()
    if args.html:
        html = args.html.read_text(encoding="utf-8")
    else:
        if not args.no_ssl_verify:
            try:
                import truststore
                truststore.inject_into_ssl()
            except ImportError:
                pass
        fetcher = Fetcher(FetchPolicy(delay=0, jitter=0, verify_ssl=not args.no_ssl_verify), SnapshotStore(args.snapshots))
        html = fetcher.fetch(ACTS_URL)
    parsed = parse_acts_page(html)
    sessions = merge_sessions(
        parsed,
        read_published(args.previous or args.output),
        retrieved_at=iso_timestamp(args.retrieved_at),
        retire=args.retire,
        allow_removals=args.allow_removals,
    )
    manifest = write_published(sessions, args.output)
    found = ", ".join(f"{entry['session']['name']} ({len(entry['acts'])})" for entry in parsed) or "no acts"
    print(f"Page lists {found}; published {manifest['counts']['acts']} acts across {manifest['counts']['sessions']} session(s) to {args.output}")


if __name__ == "__main__":
    main()
