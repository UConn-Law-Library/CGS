from __future__ import annotations

import hashlib
import json
import os
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Optional


@dataclass(frozen=True)
class Snapshot:
    url: str
    sha256: str
    bytes: int
    content_type: str
    encoding: str
    captured_at: str


class SnapshotStore:
    """Content-addressed raw HTML with a URL lookup manifest."""

    def __init__(self, root: Path):
        self.root = Path(root)
        self.pages = self.root / "pages"
        self.manifest_path = self.root / "manifest.json"
        self.root.mkdir(parents=True, exist_ok=True)
        self.pages.mkdir(parents=True, exist_ok=True)
        self._manifest: Dict[str, object] = self._read_manifest()

    def _read_manifest(self) -> Dict[str, object]:
        if not self.manifest_path.exists():
            return {"schemaVersion": "1.0.0", "pages": {}}
        with self.manifest_path.open(encoding="utf-8") as handle:
            value = json.load(handle)
        if value.get("schemaVersion") != "1.0.0" or not isinstance(value.get("pages"), dict):
            raise RuntimeError(f"Unsupported snapshot manifest: {self.manifest_path}")
        return value

    @property
    def count(self) -> int:
        return len(self._manifest["pages"])

    def get(self, url: str) -> Optional[str]:
        entry = self._manifest["pages"].get(url)
        if not entry:
            return None
        file = self.pages / f"{entry['sha256']}.html"
        if not file.is_file():
            raise RuntimeError(f"Snapshot manifest points to missing content: {file}")
        content = file.read_bytes()
        digest = hashlib.sha256(content).hexdigest()
        if digest != entry["sha256"] or len(content) != entry["bytes"]:
            raise RuntimeError(f"Snapshot integrity check failed: {file}")
        return content.decode(entry.get("encoding") or "utf-8")

    def put(
        self,
        url: str,
        html: object,
        *,
        content_type: str,
        encoding: str,
        captured_at: str,
    ) -> Snapshot:
        if isinstance(html, bytes):
            content = html
        elif isinstance(html, str):
            content = html.encode(encoding)
        else:
            raise TypeError("snapshot content must be text or bytes")
        digest = hashlib.sha256(content).hexdigest()
        target = self.pages / f"{digest}.html"
        if not target.exists():
            self._atomic_write(target, content, binary=True)
        entry = {
            "sha256": digest,
            "bytes": len(content),
            "contentType": content_type,
            "encoding": encoding,
            "capturedAt": captured_at,
        }
        self._manifest["pages"][url] = entry
        ordered = dict(sorted(self._manifest["pages"].items()))
        self._manifest["pages"] = ordered
        serialized = (json.dumps(self._manifest, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
        self._atomic_write(self.manifest_path, serialized, binary=True)
        return Snapshot(
            url=url,
            sha256=digest,
            bytes=len(content),
            content_type=content_type,
            encoding=encoding,
            captured_at=captured_at,
        )

    @staticmethod
    def _atomic_write(path: Path, value: bytes, *, binary: bool) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        mode = "wb" if binary else "w"
        fd, temporary = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
        try:
            with os.fdopen(fd, mode) as handle:
                handle.write(value)
            os.replace(temporary, path)
        finally:
            if os.path.exists(temporary):
                os.remove(temporary)
