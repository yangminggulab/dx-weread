#!/usr/bin/env python3
"""微信读书书架备份脚本 — 使用 API Key（无需 Cookie）"""

import json
import logging
import os
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path

import requests

ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from scripts.weread_env import load_dotenv

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)

load_dotenv(ROOT_DIR)

GATEWAY_URL = "https://i.weread.qq.com/api/agent/gateway"
SKILL_VERSION = "1.0.3"
WEREAD_API_KEY = os.environ.get("WEREAD_API_KEY", "")
OUTPUT_DIR = Path(os.environ.get("BACKUP_DIR", "data/bookshelf"))


def gw(api_name, **params):
    resp = requests.post(
        GATEWAY_URL,
        json={"api_name": api_name, "skill_version": SKILL_VERSION, **params},
        headers={"Authorization": f"Bearer {WEREAD_API_KEY}", "Content-Type": "application/json"},
        timeout=20,
    )
    resp.raise_for_status()
    data = resp.json()
    ec = data.get("errcode", data.get("errCode", 0))
    if ec not in (0, None):
        raise RuntimeError(f"{api_name} errcode={ec}: {data.get('errmsg') or data.get('errMsg', '')}")
    return data


def fetch_progress(book_id):
    try:
        return book_id, gw("/book/getprogress", bookId=book_id).get("book") or {}
    except Exception:
        return book_id, {}


def run_backup():
    logger.info("=== 微信读书书架备份开始 ===")

    shelf = gw("/shelf/sync")
    raw_books = [b for b in (shelf.get("books") or []) if isinstance(b, dict)]
    logger.info(f"获取书架完成，共 {len(raw_books)} 本书")

    book_ids = [str(b.get("bookId") or "").strip() for b in raw_books if b.get("bookId")]
    progress_map = {}
    with ThreadPoolExecutor(max_workers=6) as pool:
        for bid, prog in pool.map(fetch_progress, book_ids):
            if bid:
                progress_map[bid] = prog

    summary = []
    for book in raw_books:
        bid = str(book.get("bookId") or "").strip()
        prog = progress_map.get(bid, {})
        read_ts = int(prog.get("updateTime") or book.get("readUpdateTime") or book.get("updateTime") or 0)
        reading_time = int(prog.get("recordReadingTime") or prog.get("readingTime") or 0)
        progress = max(0, min(100, int(prog.get("progress") or 0)))
        finished = progress >= 100 or int(book.get("finishReading") or 0) == 1
        summary.append({
            "bookId": bid,
            "title": book.get("title", ""),
            "author": book.get("author", ""),
            "cover": book.get("cover", ""),
            "category": book.get("category", ""),
            "readingTime": reading_time,
            "progress": progress,
            "markedStatus": 4 if finished else 0,
            "lastReadingDate": read_ts,
        })
    summary.sort(key=lambda x: x.get("lastReadingDate", 0), reverse=True)

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    payload = {
        "backup_time": datetime.now().isoformat(),
        "total_books": len(summary),
        "total_reading_seconds": sum(b.get("readingTime", 0) for b in summary),
        "finished_books": sum(1 for b in summary if b.get("markedStatus") == 4),
        "books": summary,
    }
    summary_path = OUTPUT_DIR / "shelf_latest.json"
    with open(summary_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    total_hours = payload["total_reading_seconds"] / 3600
    logger.info(
        f"📚 书架统计 | 总书目: {payload['total_books']} | "
        f"已读完: {payload['finished_books']} | "
        f"累计阅读: {total_hours:.1f} 小时"
    )
    logger.info(f"摘要数据已保存: {summary_path}")
    logger.info("=== 书架备份完成 ===")


if __name__ == "__main__":
    if not WEREAD_API_KEY:
        logger.error("请设置环境变量 WEREAD_API_KEY")
        sys.exit(1)
    run_backup()
