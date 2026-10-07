"""把本地 data/essays.json（年度总结与长篇思想）推送到云端 Worker KV。

幂等：按 title 去重，云端已存在同标题的篇目跳过，不会重复写入。
依赖 env：API_TOKEN（必填）、CLOUD_BASE_URL（可选，默认 https://yangminggu.com/tasks）。

用法：
    python3 web/sync/push_essays.py
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import requests

ROOT_DIR = Path(__file__).resolve().parents[2]
ESSAYS_PATH = ROOT_DIR / "data" / "essays.json"


def _load_env() -> None:
    env_path = ROOT_DIR / ".env"
    if not env_path.exists():
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip())


def main() -> int:
    _load_env()
    base_url = os.environ.get("CLOUD_BASE_URL", "https://yangminggu.com/tasks").rstrip("/")
    token = os.environ.get("API_TOKEN", "").strip()
    if not token:
        print("缺少 API_TOKEN（请在根目录 .env 配置）", file=sys.stderr)
        return 1
    if not ESSAYS_PATH.exists():
        print(f"找不到 {ESSAYS_PATH}", file=sys.stderr)
        return 1

    local = json.loads(ESSAYS_PATH.read_text(encoding="utf-8"))
    items = local.get("items", []) if isinstance(local, dict) else []
    if not items:
        print("data/essays.json 没有可推送的篇目")
        return 0

    headers = {"Content-Type": "application/json", "Authorization": f"Bearer {token}"}
    resp = requests.get(f"{base_url}/api/essays", headers=headers, timeout=30)
    resp.raise_for_status()
    existing_titles = {e.get("title") for e in resp.json().get("items", [])}

    added = 0
    for item in items:
        title = item.get("title", "")
        if title in existing_titles:
            print(f"跳过（云端已存在）：{title}")
            continue
        payload = {
            "title": title,
            "content": item.get("content", ""),
            "category": item.get("category", "长篇思想"),
            "date": item.get("date", ""),
        }
        r = requests.post(f"{base_url}/api/essays/add", headers=headers, json=payload, timeout=30)
        r.raise_for_status()
        added += 1
        print(f"已推送：{title}")

    print(f"完成：新增 {added} 篇，云端现有 {len(existing_titles) + added} 篇")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
