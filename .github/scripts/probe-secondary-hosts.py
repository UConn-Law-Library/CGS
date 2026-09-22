import hashlib
import os
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile


curl = str(Path(os.environ["SystemRoot"]) / "System32/curl.exe") if os.name == "nt" else shutil.which("curl")
print(subprocess.run([curl, "--version"], capture_output=True, text=True).stdout, flush=True)
agent = "CGSPagesSecondarySources/1.0 (+https://github.com/UConn-Law-Library/CGS)"
browser_agent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"
variants = [
    ("default", []),
    ("TLS 1.2", ["--tlsv1.2", "--tls-max", "1.2"]),
    ("IPv4 HTTP/1.1 TLS 1.2", ["--ipv4", "--http1.1", "--tlsv1.2", "--tls-max", "1.2"]),
    ("browser user agent", ["--user-agent", browser_agent]),
]
success = False
for host in ["jud.ct.gov", "www.jud.ct.gov"]:
    print(f"DNS {host}: {sorted({record[4][0] for record in socket.getaddrinfo(host, 443)})}", flush=True)
    for name, options in variants:
        with tempfile.TemporaryDirectory() as temporary:
            target = Path(temporary) / "source.pdf"
            command = [
                curl, "--disable", "--verbose", "--fail", "--location", "--proto", "=https",
                "--proto-redir", "=https", "--max-time", "20", "--connect-timeout", "10",
                "--user-agent", agent, "--output", str(target),
                "--write-out", "HTTP=%{http_code} REMOTE=%{remote_ip} VERIFY=%{ssl_verify_result} TYPE=%{content_type}",
                *options, f"https://{host}/webforms/forms/infractions.pdf",
            ]
            result = subprocess.run(command, capture_output=True, text=True, timeout=30)
            content = target.read_bytes() if target.exists() else b""
            pdf = content.startswith(b"%PDF-") and result.returncode == 0
            print(f"PROBE {host} [{name}] exit={result.returncode} {result.stdout} pdf={pdf} bytes={len(content)}", flush=True)
            print(result.stderr[-2400:], flush=True)
            if pdf:
                print(f"SHA256 {hashlib.sha256(content).hexdigest()}", flush=True)
                success = True
                break
raise SystemExit(0 if success else 1)
