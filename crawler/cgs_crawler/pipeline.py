from __future__ import annotations

import json
import os
import shutil
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Set

from .config import CrawlConfig
from .fetch import Fetcher
from .parsing import (
    attach_section_content,
    extract_chapter_links,
    extract_section_links,
    extract_title_links,
    normalize_title_key,
)
from .snapshots import SnapshotStore


def _timestamp(value: Optional[str]) -> str:
    if value:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return parsed.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _write_json(root: Path, name: str, value: object) -> None:
    target = root / name
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")


def _empty_content() -> Dict[str, object]:
    return {"body_paragraphs": [], "source": [], "history": [], "annotations": [], "text": ""}


def _source(config: CrawlConfig, generated_at: str) -> Dict[str, object]:
    source: Dict[str, object] = {
        "kind": config.edition,
        "titles_url": config.titles_url,
        "generated_at_utc": generated_at,
        "user_agent": config.fetch.user_agent,
    }
    if config.edition == "supplement":
        source["supplement_year"] = config.supplement_year
    return source


def _validate(index: Dict[str, object], stage: Path, config: CrawlConfig) -> Dict[str, int]:
    entries = index.get("titles") or []
    if not entries:
        raise RuntimeError("Crawl produced no titles")
    title_keys = [entry.get("title_key") for entry in entries]
    if len(title_keys) != len(set(title_keys)):
        raise RuntimeError("Crawl produced duplicate title keys")
    requested = set(config.only_titles)
    if requested and set(title_keys) != requested:
        raise RuntimeError(f"Crawled title set {set(title_keys)} does not match requested titles {requested}")
    chapter_count = 0
    section_count = 0
    for entry in entries:
        filename = str(entry.get("file") or "")
        if Path(filename).name != filename or not filename:
            raise RuntimeError(f"Unsafe title filename: {filename!r}")
        with (stage / filename).open(encoding="utf-8") as handle:
            title = json.load(handle)
        if title.get("title_key") != entry.get("title_key"):
            raise RuntimeError(f"{filename} title key differs from its index")
        chapter_keys: Set[str] = set()
        for chapter in title.get("chapters") or []:
            chapter_count += 1
            chapter_key = chapter.get("chapter_key")
            if not chapter_key or chapter_key in chapter_keys:
                raise RuntimeError(f"{filename} has missing or duplicate chapter key {chapter_key!r}")
            chapter_keys.add(chapter_key)
            sections = chapter.get("sections") or []
            if not sections:
                raise RuntimeError(f"{filename} chapter {chapter_key} contains no sections")
            section_ids: Set[str] = set()
            for section in sections:
                section_count += 1
                identity = section.get("section_key") or "|".join(section.get("section_keys") or [])
                if not identity or identity in section_ids:
                    raise RuntimeError(f"{filename} chapter {chapter_key} has missing or duplicate provision {identity!r}")
                section_ids.add(identity)
                content = section.get("content")
                required = {"body_paragraphs", "source", "history", "annotations", "text"}
                if not isinstance(content, dict) or not required.issubset(content):
                    raise RuntimeError(f"{filename} chapter {chapter_key} provision {identity} has incomplete content")
    if config.edition == "current" and not requested:
        if not 60 <= len(entries) <= 110:
            raise RuntimeError(f"Implausible full-crawl title count: {len(entries)}")
        if not 900 <= chapter_count <= 1400:
            raise RuntimeError(f"Implausible full-crawl chapter count: {chapter_count}")
        if not 24000 <= section_count <= 40000:
            raise RuntimeError(f"Implausible full-crawl provision count: {section_count}")
    return {"titles": len(entries), "chapters": chapter_count, "sections": section_count}


def _publish_directory(stage: Path, target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    backup = target.with_name(f".{target.name}.backup-{os.getpid()}")
    if backup.exists():
        shutil.rmtree(backup)
    had_target = target.exists()
    try:
        if had_target:
            os.replace(target, backup)
        os.replace(stage, target)
        if backup.exists():
            shutil.rmtree(backup)
    except Exception as error:
        if target.exists() and not had_target:
            shutil.rmtree(target)
        if backup.exists():
            if target.exists():
                shutil.rmtree(target)
            os.replace(backup, target)
        raise RuntimeError(f"Crawler publish failed and was rolled back: {error}") from error


def crawl(config: CrawlConfig, *, fetcher: Optional[Fetcher] = None) -> Dict[str, object]:
    output = Path(config.output_dir).resolve()
    snapshot_root = Path(config.snapshot_dir).resolve()
    if output == Path(output.anchor) or output == Path.cwd().resolve():
        raise ValueError(f"Refusing unsafe crawler output directory: {output}")
    if snapshot_root == output or snapshot_root.is_relative_to(output):
        raise ValueError("Snapshot directory must be outside the transactional output directory")
    output.parent.mkdir(parents=True, exist_ok=True)
    snapshots = SnapshotStore(snapshot_root)
    fetcher = fetcher or Fetcher(config.fetch, snapshots, offline=config.offline)
    generated_at = _timestamp(config.generated_at)
    only_titles = {normalize_title_key(value) for value in config.only_titles}
    stage = Path(tempfile.mkdtemp(prefix=f".{output.name}.crawl-", dir=output.parent))
    index: Dict[str, object] = {"source": _source(config, generated_at), "titles": []}
    supplement_sections: Dict[str, Dict[str, object]] = {}
    supplement_chapters: Dict[str, Dict[str, str]] = {}
    try:
        titles = extract_title_links(fetcher.fetch(config.titles_url), config.titles_url)
        if only_titles:
            titles = [title for title in titles if title[0] in only_titles]
            missing = only_titles - {title[0] for title in titles}
            if missing:
                raise RuntimeError(f"Requested title keys were not found: {', '.join(sorted(missing))}")
        for position, (title_key, label, name, url) in enumerate(titles, 1):
            print(f"Processing {label} ({position}/{len(titles)})")
            title_file = f"title_{title_key}.json"
            title: Dict[str, object] = {
                "title_key": title_key,
                "label": label,
                "name": name,
                "url": url,
                "chapters": [],
            }
            if config.edition == "supplement":
                title["supplement_year"] = config.supplement_year
            for chapter_key, chapter_label, chapter_name, chapter_url in extract_chapter_links(fetcher.fetch(url), url):
                chapter: Dict[str, object] = {
                    "chapter_key": chapter_key,
                    "label": chapter_label,
                    "name": chapter_name,
                    "url": chapter_url,
                    "sections": [],
                }
                chapter_html = fetcher.fetch(chapter_url)
                sections = extract_section_links(chapter_html, chapter_url, expected_title_key=title_key)
                attach_section_content(chapter_html, sections)
                chapter["sections"] = sections
                title["chapters"].append(chapter)
                if config.edition == "supplement":
                    if chapter_key in supplement_chapters:
                        raise RuntimeError(f"Duplicate supplement chapter key {chapter_key}")
                    supplement_chapters[chapter_key] = {"t": title_key}
                    for section in sections:
                        keys = section.get("section_keys") or [section.get("section_key")]
                        for key in filter(None, keys):
                            if key in supplement_sections:
                                raise RuntimeError(f"Duplicate supplement section key {key}")
                            value: Dict[str, object] = {
                                "t": title_key,
                                "c": chapter_key,
                                "l": section.get("label") or f"Sec. {key}",
                                "f": title_file,
                            }
                            status = section.get("content", {}).get("status")
                            if status:
                                value["status"] = status
                            supplement_sections[key] = value
            _write_json(stage, title_file, title)
            index["titles"].append({
                "title_key": title_key,
                "label": label,
                "name": name,
                "url": url,
                "file": title_file,
            })
        _write_json(stage, "titles_index.json", index)
        if config.edition == "supplement":
            _write_json(stage, "supplement_index.json", index)
            _write_json(stage, "supplement_map.json", {
                "source": index["source"],
                "titles": [entry["title_key"] for entry in index["titles"]],
                "chapters": supplement_chapters,
                "sections": supplement_sections,
            })
        counts = _validate(index, stage, config)
        _publish_directory(stage, output)
        return {"generatedAt": generated_at, "counts": counts, "snapshots": snapshots.count, "outputDir": str(output)}
    except Exception:
        if stage.exists():
            shutil.rmtree(stage)
        raise
