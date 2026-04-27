#!/usr/bin/env python3
"""
WeChat Reading sync script for GitHub Actions.
Required env vars: WEREAD_COOKIE, API_TOKEN
Optional env var:  CLOUD_BASE_URL (default: https://yangminggu.com/tasks)
"""
import os, sys, json, requests
from datetime import datetime

WEREAD_WEB_BASE  = "https://weread.qq.com"
WEREAD_MOB_BASE  = "https://i.weread.qq.com"
CLOUD_BASE_URL   = os.environ.get("CLOUD_BASE_URL", "https://yangminggu.com/tasks").rstrip("/")
API_TOKEN        = os.environ.get("API_TOKEN", "")
WEREAD_COOKIE    = os.environ.get("WEREAD_COOKIE", "")

BOOK_ACCENTS = ["#2d6a4f", "#4a4a6a", "#6a4a2a", "#3a6a5a", "#5a3a6a"]

def pick_accent(title):
    return BOOK_ACCENTS[sum(ord(c) for c in (title or "")) % len(BOOK_ACCENTS)]

def wr_get(path, params=None, base=WEREAD_WEB_BASE):
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "zh-CN,zh;q=0.9",
        "Cookie": WEREAD_COOKIE,
    }
    resp = requests.get(f"{base}{path}", headers=headers, params=params, timeout=20)
    resp.raise_for_status()
    data = resp.json()
    err = data.get("errCode")
    if err and err != 0:
        raise RuntimeError(f"WeRead errCode={err}: {data.get('errMsg', '')}")
    return data

def ms_to_date(ts):
    if not ts:
        return ""
    try:
        ts_s = ts / 1000 if ts > 10**10 else ts
        return datetime.fromtimestamp(ts_s).strftime("%Y-%m-%d")
    except Exception:
        return ""

def to_ms(ts):
    if not ts:
        return 0
    return ts * 1000 if ts < 10**10 else ts

def sync():
    # 1. 书架
    print("📚 Fetching shelf...")
    shelf = wr_get("/web/shelf/sync")
    books_raw   = shelf.get("books") or []
    progress_map = {
        str(p["bookId"]): p
        for p in (shelf.get("bookProgress") or [])
        if p.get("bookId")
    }
    print(f"   {len(books_raw)} books on shelf")

    # 2. 今日阅读时长
    today_str = datetime.now().strftime("%Y%m%d")
    today_read_map = {}
    try:
        rd = wr_get("/web/book/read", {"synckey": 0, "date": today_str})
        for item in (rd.get("readTimes") or rd.get("items") or []):
            bid  = str(item.get("bookId") or "")
            mins = int(item.get("readingTime") or item.get("duration") or 0) // 60
            if bid and mins > 0:
                today_read_map[bid] = mins
        print(f"   Today reading: {sum(today_read_map.values())} min across {len(today_read_map)} books")
    except Exception as e:
        print(f"   ⚠️  Could not fetch today reading: {e}")

    # 3. 组装书目
    books = []
    for item in books_raw:
        b   = item.get("book", item) if isinstance(item, dict) else {}
        bid = str(b.get("bookId") or "").strip()
        if not bid:
            continue

        prog = progress_map.get(bid, {})
        pct  = max(0, min(100, int(prog.get("progress") or 0)))

        read_ts = to_ms(
            item.get("readUpdateTime") or
            item.get("updateTime") or
            prog.get("updateTime") or
            b.get("updateTime") or 0
        )

        books.append({
            "id":               f"wr_{bid}",
            "_bookId":          bid,
            "source":           "weread",
            "title":            b.get("title", ""),
            "author":           b.get("author", ""),
            "status":           "reading",
            "progressPercent":  pct,
            "readTimestamp":    read_ts,
            "readAt":           ms_to_date(read_ts),
            "todayReadMinutes": today_read_map.get(bid, 0),
            "accent":           pick_accent(b.get("title", "")),
        })

    books.sort(key=lambda b: b.get("readTimestamp") or 0, reverse=True)

    # 4. 拉云端现有数据，保留非微信读书的书
    print("☁️  Fetching cloud data...")
    r = requests.get(
        f"{CLOUD_BASE_URL}/api/data",
        headers={"Authorization": f"Bearer {API_TOKEN}"},
        timeout=15,
    )
    r.raise_for_status()
    cloud = r.json()

    other_books = [b for b in (cloud.get("books") or []) if b.get("source") != "weread"]
    cloud["books"] = other_books + books
    print(f"   Keeping {len(other_books)} non-weread books, merging {len(books)} weread books")

    # 5. 推送
    print("⬆️  Pushing...")
    push = requests.post(
        f"{CLOUD_BASE_URL}/api/data",
        json=cloud,
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {API_TOKEN}"},
        timeout=15,
    )
    push.raise_for_status()
    print(f"✅ Done: {len(books)} weread + {len(other_books)} other = {len(cloud['books'])} total books")
    return len(books)

if __name__ == "__main__":
    missing = [v for v in ("WEREAD_COOKIE", "API_TOKEN") if not os.environ.get(v)]
    if missing:
        print(f"❌ Missing env vars: {', '.join(missing)}")
        sys.exit(1)

    try:
        sync()
    except requests.HTTPError as e:
        status = e.response.status_code if e.response is not None else "?"
        if status == 401:
            print("❌ WeRead cookie expired — update WEREAD_COOKIE secret")
        else:
            print(f"❌ HTTP {status}: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"❌ {e}")
        sys.exit(1)
