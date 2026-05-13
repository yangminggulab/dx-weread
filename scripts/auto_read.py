#!/usr/bin/env python3
"""
微信读书自动阅读时长脚本
通过模拟真实阅读行为，周期性发送阅读心跳请求，积累阅读时长

依赖: requests
配置: 环境变量 WEREAD_COOKIE
"""

import os
import sys
import time
import random
import logging
import json
import requests
from datetime import datetime

from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from scripts.weread_env import (
    load_dotenv,
    load_weread_cookie,
    load_weread_read_template,
    normalize_shelf_entries,
)

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
WEREAD_READ_URL = f"{WEREAD_BASE_URL}/web/book/read"
WEREAD_HEARTBEAT_URL = f"{WEREAD_BASE_URL}/web/book/read"

load_dotenv(ROOT_DIR)

# 每次阅读心跳间隔（秒），模拟真人阅读节奏
READ_INTERVAL_MIN = int(os.environ.get("READ_INTERVAL_MIN", "55"))
READ_INTERVAL_MAX = int(os.environ.get("READ_INTERVAL_MAX", "65"))

# 单次运行总阅读时长（分钟）
READ_DURATION_MINUTES = int(os.environ.get("READ_DURATION_MINUTES", "30"))

# 本地验证时可限制心跳次数，避免等待太久
MAX_HEARTBEATS = int(os.environ.get("MAX_HEARTBEATS", "0"))

DEFAULT_APP_ID = "wb182564874663h673"

# 最大重试次数
MAX_RETRIES = 3


def get_headers(cookie: str) -> dict:
    """构造请求头，模拟浏览器行为"""
    return {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/124.0.0.0 Safari/537.36"
        ),
        "Cookie": cookie,
        "Referer": "https://weread.qq.com/",
        "Origin": "https://weread.qq.com",
        "Content-Type": "application/json;charset=UTF-8",
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "zh-CN,zh;q=0.9",
    }


def coerce_int(value, default: int = 0) -> int:
    """宽松地把模板/接口里的数值转成 int。"""
    try:
        if value in (None, ""):
            return default
        return int(value)
    except (TypeError, ValueError):
        return default


def build_device_id(seed: str = "") -> str:
    """优先复用模板里的 deviceId，避免每次心跳都完全变样。"""
    seed = str(seed or "").strip()
    if seed:
        return seed
    return "c" + "".join([str(random.randint(0, 9)) for _ in range(15)])


def merge_template_headers(cookie: str, read_template: dict | None = None) -> dict:
    """在基础请求头上叠加 reader 模板里捕获到的真实请求头。"""
    headers = get_headers(cookie)
    read_template = read_template or {}
    template_headers = (
        read_template.get("requestHeaders", {})
        if isinstance(read_template.get("requestHeaders"), dict)
        else {}
    )
    for raw_key, raw_value in template_headers.items():
        key = str(raw_key or "").strip()
        if not key:
            continue
        lower_key = key.lower()
        if lower_key in {"cookie", "content-length", "host"}:
            continue
        if raw_value in (None, "", []):
            continue
        headers[key] = str(raw_value)
    return headers


def build_heartbeat_request(
    book_id: str,
    read_info: dict | None = None,
    read_template: dict | None = None,
    device_id: str = "",
) -> tuple[str, str, str, dict]:
    """根据书架进度 + reader 模板构造心跳请求。"""
    read_info = read_info or {}
    read_template = read_template or {}
    template_payload = (
        read_template.get("bodyData", {})
        if isinstance(read_template.get("bodyData"), dict)
        else {}
    )

    heartbeat_seconds = random.randint(55, 65)
    payload = dict(template_payload)
    payload["bookId"] = book_id
    payload["chapterUid"] = coerce_int(
        read_info.get("chapterUid") or payload.get("chapterUid"), 1
    )
    payload["chapterOffset"] = coerce_int(
        read_info.get("chapterOffset") or payload.get("chapterOffset"), 0
    )
    payload["readingTime"] = heartbeat_seconds
    if "readTime" in template_payload:
        payload["readTime"] = heartbeat_seconds
    payload["appId"] = (
        read_info.get("appId") or payload.get("appId") or DEFAULT_APP_ID
    )
    payload["timestamp"] = int(time.time())
    payload["platformId"] = coerce_int(payload.get("platformId"), 3)
    payload["deviceId"] = build_device_id(
        str(payload.get("deviceId") or device_id or "")
    )
    payload["format"] = coerce_int(payload.get("format"), 1)
    payload["fontSize"] = coerce_int(payload.get("fontSize"), 3)
    payload["theme"] = coerce_int(payload.get("theme"), 1)

    method = str(read_template.get("method") or "POST").strip().upper() or "POST"
    url = str(read_template.get("url") or WEREAD_READ_URL).strip() or WEREAD_READ_URL
    body_format = str(read_template.get("bodyFormat") or "").strip().lower()
    if body_format not in {"json", "urlencoded", "formdata"}:
        body_format = "json"

    return method, url, body_format, payload


def get_bookshelf(cookie: str) -> list:
    """获取书架上的书籍列表"""
    headers = get_headers(cookie)
    params = {"synckey": 0, "teenmode": 0, "album": 0, "onlyBookid": 0}
    try:
        resp = requests.get(WEREAD_SHELF_URL, headers=headers, params=params, timeout=15)
        resp.raise_for_status()
        data = resp.json()
        books = normalize_shelf_entries(data)
        logger.info(f"书架共有 {len(books)} 本书")
        return books
    except Exception as e:
        logger.error(f"获取书架失败: {e}")
        return []


def send_read_heartbeat(
    cookie: str,
    book_id: str,
    read_info: dict | None = None,
    read_template: dict | None = None,
    device_id: str = "",
) -> bool:
    """发送阅读心跳请求，模拟翻页阅读行为"""
    headers = merge_template_headers(cookie, read_template)
    method, url, body_format, payload = build_heartbeat_request(
        book_id,
        read_info=read_info,
        read_template=read_template,
        device_id=device_id,
    )
    for attempt in range(MAX_RETRIES):
        try:
            if body_format == "json":
                resp = requests.request(
                    method, url, headers=headers, json=payload, timeout=15
                )
            else:
                request_data = payload
                if body_format == "formdata":
                    request_data = {
                        key: json.dumps(value, ensure_ascii=False)
                        if isinstance(value, (dict, list))
                        else value
                        for key, value in payload.items()
                    }
                resp = requests.request(
                    method, url, headers=headers, data=request_data, timeout=15
                )
            if resp.status_code == 200:
                result = resp.json()
                # succ=1 表示成功
                if result.get("succ") == 1 or "synckey" in result:
                    return True
                else:
                    logger.warning(f"心跳响应异常: {result}")
                    return False
            elif resp.status_code == 401:
                logger.error("Cookie 已过期，请更新 WEREAD_COOKIE")
                sys.exit(1)
            else:
                logger.warning(f"第 {attempt+1} 次请求失败，状态码: {resp.status_code}")
        except requests.RequestException as e:
            logger.warning(f"第 {attempt+1} 次请求异常: {e}")
        time.sleep(5)
    return False


def pick_reading_book(books: list) -> dict | None:
    """从书架中随机挑选一本书"""
    if not books:
        return None
    # 优先挑有真实阅读上下文的书，避免 chapterUid / appId 缺失
    contextual = [
        b for b in books
        if b.get("readInfo", {}).get("chapterUid") and b.get("readInfo", {}).get("appId")
    ]
    pool = contextual if contextual else books
    return max(
        pool,
        key=lambda b: max(
            int(b.get("book", {}).get("readUpdateTime") or 0),
            int(b.get("readInfo", {}).get("updateTime") or 0),
            int(b.get("book", {}).get("updateTime") or 0),
        ),
    )


def run_auto_read(cookie: str):
    """主流程：自动阅读"""
    logger.info(f"=== 微信读书自动阅读开始，目标时长: {READ_DURATION_MINUTES} 分钟 ===")

    books = get_bookshelf(cookie)
    if not books:
        logger.error("书架为空或获取失败，退出")
        sys.exit(1)

    book_info = pick_reading_book(books)
    book_id = book_info.get("_bookId", "")
    book_title = book_info.get("book", {}).get("title", "") or book_id
    read_info = book_info.get("readInfo", {})
    read_template = load_weread_read_template(ROOT_DIR)
    has_template = bool(read_template.get("url"))
    device_id = build_device_id(
        str(
            (read_template.get("bodyData") or {}).get("deviceId")
            if isinstance(read_template.get("bodyData"), dict)
            else ""
        )
    )
    logger.info(f"选定阅读书目: 《{book_title}》(bookId={book_id})")
    if has_template:
        logger.info(
            "已加载 reader 模板: %s %s",
            str(read_template.get("method") or "POST").upper(),
            read_template.get("path") or read_template.get("url", ""),
        )
    else:
        logger.info("未找到 reader 模板，先使用书架进度信息回退发送心跳")

    total_seconds = READ_DURATION_MINUTES * 60
    elapsed = 0
    success_count = 0
    fail_count = 0

    while elapsed < total_seconds:
        interval = random.randint(READ_INTERVAL_MIN, READ_INTERVAL_MAX)
        logger.info(f"发送心跳 | 已累计: {elapsed//60}分{elapsed%60}秒 / {READ_DURATION_MINUTES}分钟")
        ok = send_read_heartbeat(
            cookie,
            book_id,
            read_info,
            read_template=read_template if has_template else None,
            device_id=device_id,
        )
        if ok:
            success_count += 1
            logger.info(f"✅ 心跳成功（第 {success_count} 次）")
        else:
            fail_count += 1
            logger.warning(f"❌ 心跳失败（累计 {fail_count} 次）")
            if fail_count >= 5:
                logger.error("连续失败过多，终止运行")
                break

        if MAX_HEARTBEATS and (success_count + fail_count) >= MAX_HEARTBEATS:
            logger.info(f"达到 MAX_HEARTBEATS={MAX_HEARTBEATS}，提前结束本次运行")
            break

        # 随机加减几秒，使请求更自然
        jitter = random.randint(-5, 5)
        sleep_time = max(30, interval + jitter)
        time.sleep(sleep_time)
        elapsed += sleep_time

    logger.info(
        f"=== 自动阅读结束 | 成功心跳: {success_count} 次 | 失败: {fail_count} 次 | "
        f"实际累计约 {success_count * 60} 秒 ==="
    )


if __name__ == "__main__":
    cookie = load_weread_cookie(ROOT_DIR)
    if not cookie:
        logger.error("请设置环境变量 WEREAD_COOKIE 或准备 .weread_cookie.json")
        sys.exit(1)
    run_auto_read(cookie)
