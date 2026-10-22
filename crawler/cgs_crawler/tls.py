"""Verified CGA transport, including its published missing intermediate certificate."""
from __future__ import annotations

import argparse
import hashlib
import os
import ssl
from pathlib import Path

import certifi

INTERMEDIATE_SHA256 = "973a41276ffd01e027a2aad49e34c37846d3e976ff6a620b6712e33832041aa6"
INTERMEDIATE = Path(__file__).resolve().parents[2] / "config" / "certs" / "gdig2.crt.pem"


def prepare_ca_bundle(output: Path, intermediate: Path = INTERMEDIATE) -> Path:
    pem = intermediate.read_text(encoding="ascii")
    digest = hashlib.sha256(ssl.PEM_cert_to_DER_cert(pem)).hexdigest()
    if digest != INTERMEDIATE_SHA256:
        raise ValueError("CGA intermediate certificate does not match the reviewed fingerprint")
    content = Path(certifi.where()).read_bytes().rstrip() + b"\n" + pem.encode("ascii")
    output = Path(output).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(content)
    # Parsing and verification remain enabled; no permissive SSL context is created.
    ssl.create_default_context(cafile=str(output))
    return output


def tls_verification(ca_bundle=None, *, insecure=False):
    if insecure:
        if os.environ.get("GITHUB_ACTIONS") == "true" or os.environ.get("CI") == "true":
            raise ValueError("Certificate verification cannot be disabled in CI")
        if ca_bundle or os.environ.get("CGS_CA_BUNDLE"):
            raise ValueError("Choose a CA bundle or the local insecure override, not both")
        return False
    bundle = ca_bundle or os.environ.get("CGS_CA_BUNDLE")
    if not bundle:
        return True
    resolved = Path(bundle).resolve(strict=True)
    ssl.create_default_context(cafile=str(resolved))
    return str(resolved)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Build the reviewed CGA CA bundle without network access")
    parser.add_argument("--output", type=Path, default=Path(".crawl/ca-bundle.pem"))
    print(prepare_ca_bundle(parser.parse_args().output))
