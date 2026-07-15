from __future__ import annotations

import hashlib
import json
import os
import re
import tempfile
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Iterable, Optional
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup

from . import SCHEMA_VERSION

INDEX_PAGE_URL = "https://www.cga.ct.gov/lco/statutes-index.asp"
INFRACTIONS_URL = "https://jud.ct.gov/webforms/forms/infractions.pdf"
INFRACTIONS_FALLBACK_URLS = ("https://www.jud.ct.gov/webforms/forms/infractions.pdf",)
INDEX_NAMES = ("Index A-H.pdf", "Index I-S.pdf", "Index T-Z.pdf")
USER_AGENT = "CGSPagesSecondarySources/1.0 (+https://github.com/UConn-Law-Library/CGS)"


@dataclass(frozen=True)
class CapturedPdf:
    url: str
    name: str
    sha256: str
    bytes: int
    captured_at: str
    path: Path


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def discover_index_sources(html: str, page_url: str = INDEX_PAGE_URL):
    soup = BeautifulSoup(html, "html.parser")
    wanted = {name.lower(): name for name in INDEX_NAMES}
    urls: Dict[str, str] = {}
    for anchor in soup.find_all("a", href=True):
        href = anchor["href"]
        basename = href.rsplit("/", 1)[-1].replace("%20", " ").lower()
        if basename in wanted:
            urls[wanted[basename]] = urljoin(page_url, href)
    missing = [name for name in INDEX_NAMES if name not in urls]
    if missing:
        raise RuntimeError(f"LCO index page is missing expected PDFs: {', '.join(missing)}")
    visible = " ".join(soup.stripped_strings)
    match = re.search(r"REVISION OF 1958,\s*REVISED TO\s+([^.]*)", visible, re.IGNORECASE)
    revision = f"Revision of 1958, revised to {match.group(1).strip()}" if match else None
    return urls, revision


class PdfSnapshotStore:
    """Content-addressed PDF captures with a deterministic URL manifest."""

    def __init__(self, root: Path):
        self.root = Path(root)
        self.files = self.root / "files"
        self.manifest_path = self.root / "manifest.json"
        self.files.mkdir(parents=True, exist_ok=True)
        self._manifest = self._read_manifest()

    def _read_manifest(self):
        if not self.manifest_path.exists():
            return {"schemaVersion": SCHEMA_VERSION, "sources": {}}
        value = json.loads(self.manifest_path.read_text(encoding="utf-8"))
        if value.get("schemaVersion") != SCHEMA_VERSION or not isinstance(value.get("sources"), dict):
            raise RuntimeError(f"Unsupported PDF snapshot manifest: {self.manifest_path}")
        return value

    def capture(self, url: str, name: str, content: bytes, captured_at: str) -> CapturedPdf:
        if not content.startswith(b"%PDF-"):
            raise ValueError(f"Expected PDF bytes from {url}")
        digest = hashlib.sha256(content).hexdigest()
        target = self.files / f"{digest}.pdf"
        if not target.exists():
            self._atomic_write(target, content)
        self._manifest["sources"][url] = {
            "name": name,
            "sha256": digest,
            "bytes": len(content),
            "capturedAt": captured_at,
            "path": f"files/{digest}.pdf",
        }
        self._manifest["sources"] = dict(sorted(self._manifest["sources"].items()))
        serialized = (json.dumps(self._manifest, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
        self._atomic_write(self.manifest_path, serialized)
        return CapturedPdf(url, name, digest, len(content), captured_at, target)

    def set_index_revision(self, revision: Optional[str]):
        if revision:
            self._manifest["indexRevision"] = revision
            serialized = (json.dumps(self._manifest, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
            self._atomic_write(self.manifest_path, serialized)

    def resolve(self, url: str) -> Optional[CapturedPdf]:
        entry = self._manifest["sources"].get(url)
        if not entry:
            return None
        target = self.root / entry["path"]
        content = target.read_bytes()
        digest = hashlib.sha256(content).hexdigest()
        if digest != entry["sha256"] or len(content) != entry["bytes"]:
            raise RuntimeError(f"PDF snapshot integrity check failed: {target}")
        return CapturedPdf(url, entry["name"], digest, len(content), entry["capturedAt"], target)

    @staticmethod
    def _atomic_write(path: Path, content: bytes):
        path.parent.mkdir(parents=True, exist_ok=True)
        descriptor, temporary = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
        try:
            with os.fdopen(descriptor, "wb") as handle:
                handle.write(content)
            os.replace(temporary, path)
        finally:
            if os.path.exists(temporary):
                os.remove(temporary)


class PdfAcquirer:
    def __init__(
        self,
        store: PdfSnapshotStore,
        session: Optional[requests.Session] = None,
        verify_ssl=True,
        cga_verify_ssl=None,
        max_attempts=5,
        sleeper=time.sleep,
    ):
        self.store = store
        self.session = session or requests.Session()
        self.verify_ssl = verify_ssl
        self.cga_verify_ssl = verify_ssl if cga_verify_ssl is None else cga_verify_ssl
        self.max_attempts = max_attempts
        self.sleeper = sleeper
        self.session.headers.update({"User-Agent": USER_AGENT})

    def _get(self, url: str, verify_ssl):
        for attempt in range(self.max_attempts):
            try:
                response = self.session.get(url, timeout=60, verify=verify_ssl)
                response.raise_for_status()
                return response
            except requests.RequestException:
                if attempt + 1 == self.max_attempts:
                    raise
                self.sleeper(2 ** attempt)

    def get_bytes(self, url: str, verify_ssl=None) -> bytes:
        response = self._get(url, self.verify_ssl if verify_ssl is None else verify_ssl)
        content_type = (response.headers.get("Content-Type") or "").lower()
        if content_type and "pdf" not in content_type and "octet-stream" not in content_type:
            raise ValueError(f"Expected PDF from {url}, received {content_type!r}")
        if not response.content.startswith(b"%PDF-"):
            raise ValueError(f"Expected PDF bytes from {url}")
        return response.content

    def capture_url(self, url: str, name: str, captured_at: Optional[str] = None, verify_ssl=None):
        return self.store.capture(url, name, self.get_bytes(url, verify_ssl), captured_at or utc_now())

    def capture_first_available(
        self,
        urls: Iterable[str],
        name: str,
        captured_at: Optional[str] = None,
        verify_ssl=None,
    ):
        failures = []
        last_error = None
        for url in urls:
            try:
                return self.capture_url(url, name, captured_at, verify_ssl)
            except (requests.RequestException, ValueError) as error:
                failures.append(f"{url}: {error}")
                last_error = error
        raise RuntimeError(
            f"Unable to retrieve {name} from verified official endpoints: {'; '.join(failures)}"
        ) from last_error

    def capture_all(self, captured_at: Optional[str] = None, infractions_file: Optional[Path] = None):
        timestamp = captured_at or utc_now()
        response = self._get(INDEX_PAGE_URL, self.cga_verify_ssl)
        urls, revision = discover_index_sources(response.text)
        self.store.set_index_revision(revision)
        captures = [
            self.capture_url(urls[name], name, timestamp, self.cga_verify_ssl)
            for name in INDEX_NAMES
        ]
        if infractions_file:
            captures.append(self.store.capture(
                INFRACTIONS_URL, "infractions.pdf", Path(infractions_file).read_bytes(), timestamp
            ))
        else:
            captures.append(self.capture_first_available(
                (INFRACTIONS_URL, *INFRACTIONS_FALLBACK_URLS),
                "infractions.pdf",
                timestamp,
                self.verify_ssl,
            ))
        return captures, revision
