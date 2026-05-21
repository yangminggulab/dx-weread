#!/usr/bin/env python3
"""
将本地 diary.json 推送到线上云端。

用法:
  python3 scripts/push_diary.py
  python3 scripts/push_diary.py https://yangminggu.com/tasks

Token 设置方式（三选一，优先级从高到低）：
  1. 环境变量：export API_TOKEN=your_token_here
  2. 项目根目录的 .env 文件：API_TOKEN=your_token_here
  3. 命令行参数：--token your_token_here
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from urllib.parse import urljoin

import requests


def load_env_file():
    env_path = Path(__file__).parent.parent / ".env"
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, _, val = line.partition("=")
                os.environ.setdefault(key.strip(), val.strip().strip('"').strip("'"))


load_env_file()


def normalize_base_url(raw: str) -> str:
    base = raw.strip().rstrip("/")
    if not base.startswith(("http://", "https://")):
        raise ValueError("目标地址必须以 http:// 或 https:// 开头")
    return base + "/"


def push_diary(base_url: str, token: str) -> dict:
    diary_path = Path(__file__).parent.parent / "diary.json"
    if not diary_path.exists():
        raise FileNotFoundError(f"找不到 diary.json：{diary_path}")

    diary = json.loads(diary_path.read_text(encoding="utf-8"))
    archive = diary.get("archive", [])
    today = diary.get("today", {})

    endpoint = urljoin(base_url, "api/diary")
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {token}",
    }
    response = requests.post(endpoint, json=diary, headers=headers, timeout=30)
    if response.status_code == 401:
        raise PermissionError("❌ 认证失败（401）：API_TOKEN 不正确，请检查 .env 文件或环境变量")
    response.raise_for_status()

    return {
        "endpoint": endpoint,
        "archiveCount": len(archive),
        "todayDate": today.get("date", ""),
        "response": response.json() if response.content else {"ok": True},
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="把本地 diary.json 推送到云端")
    parser.add_argument(
        "base_url",
        nargs="?",
        default="https://yangminggu.com/tasks",
        help="线上任务页地址，默认 https://yangminggu.com/tasks",
    )
    parser.add_argument(
        "--token",
        default=os.environ.get("API_TOKEN", ""),
        help="API Token（也可用环境变量 API_TOKEN 或 .env 文件）",
    )
    args = parser.parse_args()

    if not args.token:
        print("❌ 未找到 API_TOKEN，请通过以下任意方式提供：")
        print("   1. 在项目根目录创建 .env 文件，写入：API_TOKEN=你的token")
        print("   2. 环境变量：export API_TOKEN=你的token")
        print("   3. 命令行参数：--token 你的token")
        return 1

    try:
        result = push_diary(normalize_base_url(args.base_url), args.token)
    except PermissionError as exc:
        print(exc)
        return 1
    except Exception as exc:
        print(f"[push-diary] 失败: {exc}")
        return 1

    print("✅ [push-diary] 推送成功")
    print(f"   endpoint : {result['endpoint']}")
    print(f"   archive  : {result['archiveCount']} 条")
    print(f"   today    : {result['todayDate']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
