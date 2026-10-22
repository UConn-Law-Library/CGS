"""Resolve the CI Python 3.12 dependency set into a reviewable version lock."""
import json
import subprocess
import sys
from pathlib import Path

report = Path(".crawl/python-lock-report.json")
report.parent.mkdir(parents=True, exist_ok=True)
subprocess.run([
    sys.executable, "-m", "pip", "install", "--dry-run", "--ignore-installed",
    "--report", str(report), "--python-version", "3.12",
    "--platform", "manylinux2014_x86_64", "--only-binary=:all:",
    "-r", "crawler/requirements.txt",
], check=True)
packages = json.loads(report.read_text(encoding="utf-8"))["install"]
Path("crawler/requirements-lock.txt").write_text(
    "# Resolved for Python 3.12; update with scripts/lock-python.py.\n"
    + "".join(f"{item['metadata']['name']}=={item['metadata']['version']}\n"
              for item in sorted(packages, key=lambda item: item["metadata"]["name"].lower())),
    encoding="utf-8",
)
