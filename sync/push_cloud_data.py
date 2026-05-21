#!/usr/bin/env python3
"""
将本地任务面板的当前数据推送到线上 Cloudflare Worker。

用法:
  python3 scripts/push_cloud_data.py
  python3 scripts/push_cloud_data.py https://yangminggu.com/tasks

Token 设置方式（三选一，优先级从高到低）：
  1. 环境变量：export API_TOKEN=your_token_here
  2. 项目根目录的 .env 文件：API_TOKEN=your_token_here
  3. 命令行参数：--token your_token_here
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path
from urllib.parse import urljoin

import requests

# 尝试加载 .env 文件
def load_env_file():
    env_path = Path(__file__).parent.parent / ".env"
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, _, val = line.partition("=")
                os.environ.setdefault(key.strip(), val.strip().strip('"').strip("'"))

load_env_file()

_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_ROOT))
sys.path.insert(0, str(_ROOT / "web"))

from services.storage import load_app_data


def normalize_base_url(raw: str) -> str:
    base = raw.strip().rstrip("/")
    if not base.startswith(("http://", "https://")):
        raise ValueError("目标地址必须以 http:// 或 https:// 开头")
    return base + "/"


def push_cloud_data(base_url: str, token: str) -> dict:
    payload = load_app_data()
    endpoint = urljoin(base_url, "api/data")
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {token}",
    }
    response = requests.post(endpoint, json=payload, headers=headers, timeout=30)
    if response.status_code == 401:
        raise PermissionError("❌ 认证失败（401）：API_TOKEN 不正确，请检查 .env 文件或环境变量")
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
        result = push_cloud_data(normalize_base_url(args.base_url), args.token)
    except PermissionError as exc:
        print(exc)
        return 1
    except Exception as exc:
        print(f"[push-cloud-data] 失败: {exc}")
        return 1

    print("✅ [push-cloud-data] 推送成功")
    print(f"   endpoint : {result['endpoint']}")
    print(f"   tasks    : {result['taskCount']}")
    print(f"   books    : {result['bookCount']}")
    print(f"   notes    : {result['noteCount']}")
    print(f"   updates  : {result['updateCount']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
