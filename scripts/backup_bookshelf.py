#!/usr/bin/env python3
"""
微信读书书架备份脚本
将书架数据（书单、阅读进度、书目信息）备份为本地 JSON 文件

依赖: requests
配置: 环境变量 WEREAD_COOKIE
"""

import os
import sys
import json
import logging
import requests
from datetime import datetime
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from scripts.weread_env import load_dotenv, load_weread_cookie, normalize_shelf_entries

# ========== 日志配置 ==========
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)

# ========== 微信读书 API ==========
WEREAD_BASE_URL = "https://weread.qq.com"
WEREAD_SHELF_URL = f"{WEREAD_BASE_URL}/web/shelf/sync"
WEREAD_BOOK_INFO_URL = f"{WEREAD_BASE_URL}/web/book/info"
WEREAD_READING_TIME_URL = f"{WEREAD_BASE_URL}/web/book/readingDetail"

load_dotenv(ROOT_DIR)

# 备份输出目录
OUTPUT_DIR = Path(os.environ.get("BACKUP_DIR", "data/bookshelf"))


def get_headers(cookie: str) -> dict:
    return {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/124.0.0.0 Safari/537.36"
        ),
        "Cookie": cookie,
        "Referer": "https://weread.qq.com/",
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "zh-CN,zh;q=0.9",
    }


def get_bookshelf(cookie: str) -> dict:
    """获取完整书架数据"""
    headers = get_headers(cookie)
    params = {"synckey": 0, "teenmode": 0, "album": 0, "onlyBookid": 0}
    try:
        resp = requests.get(WEREAD_SHELF_URL, headers=headers, params=params, timeout=15)
        resp.raise_for_status()
        data = resp.json()
        logger.info(f"成功获取书架，共 {len(data.get('books', []))} 本书")
        return data
    except requests.HTTPError as e:
        if e.response.status_code == 401:
            logger.error("Cookie 已过期，请更新 WEREAD_COOKIE")
            sys.exit(1)
        logger.error(f"获取书架失败: {e}")
        return {}
    except Exception as e:
        logger.error(f"获取书架失败: {e}")
        return {}


def get_reading_time_detail(cookie: str, book_id: str) -> dict:
    """获取某本书的详细阅读时长数据"""
    headers = get_headers(cookie)
    params = {"bookId": book_id}
    try:
        resp = requests.get(
            WEREAD_READING_TIME_URL, headers=headers, params=params, timeout=10
        )
        resp.raise_for_status()
        return resp.json()
    except Exception:
        return {}


def format_shelf_summary(shelf_data: dict) -> list:
    """将书架数据整理为可读摘要列表"""
    books = normalize_shelf_entries(shelf_data)
    summary = []
    for item in books:
        book = item.get("book", {})
        read_info = item.get("readInfo", {})
        summary.append(
            {
                "bookId": item.get("_bookId", ""),
                "title": book.get("title", ""),
                "author": book.get("author", ""),
                "cover": book.get("cover", ""),
                "category": book.get("category", ""),
                "totalWords": book.get("totalWords", 0),
                "readingTime": read_info.get("readingTime", 0),  # 秒
                "markedStatus": 4 if (book.get("finishReading") or book.get("finished")) else 0,
                "finishedDate": book.get("finishedDate", ""),
                "progress": read_info.get("progress", 0),
                "lastReadingDate": (
                    item.get("readUpdateTime")
                    or read_info.get("updateTime")
                    or item.get("updateTime")
                    or 0
                ),
            }
        )
    # 按最近阅读排序
    summary.sort(key=lambda x: x.get("lastReadingDate", 0), reverse=True)
    return summary


def save_backup(data: dict, summary: list):
    """保存备份文件"""
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    today = datetime.now().strftime("%Y-%m-%d")

    # 完整原始数据备份
    raw_path = OUTPUT_DIR / f"shelf_raw_{today}.json"
    with open(raw_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    logger.info(f"原始数据已保存: {raw_path}")

    # 摘要数据（最新版本覆盖）
    summary_path = OUTPUT_DIR / "shelf_latest.json"
    payload = {
        "backup_time": datetime.now().isoformat(),
        "total_books": len(summary),
        "total_reading_seconds": sum(b.get("readingTime", 0) for b in summary),
        "finished_books": sum(1 for b in summary if b.get("markedStatus") == 4),
        "books": summary,
    }
    with open(summary_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    logger.info(f"摘要数据已保存: {summary_path}")

    # 打印统计
    total_hours = payload["total_reading_seconds"] / 3600
    logger.info(
        f"📚 书架统计 | 总书目: {payload['total_books']} | "
        f"已读完: {payload['finished_books']} | "
        f"累计阅读: {total_hours:.1f} 小时"
    )

    return summary_path


def run_backup(cookie: str):
    """主流程：书架备份"""
    logger.info("=== 微信读书书架备份开始 ===")

    shelf_data = get_bookshelf(cookie)
    if not shelf_data:
        logger.error("获取书架失败，退出")
        sys.exit(1)

    summary = format_shelf_summary(shelf_data)
    save_backup(shelf_data, summary)

    logger.info("=== 书架备份完成 ===")


if __name__ == "__main__":
    cookie = load_weread_cookie(ROOT_DIR)
    if not cookie:
        logger.error("请设置环境变量 WEREAD_COOKIE 或准备 .weread_cookie.json")
        sys.exit(1)
    run_backup(cookie)
