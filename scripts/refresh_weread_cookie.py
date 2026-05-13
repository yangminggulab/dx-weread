#!/usr/bin/env python3
"""Refresh `.weread_cookie.json` from the current Chrome WeRead login."""

from __future__ import annotations

import json
import sys
from datetime import datetime
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from scripts.weread_env import load_dotenv


def load_cookie_from_chrome() -> str:
    try:
        import browser_cookie3
        from browser_cookie3 import BrowserCookieError
    except ImportError as exc:
        raise RuntimeError("缺少 browser-cookie3 依赖，请先安装 requirements.txt") from exc

    try:
        jar = browser_cookie3.chrome(domain_name="weread.qq.com")
    except BrowserCookieError as exc:
        raise RuntimeError(
            "自动读取失败：macOS 未授权读取 Chrome 的登录 Cookie。"
            "请允许钥匙串访问，或改用手动粘贴 Cookie。"
        ) from exc
    except Exception as exc:
        raise RuntimeError(f"自动读取失败：{exc}") from exc

    pairs = []
    seen = set()
    for cookie in jar:
        if "weread.qq.com" not in cookie.domain:
            continue
        if not cookie.value or cookie.name in seen:
            continue
        seen.add(cookie.name)
        pairs.append(f"{cookie.name}={cookie.value}")

    required = {"wr_skey", "wr_vid", "wr_rt"}
    names = {part.split("=", 1)[0] for part in pairs}
    missing = sorted(required - names)
    if missing:
        raise RuntimeError(
            "自动读取失败：Chrome 里未找到完整的微信读书登录 Cookie，缺少 "
            + ", ".join(missing)
            + "。请先确认 weread.qq.com 已登录。"
        )

    return "; ".join(pairs)


def save_cookie(cookie: str) -> Path:
    cookie_path = ROOT_DIR / ".weread_cookie.json"
    payload = {
        "cookie": cookie,
        "updatedAt": datetime.now().isoformat(timespec="seconds"),
    }
    cookie_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    try:
        cookie_path.chmod(0o600)
    except OSError:
        pass
    return cookie_path


def main() -> int:
    load_dotenv(ROOT_DIR)
    cookie = load_cookie_from_chrome()
    path = save_cookie(cookie)
    print(f"已刷新 Cookie: {path.name}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except RuntimeError as exc:
        print(f"❌ {exc}")
        raise SystemExit(1)
