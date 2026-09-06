#!/usr/bin/env python3
"""Repository guardrails for secret publication and sensitive content."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path
import re


REPO_ROOT = Path(__file__).resolve().parents[2]

SENSITIVE_BASENAMES = {
    "secret",
    "wallet",
    "mnemonic",
    "seed",
    "recovery",
    "private",
    ".env",
}

SENSITIVE_PATH_PATTERNS = [
    re.compile(r"(^|/)\.env(\.|$)", re.IGNORECASE),
    re.compile(r"(^|/)frost(?:_state)?/", re.IGNORECASE),
    re.compile(r"(^|/)frost[-_]?(?:a|b)[-_]?", re.IGNORECASE),
    re.compile(r"(^|/)id_.*\.json$", re.IGNORECASE),
    re.compile(r"(^|/)wallet.*\.json$", re.IGNORECASE),
]

SENSITIVE_EXTENSIONS = {".pem", ".p12", ".pfx", ".jks", ".key", ".secret", ".seed"}

SECRET_TOKEN_PATTERNS = [
    re.compile(r"(?i)\bBEGIN [A-Z ]+ PRIVATE KEY\b"),
    re.compile(r"\b-----END [A-Z ]+ PRIVATE KEY-----"),
    re.compile(r"\b(?:ed|x?)25519[-_ ]?(?:private|secret) key\b", re.IGNORECASE),
    re.compile(r"\b(?:mnemonic|seed phrase)\b", re.IGNORECASE),
    re.compile(r"(?i)\b(?:api|bearer|auth|access)[-_ ]?(?:token|key)\b\s*[:=]\s*['\"]?[A-Za-z0-9]{24,}"),
]


def tracked_files() -> list[Path]:
    out = subprocess.check_output(["git", "ls-files"], cwd=REPO_ROOT, text=True)
    return [REPO_ROOT / path for path in out.splitlines() if path.strip()]


def check_file_for_secrets(path: Path) -> list[str]:
    findings: list[str] = []
    rel = path.relative_to(REPO_ROOT).as_posix()
    lower = rel.lower()
    basename = path.name.lower()

    if path.suffix.lower() in SENSITIVE_EXTENSIONS:
        findings.append(f"sensitive extension: {rel}")

    if any(name in lower for name in [".secret", ".wallet", ".mnemonic", ".seed", "recovery"]):
        findings.append(f"sensitive filename: {rel}")

    if basename in SENSITIVE_BASENAMES:
        findings.append(f"sensitive filename: {rel}")

    for pattern in SENSITIVE_PATH_PATTERNS:
        if pattern.search(lower):
            findings.append(f"sensitive path pattern: {rel}")

    if path.suffix.lower() in {".json", ".yml", ".yaml", ".toml", ".env", ".ini", ".cfg"}:
        try:
            content = path.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            return findings
        for pattern in SECRET_TOKEN_PATTERNS:
            if pattern.search(content):
                findings.append(f"secret-like value in file: {rel}")
                break
    return findings


def main() -> int:
    failures: list[str] = []
    for path in tracked_files():
        violations = check_file_for_secrets(path)
        for issue in violations:
            failures.append(issue)

    if failures:
        print("Guardrail check failed. Potential secret/publication risks detected:")
        for item in failures:
            print(f"- {item}")
        return 1

    print("Guardrail check passed. No obvious secret/publication risks found in tracked files.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
