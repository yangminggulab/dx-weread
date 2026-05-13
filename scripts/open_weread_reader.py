#!/usr/bin/env python3
"""Open a WeRead reader page in Google Chrome for local auto-capture."""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from scripts.weread_env import load_dotenv

READER_URL_RE = re.compile(
    r"^https://([^/]+\.)?weread\.qq\.com/(web/reader|web/appreader|book/reader|web/mp/reader)/"
)


def is_reader_url(url: str) -> bool:
    return bool(READER_URL_RE.match(str(url or "").strip()))


def iter_candidate_urls() -> list[str]:
    urls: list[str] = []

    env_url = os.environ.get("WEREAD_READER_URL", "").strip()
    if is_reader_url(env_url):
        urls.append(env_url)

    template_path = ROOT_DIR / ".weread_read_template.json"
    if template_path.exists():
        try:
            payload = json.loads(template_path.read_text(encoding="utf-8"))
        except Exception:
            payload = {}

        latest = payload.get("latest") if isinstance(payload.get("latest"), dict) else {}
        captures = payload.get("captures") if isinstance(payload.get("captures"), list) else []

        for source in [latest, *captures]:
            if not isinstance(source, dict):
                continue
            for key in ("tabUrl", "documentUrl", "url"):
                candidate = str(source.get(key, "")).strip()
                if is_reader_url(candidate):
                    urls.append(candidate)

    seen = set()
    result = []
    for url in urls:
        if url in seen:
            continue
        seen.add(url)
        result.append(url)
    return result


def main() -> int:
    load_dotenv(ROOT_DIR)
    candidates = iter_candidate_urls()
    if not candidates:
        print(
            "❌ 没找到可自动打开的微信读书 reader 链接。"
            "请先手动打开一次正文页让扩展捕获模板，或在 .env 里设置 WEREAD_READER_URL。"
        )
        return 1

    target = candidates[0]
    subprocess.run(["open", "-a", "Google Chrome", target], check=True)
    print(f"已打开微信读书 reader 页: {target}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
