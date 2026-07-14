from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
from collections import defaultdict
from concurrent.futures import ProcessPoolExecutor
from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path

import pdfplumber

from . import SCHEMA_VERSION
from .infractions_parser import parse_chart_b, parse_schedule, polish_entries
from .statutes_index_parser import parse_file

INFRACTIONS_URL = "https://www.jud.ct.gov/webforms/forms/infractions.pdf"
INDEX_URL = "https://www.cga.ct.gov/lco/statutes-index.asp"
MAX_INDEX_SHARD_BYTES = 2_000_000


def iso_timestamp(value=None):
    raw = value or os.environ.get("SOURCE_DATE_EPOCH")
    if raw and str(raw).isdigit():
        moment = datetime.fromtimestamp(int(raw), timezone.utc)
    elif raw:
        moment = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
    else:
        moment = datetime.now(timezone.utc)
    return moment.astimezone(timezone.utc).isoformat().replace("+00:00", "Z").replace(".000000Z", "Z")


def digest_bytes(content: bytes):
    return hashlib.sha256(content).hexdigest()


def file_identity(path: Path, source_url: str):
    content = Path(path).read_bytes()
    if not content.startswith(b"%PDF-"):
        raise ValueError(f"Not a PDF: {path}")
    return {
        "name": Path(path).name,
        "url": source_url,
        "bytes": len(content),
        "sha256": digest_bytes(content),
    }


def stable_id(prefix: str, *parts):
    digest = hashlib.sha256("\0".join(str(part) for part in parts).encode("utf-8")).hexdigest()[:16]
    return f"{prefix}-{digest}"


def load_locations(base_data_dir: Path):
    root = Path(base_data_dir)
    catalog = json.loads((root / "catalog.json").read_text(encoding="utf-8"))
    locations = {}
    for title in catalog.get("titles", []):
        for chapter_entry in title.get("chapters", []):
            chapter = json.loads((root / chapter_entry["path"]).read_text(encoding="utf-8"))
            for section in chapter.get("sections", []):
                for citation in section.get("citations", []):
                    locations[citation.lower()] = {
                        "titleId": title["id"],
                        "sectionId": section["id"],
                        "citation": citation,
                        "href": f"#/t/{title['number']}/c/{chapter_entry['number']}/s/{citation}",
                    }
    manifest_bytes = (root / "manifest.json").read_bytes()
    return catalog, locations, digest_bytes(manifest_bytes)


def resolution(display_citation, section_citation, locations):
    target = locations.get((section_citation or "").lower())
    if not target:
        return {"status": "unresolved"}
    normalized_display = str(display_citation or "").lower().rstrip("*")
    status = "exact" if normalized_display == section_citation.lower() else "section-only"
    return {"status": status, "href": target["href"]}


def cents(value):
    return int((Decimal(str(value)) * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def parse_infractions_pdf(path: Path):
    with pdfplumber.open(path) as pdf:
        cover = pdf.pages[0].extract_text() or ""
        match = re.search(r"Effective\s+(\w+\s+\d{1,2},\s+\d{4})", cover)
        entries = parse_schedule(pdf)
        fee_rules, chart_b_revision = parse_chart_b(pdf)
        page_count = len(pdf.pages)
    polish_entries(entries)
    return entries, fee_rules, match.group(1) if match else None, chart_b_revision, page_count


def parse_index_pdfs(paths):
    headings = []
    seen = {}
    page_count = 0
    for path in paths:
        with pdfplumber.open(path) as pdf:
            page_count += len(pdf.pages)
    jobs = [(str(path), None) for path in paths]
    try:
        with ProcessPoolExecutor(max_workers=len(jobs)) as pool:
            parsed = list(pool.map(parse_file, jobs))
    except OSError as error:
        print(f"WARNING: parallel index parsing unavailable ({error}); using deterministic serial parsing")
        parsed = [parse_file(job) for job in jobs]
    for part in parsed:
        for heading in part:
            if heading["h"] in seen:
                seen[heading["h"]]["items"].extend(heading["items"])
            else:
                seen[heading["h"]] = heading
                headings.append(heading)
    return headings, page_count


def canonicalize_infractions(entries, locations):
    result = []
    for entry in entries:
        section_citation = str(entry.get("section_key") or "").lower()
        item = {
            "id": stable_id("infraction", entry.get("stat_no"), entry.get("description")),
            "printedCitation": entry.get("stat_no"),
            "citation": entry.get("citation"),
            "sectionCitation": section_citation,
            "description": entry.get("description"),
            "category": entry.get("category"),
            "subsequent": bool(entry.get("subsequent")),
            "page": int(entry.get("page")),
            "amounts": {name: cents(value) for name, value in sorted((entry.get("amounts") or {}).items())},
            "resolution": resolution(entry.get("citation"), section_citation, locations),
        }
        if entry.get("note"):
            item["note"] = entry["note"]
        result.append(item)
    return result


def canonicalize_fee_rules(rules, locations, revision):
    result = []
    for rule in rules or []:
        authority_citation = rule["authority_citation"]
        section_match = re.match(r"^\d+[a-z]{0,3}-\d+[a-z]{0,3}", authority_citation, re.IGNORECASE)
        section_citation = section_match.group(0).lower()
        references = []
        for reference in rule.get("affected_references", []):
            citation = reference["section_key"].lower()
            references.append({
                "display": reference["display"],
                "sectionCitation": citation,
                "resolution": resolution(reference["display"], citation, locations),
            })
        result.append({
            "id": stable_id("fee-rule", authority_citation),
            "authorityCitation": authority_citation,
            "sectionCitation": section_citation,
            "description": rule.get("description") or "",
            "affectedText": rule.get("affected_text") or "",
            "comments": rule.get("comments") or "",
            "pages": [int(page) for page in rule.get("pages", [])],
            "revision": revision,
            "authorityResolution": resolution(authority_citation, section_citation, locations),
            "affectedReferences": references,
        })
    return result


def canonicalize_index(headings, locations):
    result = []
    for heading_position, heading in enumerate(headings):
        heading_id = stable_id("topic", heading["h"])
        items = []
        for item_position, item in enumerate(heading.get("items", [])):
            references = []
            for pair in item.get("r", []):
                display = pair[0]
                section_citation = pair[1]
                reference = {"display": display}
                if section_citation:
                    reference["sectionCitation"] = section_citation.lower()
                    reference["resolution"] = resolution(display, section_citation, locations)
                else:
                    reference["resolution"] = {"status": "not-applicable"}
                references.append(reference)
            normalized = {
                "id": stable_id("index-entry", heading["h"], item_position, item.get("t")),
                "level": int(item.get("l", 0)),
                "text": item.get("t") or "",
                "references": references,
                "see": [
                    {"heading": pair[0], **({"subheading": pair[1]} if len(pair) > 1 and pair[1] else {})}
                    for pair in item.get("see", [])
                ],
            }
            items.append(normalized)
        result.append({"id": heading_id, "label": heading["h"], "position": heading_position, "items": items})
    return result


def json_bytes(value, compact=False):
    options = {"ensure_ascii": False, "sort_keys": False}
    if compact:
        options["separators"] = (",", ":")
    else:
        options["indent"] = 2
    return (json.dumps(value, **options) + "\n").encode("utf-8")


def write_artifact(root: Path, relative_path: str, value):
    content = json_bytes(value, compact=not relative_path.endswith("manifest.json"))
    target = root.joinpath(*relative_path.split("/"))
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(content)
    return {"path": relative_path, "bytes": len(content), "sha256": digest_bytes(content)}


def shard_key(value):
    match = re.search(r"[a-z0-9]", str(value).lower())
    return match.group(0) if match else "other"


def chunk_topics(topics):
    chunks = []
    current = []
    current_bytes = 0
    for topic in topics:
        topic_bytes = len(json_bytes(topic, compact=True))
        if current and current_bytes + topic_bytes > MAX_INDEX_SHARD_BYTES:
            chunks.append(current)
            current = []
            current_bytes = 0
        current.append(topic)
        current_bytes += topic_bytes
    if current:
        chunks.append(current)
    return chunks


def build_artifacts(
    *,
    output_dir: Path,
    base_data_dir: Path,
    infractions_entries,
    infractions_fee_rules=None,
    infractions_source,
    index_headings,
    index_source,
    generated_at=None,
):
    output = Path(output_dir).resolve()
    base = Path(base_data_dir).resolve()
    if output == base or base.is_relative_to(output):
        raise ValueError("Secondary-source output cannot replace the base corpus")
    timestamp = iso_timestamp(generated_at)
    catalog, locations, base_manifest_sha = load_locations(base)
    infractions = canonicalize_infractions(infractions_entries, locations)
    fee_rules = canonicalize_fee_rules(
        infractions_fee_rules or [], locations, infractions_source.get("chartBRevision")
    )
    topics = canonicalize_index(index_headings, locations)
    staging = output.with_name(f"{output.name}.staging-{os.getpid()}")
    if staging.exists():
        shutil.rmtree(staging)
    staging.mkdir(parents=True)
    artifacts = []

    infraction_shards = defaultdict(list)
    for entry in infractions:
        target = locations.get(entry["sectionCitation"])
        key = target["titleId"] if target else "unresolved"
        infraction_shards[key].append(entry)
    infraction_shard_entries = []
    for key in sorted(infraction_shards):
        relative = f"infractions/{key}.json"
        artifacts.append(write_artifact(staging, relative, {
            "schemaVersion": SCHEMA_VERSION,
            "titleId": None if key == "unresolved" else key,
            "entries": infraction_shards[key],
        }))
        infraction_shard_entries.append({"key": key, "path": f"{key}.json", "entryCount": len(infraction_shards[key])})
    infraction_manifest = {
        "schemaVersion": SCHEMA_VERSION,
        "generatedAt": timestamp,
        "source": infractions_source,
        "counts": {
            "entries": len(infractions),
            "resolved": sum(entry["resolution"]["status"] != "unresolved" for entry in infractions),
            "categories": len({entry["category"] for entry in infractions if entry["category"]}),
            "feeRules": len(fee_rules),
            "feeRuleReferences": sum(len(rule["affectedReferences"]) for rule in fee_rules),
            "feeRuleResolved": sum(
                reference["resolution"]["status"] != "unresolved"
                for rule in fee_rules for reference in rule["affectedReferences"]
            ),
        },
        "shards": infraction_shard_entries,
    }
    artifacts.append(write_artifact(staging, "infractions/manifest.json", infraction_manifest))
    artifacts.append(write_artifact(staging, "infractions/fee-rules.json", {
        "schemaVersion": SCHEMA_VERSION,
        "revision": infractions_source.get("chartBRevision"),
        "rules": fee_rules,
    }))

    topic_shards = defaultdict(list)
    for topic in topics:
        topic_shards[shard_key(topic["label"])].append(topic)
    topic_shard_entries = []
    topic_paths = {}
    for key in sorted(topic_shards):
        chunks = chunk_topics(topic_shards[key])
        for index, chunk in enumerate(chunks, start=1):
            name = f"{key}.json" if len(chunks) == 1 else f"{key}-{index:02d}.json"
            relative = f"statutes-index/{name}"
            artifacts.append(write_artifact(staging, relative, {
                "schemaVersion": SCHEMA_VERSION,
                "letter": key,
                "headings": chunk,
            }))
            for topic in chunk:
                topic_paths[topic["id"]] = relative
            item_count = sum(len(topic["items"]) for topic in chunk)
            topic_shard_entries.append({"key": key, "path": name, "headingCount": len(chunk), "itemCount": item_count})
    all_references = [reference for topic in topics for item in topic["items"] for reference in item["references"]]
    index_manifest = {
        "schemaVersion": SCHEMA_VERSION,
        "generatedAt": timestamp,
        "source": index_source,
        "counts": {
            "headings": len(topics),
            "items": sum(len(topic["items"]) for topic in topics),
            "references": len(all_references),
            "resolved": sum(reference["resolution"]["status"] in {"exact", "section-only"} for reference in all_references),
        },
        "shards": topic_shard_entries,
    }
    artifacts.append(write_artifact(staging, "statutes-index/manifest.json", index_manifest))

    links = defaultdict(lambda: defaultdict(lambda: {"infractions": [], "feeRules": [], "indexEntries": []}))
    for key, entries in infraction_shards.items():
        if key == "unresolved":
            continue
        for entry in entries:
            citation = locations[entry["sectionCitation"]]["citation"]
            links[key][citation]["infractions"].append({"id": entry["id"], "shard": f"infractions/{key}.json"})
    for topic in topics:
        for item in topic["items"]:
            for reference in item["references"]:
                target = locations.get(reference.get("sectionCitation", ""))
                if not target:
                    continue
                links[target["titleId"]][target["citation"]]["indexEntries"].append({
                    "topicId": topic["id"], "entryId": item["id"], "shard": topic_paths[topic["id"]]
                })
    seen_fee_links = set()
    for rule in fee_rules:
        candidates = [(rule["sectionCitation"], "authority", rule["authorityResolution"])]
        candidates.extend(
            (reference["sectionCitation"], "affected", reference["resolution"])
            for reference in rule["affectedReferences"]
        )
        for section_citation, role, resolved in candidates:
            target = locations.get(section_citation)
            key = (rule["id"], section_citation, role)
            if not target or resolved["status"] == "unresolved" or key in seen_fee_links:
                continue
            seen_fee_links.add(key)
            links[target["titleId"]][target["citation"]]["feeRules"].append({
                "id": rule["id"], "role": role, "shard": "infractions/fee-rules.json"
            })
    link_shards = []
    for title_id in sorted(links):
        relative = f"links/{title_id}.json"
        artifacts.append(write_artifact(staging, relative, {
            "schemaVersion": SCHEMA_VERSION,
            "titleId": title_id,
            "sections": dict(sorted(links[title_id].items())),
        }))
        link_shards.append({"titleId": title_id, "path": f"{title_id}.json", "sectionCount": len(links[title_id])})
    artifacts.append(write_artifact(staging, "links/manifest.json", {
        "schemaVersion": SCHEMA_VERSION,
        "generatedAt": timestamp,
        "shards": link_shards,
    }))

    artifacts.sort(key=lambda artifact: artifact["path"])
    manifest = {
        "schemaVersion": SCHEMA_VERSION,
        "generatedAt": timestamp,
        "base": {
            "schemaVersion": catalog["schemaVersion"],
            "generatedAt": catalog["generatedAt"],
            "manifestSha256": base_manifest_sha,
        },
        "counts": {
            "infractions": len(infractions),
            "feeRules": len(fee_rules),
            "indexHeadings": len(topics),
            "indexItems": index_manifest["counts"]["items"],
        },
        "artifacts": artifacts,
    }
    write_artifact(staging, "manifest.json", manifest)
    if output.exists():
        shutil.rmtree(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    os.replace(staging, output)
    return manifest


def import_pdfs(
    *, output_dir, base_data_dir, infractions_pdf, index_pdfs, revision, generated_at=None,
    infractions_url=INFRACTIONS_URL, index_urls=None
):
    index_pdfs = [Path(path) for path in index_pdfs]
    index_urls = list(index_urls or [INDEX_URL] * len(index_pdfs))
    if len(index_urls) != len(index_pdfs):
        raise ValueError("Every index PDF requires a source URL")
    infractions_pdf = Path(infractions_pdf)
    infraction_entries, fee_rules, effective, chart_b_revision, infraction_pages = parse_infractions_pdf(infractions_pdf)
    headings, index_pages = parse_index_pdfs(index_pdfs)
    infractions_source = {
        "name": "Mail-In Violations and Infractions Schedule",
        "publisher": "State of Connecticut Judicial Branch",
        "url": infractions_url,
        "effective": effective,
        "chartBRevision": chart_b_revision,
        "pageCount": infraction_pages,
        "files": [file_identity(infractions_pdf, infractions_url)],
    }
    index_source = {
        "name": "Index to the General Statutes of Connecticut",
        "publisher": "Connecticut General Assembly, Legislative Commissioners' Office",
        "url": INDEX_URL,
        "revision": revision,
        "pageCount": index_pages,
        "files": [file_identity(path, source_url) for path, source_url in zip(index_pdfs, index_urls)],
    }
    return build_artifacts(
        output_dir=Path(output_dir),
        base_data_dir=Path(base_data_dir),
        infractions_entries=infraction_entries,
        infractions_fee_rules=fee_rules,
        infractions_source=infractions_source,
        index_headings=headings,
        index_source=index_source,
        generated_at=generated_at,
    )
