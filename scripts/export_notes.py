#!/usr/bin/env python3
"""
微信读书笔记导出脚本
将划线、想法（批注）导出为 Markdown 格式文件，按书目分类保存

依赖: requests
配置: 环境变量 WEREAD_COOKIE
"""

import os
import sys
import json
import logging
import re
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
WEREAD_REVIEW_LIST_URL = f"{WEREAD_BASE_URL}/web/review/list"
WEREAD_BOOKMARKLIST_URL = f"{WEREAD_BASE_URL}/web/book/bookmarklist"
WEREAD_BEST_HIGHLIGHTS_URL = f"{WEREAD_BASE_URL}/web/book/bestHighlights"
WEREAD_CHAPTER_INFO_URL = f"{WEREAD_BASE_URL}/web/book/chapterInfos"

load_dotenv(ROOT_DIR)

# 输出目录
OUTPUT_DIR = Path(os.environ.get("NOTES_DIR", "data/notes"))
# 是否导出热门划线
INCLUDE_BEST_HIGHLIGHTS = os.environ.get("INCLUDE_BEST_HIGHLIGHTS", "false").lower() == "true"


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


def safe_filename(name: str) -> str:
    """生成安全的文件名"""
    return re.sub(r'[\\/:*?"<>|]', "_", name)


def get_bookshelf(cookie: str) -> list:
    headers = get_headers(cookie)
    params = {"synckey": 0, "teenmode": 0, "album": 0, "onlyBookid": 0}
    try:
        resp = requests.get(WEREAD_SHELF_URL, headers=headers, params=params, timeout=15)
        resp.raise_for_status()
        return normalize_shelf_entries(resp.json())
    except Exception as e:
        logger.error(f"获取书架失败: {e}")
        return []


def get_bookmarks(cookie: str, book_id: str) -> list:
    """获取划线列表"""
    headers = get_headers(cookie)
    params = {"bookId": book_id}
    try:
        resp = requests.get(
            WEREAD_BOOKMARKLIST_URL, headers=headers, params=params, timeout=10
        )
        resp.raise_for_status()
        data = resp.json()
        return data.get("updated", [])
    except Exception as e:
        logger.warning(f"  获取划线失败 (bookId={book_id}): {e}")
        return []


def get_reviews(cookie: str, book_id: str) -> list:
    """获取批注/想法列表"""
    headers = get_headers(cookie)
    params = {
        "bookId": book_id,
        "listType": 11,
        "mine": 1,
        "synckey": 0,
        "maxIdx": 0,
        "count": 100,
    }
    try:
        resp = requests.get(
            WEREAD_REVIEW_LIST_URL, headers=headers, params=params, timeout=10
        )
        resp.raise_for_status()
        data = resp.json()
        return data.get("reviews", [])
    except Exception as e:
        logger.warning(f"  获取批注失败 (bookId={book_id}): {e}")
        return []


def timestamp_to_str(ts: int) -> str:
    if not ts:
        return ""
    return datetime.fromtimestamp(ts).strftime("%Y-%m-%d %H:%M")


def format_note_markdown(book_meta: dict, bookmarks: list, reviews: list) -> str:
    """将划线和批注整理成 Markdown 格式"""
    book = book_meta.get("book", {})
    title = book.get("title", "未知书名")
    author = book.get("author", "未知作者")
    cover = book.get("cover", "")
    category = book.get("category", "")
    read_info = book_meta.get("readInfo", {})
    reading_time = read_info.get("readingTime", 0)
    reading_hours = reading_time / 3600

    lines = []

    # Front matter
    lines.append("---")
    lines.append(f"title: {title}")
    lines.append(f"author: {author}")
    lines.append(f"category: {category}")
    lines.append(f"reading_time: {reading_hours:.1f}h")
    lines.append(f"export_date: {datetime.now().strftime('%Y-%m-%d')}")
    lines.append("---")
    lines.append("")

    # 书籍标题
    lines.append(f"# 《{title}》笔记")
    lines.append(f"> 作者：{author}")
    if category:
        lines.append(f"> 分类：{category}")
    lines.append(f"> 累计阅读：{reading_hours:.1f} 小时")
    lines.append("")

    # 构建章节->笔记的映射
    # bookmarks: {chapterTitle, markText, createTime, style(1=橙 2=红 3=紫 4=蓝)}
    # reviews: {review: {content, abstract(划线原文), chapterTitle, createTime}}

    chapter_notes: dict[str, list] = {}

    for bm in bookmarks:
        chapter = bm.get("chapterTitle", "无章节")
        text = bm.get("markText", "").strip()
        if not text:
            continue
        style_map = {1: "🟠", 2: "🔴", 3: "🟣", 4: "🔵"}
        emoji = style_map.get(bm.get("style", 1), "📌")
        ts = timestamp_to_str(bm.get("createTime", 0))
        entry = {"type": "bookmark", "emoji": emoji, "text": text, "ts": ts, "comment": ""}
        chapter_notes.setdefault(chapter, []).append(entry)

    for rv in reviews:
        review = rv.get("review", {})
        chapter = review.get("chapterTitle", "无章节")
        abstract = review.get("abstract", "").strip()
        content = review.get("content", "").strip()
        ts = timestamp_to_str(review.get("createTime", 0))
        if abstract or content:
            entry = {
                "type": "review",
                "emoji": "💬",
                "text": abstract,
                "ts": ts,
                "comment": content,
            }
            chapter_notes.setdefault(chapter, []).append(entry)

    if not chapter_notes:
        lines.append("*暂无笔记*")
        return "\n".join(lines)

    # 输出各章节笔记
    for chapter, notes in chapter_notes.items():
        lines.append(f"## {chapter}")
        lines.append("")
        for note in notes:
            if note["type"] == "bookmark":
                lines.append(f"> {note['emoji']} {note['text']}")
                if note["ts"]:
                    lines.append(f"*划线于 {note['ts']}*")
            else:
                if note["text"]:
                    lines.append(f"> 💬 {note['text']}")
                if note["comment"]:
                    lines.append(f"\n**想法：** {note['comment']}")
                if note["ts"]:
                    lines.append(f"*批注于 {note['ts']}*")
            lines.append("")

    return "\n".join(lines)


def export_book_notes(cookie: str, book_meta: dict) -> bool:
    """导出单本书的笔记"""
    book = book_meta.get("book", {})
    book_id = book_meta.get("_bookId", "") or book.get("bookId", "")
    title = book.get("title", "") or book_id

    bookmarks = get_bookmarks(cookie, book_id)
    reviews = get_reviews(cookie, book_id)

    if not bookmarks and not reviews:
        logger.info(f"  《{title}》无笔记，跳过")
        return False

    logger.info(f"  《{title}》划线 {len(bookmarks)} 条 | 批注 {len(reviews)} 条")
    content = format_note_markdown(book_meta, bookmarks, reviews)

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    filename = safe_filename(title) + ".md"
    filepath = OUTPUT_DIR / filename
    with open(filepath, "w", encoding="utf-8") as f:
        f.write(content)

    return True


def generate_index(exported: list):
    """生成笔记索引文件"""
    lines = [
        "# 微信读书笔记索引",
        "",
        f"> 最后更新：{datetime.now().strftime('%Y-%m-%d %H:%M')}",
        f"> 共 {len(exported)} 本书有笔记",
        "",
        "| 书名 | 作者 | 文件 |",
        "| --- | --- | --- |",
    ]
    for item in exported:
        title = item["title"]
        author = item["author"]
        fname = item["filename"]
        lines.append(f"| {title} | {author} | [{fname}](./{fname}) |")

    index_path = OUTPUT_DIR / "README.md"
    with open(index_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    logger.info(f"索引已生成: {index_path}")


def run_export(cookie: str):
    """主流程：笔记导出"""
    logger.info("=== 微信读书笔记导出开始 ===")

    books = get_bookshelf(cookie)
    if not books:
        logger.error("书架为空或获取失败，退出")
        sys.exit(1)

    logger.info(f"书架共 {len(books)} 本书，开始逐一导出笔记...")
    exported = []

    for book_meta in books:
        book = book_meta.get("book", {})
        title = book.get("title", "")
        author = book.get("author", "")
        ok = export_book_notes(cookie, book_meta)
        if ok:
            exported.append(
                {
                    "title": title,
                    "author": author,
                    "filename": safe_filename(title) + ".md",
                }
            )

    if exported:
        generate_index(exported)

    logger.info(f"=== 笔记导出完成，共导出 {len(exported)} 本书的笔记 ===")


if __name__ == "__main__":
    cookie = load_weread_cookie(ROOT_DIR)
    if not cookie:
        logger.error("请设置环境变量 WEREAD_COOKIE 或准备 .weread_cookie.json")
        sys.exit(1)
    run_export(cookie)
