#!/usr/bin/env python3
"""微信读书笔记导出脚本 — 使用 API Key（无需 Cookie）"""

import logging
import os
import re
import sys
from datetime import datetime
from pathlib import Path

import requests

ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from sync.weread_env import load_dotenv

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
OUTPUT_DIR = Path(os.environ.get("NOTES_DIR", "data/notes"))


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
        raise RuntimeError(f"{api_name} errcode={ec}")
    return data


def get_notebooks():
    books = []
    last_sort = None
    for _ in range(50):
        params = {"count": 100}
        if last_sort:
            params["lastSort"] = last_sort
        payload = gw("/user/notebooks", **params)
        page = payload.get("books") or []
        books.extend(b for b in page if isinstance(b, dict))
        if not payload.get("hasMore") or not page:
            break
        last_sort = int(page[-1].get("sort") or 0)
        if not last_sort:
            break
    return books


def get_reviews(book_id):
    reviews = []
    synckey = 0
    for _ in range(50):
        payload = gw("/review/list/mine", bookid=book_id, count=100, synckey=synckey)
        page = payload.get("reviews") or []
        reviews.extend(r for r in page if isinstance(r, dict))
        if not payload.get("hasMore") or not page:
            break
        next_key = int(payload.get("synckey") or 0)
        if next_key == synckey:
            break
        synckey = next_key
    return reviews


def safe_filename(name):
    return re.sub(r'[\\/:*?"<>|]', "_", name)


def ts_to_str(ts):
    if not ts:
        return ""
    return datetime.fromtimestamp(int(ts)).strftime("%Y-%m-%d %H:%M")


def format_markdown(notebook_book, bookmark_payload, reviews):
    book = notebook_book.get("book") if isinstance(notebook_book.get("book"), dict) else {}
    title = book.get("title", "未知书名")
    author = book.get("author", "未知作者")
    category = book.get("category", "")
    reading_time = int(notebook_book.get("readingTime") or 0)

    lines = [
        "---",
        f"title: {title}",
        f"author: {author}",
        f"category: {category}",
        f"reading_time: {reading_time / 3600:.1f}h",
        f"export_date: {datetime.now().strftime('%Y-%m-%d')}",
        "---",
        "",
        f"# 《{title}》笔记",
        f"> 作者：{author}",
    ]
    if category:
        lines.append(f"> 分类：{category}")
    lines += [f"> 累计阅读：{reading_time / 3600:.1f} 小时", ""]

    chapter_notes: dict[str, list] = {}

    chapters = {
        int(c.get("chapterUid") or 0): str(c.get("title") or "")
        for c in (bookmark_payload.get("chapters") or [])
        if isinstance(c, dict)
    }
    style_map = {1: "🟠", 2: "🔴", 3: "🟣", 4: "🔵"}
    for bm in (bookmark_payload.get("updated") or []):
        chapter = chapters.get(int(bm.get("chapterUid") or 0), "无章节")
        text = (bm.get("markText") or "").strip()
        if not text:
            continue
        chapter_notes.setdefault(chapter, []).append({
            "type": "bookmark",
            "emoji": style_map.get(bm.get("colorStyle") or bm.get("style") or 1, "📌"),
            "text": text,
            "ts": ts_to_str(bm.get("createTime")),
            "comment": "",
        })

    for rv in reviews:
        review = rv.get("review") if isinstance(rv.get("review"), dict) else {}
        chapter = str(review.get("chapterName") or review.get("chapterTitle") or "无章节")
        abstract = (review.get("abstract") or "").strip()
        content = (review.get("content") or "").strip()
        if abstract or content:
            chapter_notes.setdefault(chapter, []).append({
                "type": "review",
                "emoji": "💬",
                "text": abstract,
                "ts": ts_to_str(review.get("createTime")),
                "comment": content,
            })

    if not chapter_notes:
        lines.append("*暂无笔记*")
        return "\n".join(lines)

    for chapter, notes in chapter_notes.items():
        lines += [f"## {chapter}", ""]
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


def export_book(notebook_book):
    book = notebook_book.get("book") if isinstance(notebook_book.get("book"), dict) else {}
    book_id = str(notebook_book.get("bookId") or book.get("bookId") or "").strip()
    title = book.get("title", "") or book_id
    if not book_id:
        return None

    try:
        bookmark_payload = gw("/book/bookmarklist", bookId=book_id)
        reviews = get_reviews(book_id)
    except Exception as e:
        logger.warning(f"  《{title}》获取失败: {e}")
        return None

    if not (bookmark_payload.get("updated") or reviews):
        logger.info(f"  《{title}》无笔记，跳过")
        return None

    logger.info(
        f"  《{title}》划线 {notebook_book.get('noteCount', 0)} 条 | "
        f"想法 {notebook_book.get('reviewCount', 0)} 条"
    )
    content = format_markdown(notebook_book, bookmark_payload, reviews)

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    filename = safe_filename(title) + ".md"
    with open(OUTPUT_DIR / filename, "w", encoding="utf-8") as f:
        f.write(content)
    return {"title": title, "author": book.get("author", ""), "filename": filename}


def generate_index(exported):
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
        lines.append(f"| {item['title']} | {item['author']} | [{item['filename']}](./{item['filename']}) |")
    with open(OUTPUT_DIR / "README.md", "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    logger.info(f"索引已生成: {OUTPUT_DIR / 'README.md'}")


def run_export():
    logger.info("=== 微信读书笔记导出开始 ===")
    notebooks = get_notebooks()
    if not notebooks:
        logger.error("未找到有笔记的书籍，退出")
        sys.exit(1)
    logger.info(f"共 {len(notebooks)} 本书有笔记，开始导出...")

    exported = []
    for nb in notebooks:
        result = export_book(nb)
        if result:
            exported.append(result)

    if exported:
        generate_index(exported)
    logger.info(f"=== 笔记导出完成，共导出 {len(exported)} 本书的笔记 ===")


if __name__ == "__main__":
    if not WEREAD_API_KEY:
        logger.error("请设置环境变量 WEREAD_API_KEY")
        sys.exit(1)
    run_export()
