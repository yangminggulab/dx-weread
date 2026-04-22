#!/usr/bin/env python3
"""
将本地任务面板的当前数据推送到线上 Cloudflare Worker。

用法:
  python3 scripts/push_cloud_data.py https://yangminggu.com/tasks
"""

from __future__ import annotations

import argparse
from urllib.parse import urljoin

import requests

import server


def normalize_base_url(raw: str) -> str:
    base = raw.strip().rstrip("/")
    if not base.startswith(("http://", "https://")):
        raise ValueError("目标地址必须以 http:// 或 https:// 开头")
    return base + "/"


def push_cloud_data(base_url: str) -> dict:
    payload = server.load_app_data()
    endpoint = urljoin(base_url, "api/data")
    response = requests.post(endpoint, json=payload, timeout=30)
    response.raise_for_status()
    return {
        "endpoint": endpoint,
        "taskCount": len(payload.get("tasks") or []),
        "bookCount": len(payload.get("books") or []),
        "noteCount": len(payload.get("notes") or []),
        "updateCount": len(payload.get("updates") or []),
        "response": response.json() if response.content else {"ok": True},
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="把本地数据推送到 Cloudflare Worker")
    parser.add_argument(
        "base_url",
        nargs="?",
        default="https://yangminggu.com/tasks",
        help="线上任务页地址，默认 https://yangminggu.com/tasks",
    )
    args = parser.parse_args()

    try:
        result = push_cloud_data(normalize_base_url(args.base_url))
    except Exception as exc:
        print(f"[push-cloud-data] 失败: {exc}")
        return 1

    print("[push-cloud-data] 完成")
    print(f"  endpoint: {result['endpoint']}")
    print(
        "  payload: "
        f"{result['taskCount']} tasks, "
        f"{result['bookCount']} books, "
        f"{result['noteCount']} notes, "
        f"{result['updateCount']} updates"
    )
    print(f"  response: {result['response']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
