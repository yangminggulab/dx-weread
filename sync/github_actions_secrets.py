#!/usr/bin/env python3
"""Shared helpers for syncing GitHub Actions repository secrets."""

from __future__ import annotations

import os
import subprocess
import sys
from base64 import b64encode
from pathlib import Path

import requests
from nacl import encoding, public as nacl_public

ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from sync.weread_env import load_dotenv

load_dotenv(ROOT_DIR)


def looks_like_github_token(value: str) -> bool:
    if not value:
        return False
    if any(ord(ch) >= 128 or ch.isspace() for ch in value):
        return False
    prefixes = ("ghp_", "github_pat_", "gho_", "ghu_", "ghs_", "ghr_")
    return value.startswith(prefixes) or len(value) >= 20


def pick_github_token() -> tuple[str, str]:
    for name in ("GH_PAT", "GH_TOKEN", "GITHUB_TOKEN"):
        value = os.environ.get(name, "").strip()
        if looks_like_github_token(value):
            return value, name
    return "", ""


def infer_github_repo(root_dir: Path = ROOT_DIR) -> str:
    try:
        result = subprocess.run(
            ["git", "remote", "get-url", "origin"],
            cwd=root_dir,
            capture_output=True,
            check=True,
            text=True,
        )
    except Exception:
        return ""

    remote = result.stdout.strip()
    if remote.startswith("git@github.com:"):
        repo = remote.split("git@github.com:", 1)[1]
    elif remote.startswith("https://github.com/"):
        repo = remote.split("https://github.com/", 1)[1]
    else:
        return ""

    return repo[:-4] if repo.endswith(".git") else repo


def resolve_github_repo(root_dir: Path = ROOT_DIR) -> str:
    return os.environ.get("GH_REPO", "").strip() or infer_github_repo(root_dir)


def collect_default_secret_values(root_dir: Path = ROOT_DIR) -> tuple[dict[str, str], str]:
    api_key_source = "env.WEREAD_API_KEY" if os.environ.get("WEREAD_API_KEY", "").strip() else "missing"
    values = {
        "API_TOKEN": os.environ.get("API_TOKEN", "").strip(),
        "WEREAD_API_KEY": os.environ.get("WEREAD_API_KEY", "").strip(),
    }
    return values, api_key_source


def encrypt_secret(public_key: str, value: str) -> str:
    key = nacl_public.PublicKey(public_key.encode("utf-8"), encoding.Base64Encoder())
    encrypted = nacl_public.SealedBox(key).encrypt(value.encode("utf-8"))
    return b64encode(encrypted).decode("utf-8")


def build_session(token: str) -> requests.Session:
    session = requests.Session()
    session.headers.update(
        {
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {token}",
            "X-GitHub-Api-Version": "2022-11-28",
        }
    )
    return session


def fetch_public_key(session: requests.Session, repo: str) -> tuple[str, str]:
    resp = session.get(
        f"https://api.github.com/repos/{repo}/actions/secrets/public-key",
        timeout=15,
    )
    resp.raise_for_status()
    payload = resp.json()
    return payload["key_id"], payload["key"]


def update_secret(
    session: requests.Session,
    repo: str,
    name: str,
    value: str,
    key_id: str,
    public_key: str,
) -> None:
    resp = session.put(
        f"https://api.github.com/repos/{repo}/actions/secrets/{name}",
        json={
            "encrypted_value": encrypt_secret(public_key, value),
            "key_id": key_id,
        },
        timeout=15,
    )
    if resp.status_code not in (201, 204):
        raise RuntimeError(f"{name} update failed: HTTP {resp.status_code} {resp.text[:200]}")


def sync_repo_secrets(
    repo: str,
    token: str,
    secret_values: dict[str, str],
) -> list[str]:
    pending = {name: value.strip() for name, value in secret_values.items() if value and value.strip()}
    if not pending:
        return []

    session = build_session(token)
    key_id, public_key = fetch_public_key(session, repo)
    updated = []
    for name, value in pending.items():
        update_secret(session, repo, name, value, key_id, public_key)
        updated.append(name)
    return updated
