#!/usr/bin/env python3
"""
WeChat Reading sync via Agent API Gateway (WEREAD_API_KEY, no cookie).
Required: WEREAD_API_KEY, API_TOKEN
Optional: CLOUD_BASE_URL (default: https://yangminggu.com/tasks)
"""
import os, sys, requests
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path

_env = Path(__file__).parent / ".env"
if _env.exists():
    for _line in _env.read_text().splitlines():
        _line = _line.strip()
        if _line and not _line.startswith("#") and "=" in _line:
            _k, _, _v = _line.partition("=")
            os.environ.setdefault(_k.strip(), _v.strip())

GATEWAY_URL    = "https://i.weread.qq.com/api/agent/gateway"
SKILL_VERSION  = "1.0.3"
CLOUD_BASE_URL = os.environ.get("CLOUD_BASE_URL", "https://yangminggu.com/tasks").rstrip("/")
API_TOKEN      = os.environ.get("API_TOKEN", "")
WEREAD_API_KEY = os.environ.get("WEREAD_API_KEY", "")
BOOK_ACCENTS   = ["#2d6a4f", "#4a4a6a", "#6a4a2a", "#3a6a5a", "#5a3a6a"]


def pick_accent(title):
    return BOOK_ACCENTS[sum(ord(c) for c in (title or "")) % len(BOOK_ACCENTS)]

def coerce_int(v, default=0):
    try: return int(v or 0)
    except: return default

def as_ms(v):
    n = coerce_int(v)
    if n <= 0: return 0
    return n * 1000 if n < 10**11 else n

def fmt_date(ms):
    if not ms: return ""
    try: return datetime.fromtimestamp(ms / 1000 if ms > 10**11 else ms).strftime("%Y-%m-%d")
    except: return ""

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

def fetch_progress(book):
    bid = str(book.get("bookId") or "").strip()
    try:
        return bid, gw("/book/getprogress", bookId=bid).get("book") or {}
    except Exception:
        return bid, {}

def sync():
    # 1. 书架
    print("📚 Fetching shelf...")
    shelf = gw("/shelf/sync")
    raw_books = [b for b in (shelf.get("books") or []) if isinstance(b, dict)]
    print(f"   {len(raw_books)} books on shelf")

    # 2. 并发拉阅读进度
    print("📖 Fetching progress...")
    progress_map = {}
    with ThreadPoolExecutor(max_workers=6) as pool:
        for bid, prog in pool.map(fetch_progress, raw_books):
            if bid:
                progress_map[bid] = prog

    # 3. 组装书目
    books = []
    for item in raw_books:
        bid = str(item.get("bookId") or "").strip()
        if not bid:
            continue
        prog    = progress_map.get(bid, {})
        pct     = max(0, min(100, coerce_int(prog.get("progress"))))
        read_ts = as_ms(prog.get("updateTime") or item.get("readUpdateTime") or item.get("updateTime"))
        finish  = pct >= 100 or coerce_int(item.get("finishReading")) == 1
        started = bool(coerce_int(prog.get("isStartReading")))

        if finish:
            status = "finished"
        elif not started and pct == 0:
            status = "want"
        else:
            status = "reading"

        books.append({
            "id":               f"wr_{bid}",
            "_bookId":          bid,
            "source":           "weread",
            "title":            item.get("title", ""),
            "author":           item.get("author", ""),
            "cover":            item.get("cover", ""),
            "status":           status,
            "progressPercent":  pct,
            "readTimestamp":    read_ts,
            "readAt":           fmt_date(read_ts),
            "todayReadMinutes": 0,
            "accent":           pick_accent(item.get("title", "")),
        })
    books.sort(key=lambda b: b.get("readTimestamp") or 0, reverse=True)
    reading = sum(1 for b in books if b["status"] == "reading")
    want    = sum(1 for b in books if b["status"] == "want")
    done    = sum(1 for b in books if b["status"] == "finished")
    print(f"   在读 {reading}  想读 {want}  读完 {done}")

    # 4. 本周阅读统计
    print("📊 Fetching weekly reading stats...")
    try:
        week = gw("/readdata/detail", mode="weekly")
        week_read_minutes = coerce_int(week.get("totalReadTime")) // 60
        week_read_daily   = {
            str(k): coerce_int(v) // 60
            for k, v in (week.get("readTimes") or {}).items()
        }
        print(f"   本周阅读: {week_read_minutes} 分钟")
    except Exception as e:
        print(f"   ⚠️ 本周统计跳过: {e}")
        week_read_minutes = 0
        week_read_daily   = {}

    # 5. 拉云端、合并、推送
    print("☁️  Syncing to cloud...")
    r = requests.get(
        f"{CLOUD_BASE_URL}/api/data",
        headers={"Authorization": f"Bearer {API_TOKEN}"},
        timeout=15,
    )
    r.raise_for_status()
    cloud = r.json()

    other_books = [b for b in (cloud.get("books") or []) if b.get("source") != "weread"]
    cloud["books"]           = other_books + books
    cloud["weekReadMinutes"] = week_read_minutes
    cloud["weekReadDaily"]   = week_read_daily

    push = requests.post(
        f"{CLOUD_BASE_URL}/api/data",
        json=cloud,
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {API_TOKEN}"},
        timeout=15,
    )
    push.raise_for_status()
    print(f"✅ Done: {len(books)} weread + {len(other_books)} other = {len(cloud['books'])} total, 本周 {week_read_minutes} 分钟")
    return len(books)


if __name__ == "__main__":
    missing = [n for n, v in [("WEREAD_API_KEY", WEREAD_API_KEY), ("API_TOKEN", API_TOKEN)] if not v]
    if missing:
        print(f"❌ Missing env vars: {', '.join(missing)}")
        sys.exit(1)
    try:
        sync()
    except requests.HTTPError as e:
        status = e.response.status_code if e.response is not None else "?"
        print(f"❌ HTTP {status}: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"❌ {e}")
        sys.exit(1)
