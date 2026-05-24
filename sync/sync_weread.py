#!/usr/bin/env python3
"""
WeChat Reading sync via Agent API Gateway — books, notes, heatmap — push to cloud.
Required env vars: WEREAD_API_KEY, API_TOKEN
Optional env vars: CLOUD_BASE_URL (default: https://yangminggu.com/tasks)
"""
import hashlib
import os
import sys
import requests
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


# ── helpers ──────────────────────────────────────────────────────────────────

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

def fmt_ts(ms):
    if not ms: return ""
    try: return datetime.fromtimestamp(ms / 1000 if ms > 10**11 else ms).strftime("%Y-%m-%d %H:%M")
    except: return ""

def make_id(book_id, note_type, *parts):
    norm = "||".join(" ".join(str(p or "").split()) for p in parts if str(p or "").strip())
    digest = hashlib.sha1(f"{book_id}|{note_type}|{norm}".encode()).hexdigest()[:16]
    return f"{book_id}:{note_type}:{digest}"

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

def _brief(d):
    return {
        "baseTime":           coerce_int(d.get("baseTime")),
        "readDays":           coerce_int(d.get("readDays")),
        "totalReadTime":      coerce_int(d.get("totalReadTime")),
        "dayAverageReadTime": coerce_int(d.get("dayAverageReadTime")),
        "compare":            d.get("compare") or 0,
    }


# ── sync ──────────────────────────────────────────────────────────────────────

def sync():
    # 1. 书架
    print("📚 Fetching shelf...")
    shelf = gw("/shelf/sync")
    raw_books = [b for b in (shelf.get("books") or []) if isinstance(b, dict)]
    print(f"   {len(raw_books)} books on shelf")

    # 2. 并发拉阅读进度
    print("📖 Fetching progress...")
    def fetch_progress(book):
        bid = str(book.get("bookId") or "").strip()
        try:
            return bid, gw("/book/getprogress", bookId=bid).get("book") or {}
        except Exception:
            return bid, {}

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
        status  = "finished" if finish else ("want" if not started and pct == 0 else "reading")
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

    # 4. 笔记（划线 + 评论）
    print("📝 Fetching notes...")
    notes = []
    notes_ok = False
    try:
        notebook_books = []
        last_sort = None
        for _ in range(50):
            params = {"count": 100}
            if last_sort:
                params["lastSort"] = last_sort
            nb_data = gw("/user/notebooks", **params)
            page = [b for b in (nb_data.get("books") or []) if isinstance(b, dict)]
            notebook_books.extend(page)
            if not nb_data.get("hasMore") or not page:
                break
            last_sort = coerce_int(page[-1].get("sort"))
            if not last_sort:
                break
        print(f"   {len(notebook_books)} books with notes")

        def fetch_book_notes(nb_book):
            bid   = str(nb_book.get("bookId") or "").strip()
            meta  = nb_book.get("book") if isinstance(nb_book.get("book"), dict) else {}
            title = meta.get("title", "") or str(nb_book.get("title") or "") or bid
            if not bid:
                return []
            try:
                bm = gw("/book/bookmarklist", bookId=bid)
            except Exception:
                return []
            chapter_titles = {
                coerce_int(ch.get("chapterUid")): str(ch.get("title") or "").strip()
                for ch in (bm.get("chapters") or [])
                if isinstance(ch, dict)
            }
            reviews = []
            synckey = 0
            for _ in range(50):
                try:
                    rv = gw("/review/list/mine", bookid=bid, count=100, synckey=synckey)
                except Exception:
                    break
                page_rv = [r for r in (rv.get("reviews") or []) if isinstance(r, dict)]
                reviews.extend(page_rv)
                if not rv.get("hasMore") or not page_rv:
                    break
                next_key = coerce_int(rv.get("synckey"))
                if next_key == synckey:
                    break
                synckey = next_key

            book_notes = []
            seen = set()
            for mark in (bm.get("updated") or []):
                text = " ".join(str(mark.get("markText") or "").split())
                if not text:
                    continue
                ts     = as_ms(mark.get("createTime"))
                ch_uid = coerce_int(mark.get("chapterUid"))
                sid    = make_id(bid, "highlight", mark.get("bookmarkId"), mark.get("range"), ch_uid, text, ts)
                if sid in seen:
                    continue
                seen.add(sid)
                preview = text[:18] + ("..." if len(text) > 18 else "")
                book_notes.append({
                    "source":                 "weread",
                    "title":                  f"《{title}》划线 · {preview}",
                    "tags":                   ["微信读书", "划线"],
                    "summary":                text,
                    "noteType":               "highlight",
                    "bookTitle":              title,
                    "_bookId":                bid,
                    "sourceItemId":           sid,
                    "sourceUpdatedAt":        fmt_ts(ts),
                    "sourceUpdatedTimestamp": ts,
                    "updatedAt":              fmt_date(ts),
                    "chapterTitle":           chapter_titles.get(ch_uid, ""),
                    "chapterUid":             ch_uid,
                    "range":                  str(mark.get("range") or "").strip(),
                    "colorStyle":             coerce_int(mark.get("colorStyle")),
                })
            for rv_item in reviews:
                r       = rv_item.get("review") if isinstance(rv_item.get("review"), dict) else {}
                content = " ".join(str(r.get("content") or "").split())
                if not content:
                    continue
                ts  = as_ms(r.get("createTime"))
                sid = make_id(bid, "review", r.get("reviewId"), r.get("range"), ts, content)
                if sid in seen:
                    continue
                seen.add(sid)
                preview = content[:18] + ("..." if len(content) > 18 else "")
                book_notes.append({
                    "source":                 "weread",
                    "title":                  f"《{title}》评论 · {preview}",
                    "tags":                   ["微信读书", "评论"],
                    "summary":                content,
                    "noteType":               "review",
                    "bookTitle":              title,
                    "_bookId":                bid,
                    "sourceItemId":           sid,
                    "sourceUpdatedAt":        fmt_ts(ts),
                    "sourceUpdatedTimestamp": ts,
                    "updatedAt":              fmt_date(ts),
                    "chapterTitle":           str(r.get("chapterTitle") or r.get("chapterName") or "").strip(),
                    "chapterUid":             coerce_int(r.get("chapterUid")),
                    "range":                  str(r.get("range") or "").strip(),
                })
            return sorted(book_notes, key=lambda n: n.get("sourceUpdatedTimestamp") or 0, reverse=True)

        with ThreadPoolExecutor(max_workers=4) as pool:
            for book_notes in pool.map(fetch_book_notes, notebook_books):
                notes.extend(book_notes)
        notes.sort(key=lambda n: n.get("sourceUpdatedTimestamp") or 0, reverse=True)
        notes_ok = True
        print(f"   {len(notes)} notes total")
    except Exception as e:
        print(f"   ⚠️ 笔记同步失败: {e}")

    # 5. 阅读统计 + 热力图（18 周每日数据，并发拉取）
    print("📊 Fetching reading stats + heatmap (18 weeks)...")
    week_read_minutes = 0
    week_read_daily   = {}
    total_read_days   = 0
    weread_stats      = {"monthly": {}, "annual": {}, "overall": {}, "dailyReadTimes": []}
    stats_ok          = False
    try:
        monthly_data = gw("/readdata/detail", mode="monthly")
        overall_data = gw("/readdata/detail", mode="overall")
        annual_data  = gw("/readdata/detail", mode="annually")

        now_ts       = int(datetime.now().timestamp())
        week_offsets = [i * 7 * 86400 for i in range(18)]

        def fetch_week(offset):
            try:
                return gw("/readdata/detail", mode="weekly", baseTime=now_ts - offset).get("readTimes") or {}
            except Exception:
                return {}

        daily_map = {}
        with ThreadPoolExecutor(max_workers=6) as pool:
            for rt in pool.map(fetch_week, week_offsets):
                for ts_str, secs in rt.items():
                    ts       = int(ts_str)
                    date_str = datetime.fromtimestamp(ts).strftime("%Y-%m-%d")
                    daily_map[date_str] = max(daily_map.get(date_str, 0), coerce_int(secs))

        daily_list = sorted(
            [{"date": d, "timestamp": int(datetime.strptime(d, "%Y-%m-%d").timestamp()), "seconds": s}
             for d, s in daily_map.items()],
            key=lambda x: x["date"],
        )

        current_month = datetime.now().strftime("%Y-%m")
        for item in daily_list:
            if item["date"].startswith(current_month) and item["seconds"] > 0:
                week_read_daily[str(item["timestamp"])] = round(item["seconds"] / 60)
        week_read_minutes = sum(week_read_daily.values())
        total_read_days   = coerce_int(overall_data.get("readDays")) or coerce_int(monthly_data.get("readDays"))

        weread_stats = {
            "monthly":        _brief(monthly_data),
            "annual":         _brief(annual_data),
            "overall":        _brief(overall_data),
            "dailyReadTimes": daily_list,
        }
        stats_ok = True
        print(f"   热力图 {len(daily_list)} 天  本月 {week_read_minutes} 分钟  累计 {total_read_days} 天")
    except Exception as e:
        print(f"   ⚠️ 统计数据跳过: {e}")

    # 6. 拉云端现有数据、合并、推送
    print("☁️  Syncing to cloud...")
    cloud_headers = {"Authorization": f"Bearer {API_TOKEN}", "Content-Type": "application/json"}
    r = requests.get(f"{CLOUD_BASE_URL}/api/data", headers=cloud_headers, timeout=15)
    r.raise_for_status()
    cloud = r.json()

    # 保留非 weread 的 books / notes / updates
    other_books   = [b for b in (cloud.get("books")   or []) if b.get("source")  != "weread"]
    other_notes   = [n for n in (cloud.get("notes")   or []) if n.get("source")  != "weread"]
    other_updates = [u for u in (cloud.get("updates") or []) if u.get("type")    != "weread"]

    # dailyReadTimes：把云端已有的历史和本次新拉的合并（新数据覆盖同日旧数据）
    existing_daily = {
        item["date"]: item
        for item in (cloud.get("wereadStats", {}).get("dailyReadTimes") or [])
        if item.get("date")
    }
    for item in weread_stats["dailyReadTimes"]:
        existing_daily[item["date"]] = item
    weread_stats["dailyReadTimes"] = sorted(existing_daily.values(), key=lambda x: x["date"])

    # 笔记获取失败时，回退到云端已有 weread 笔记，避免清空
    if not notes_ok:
        cloud_weread_notes = [n for n in (cloud.get("notes") or []) if n.get("source") == "weread"]
        notes = cloud_weread_notes
        print(f"   ℹ️ 笔记获取失败，保留云端现有 {len(notes)} 条 weread 笔记")

    # 统计获取失败时，回退到云端已有数据，避免覆盖成空值
    if not stats_ok:
        week_read_minutes = cloud.get("weekReadMinutes", 0)
        week_read_daily   = cloud.get("weekReadDaily", {})
        total_read_days   = cloud.get("totalReadDays", 0)
        prev_stats        = cloud.get("wereadStats") or {}
        weread_stats = {
            "monthly":        prev_stats.get("monthly", {}),
            "annual":         prev_stats.get("annual", {}),
            "overall":        prev_stats.get("overall", {}),
            "dailyReadTimes": weread_stats["dailyReadTimes"],  # 已合并云端历史
        }
        print("   ℹ️ 统计获取失败，保留云端现有数据")

    synced_at = datetime.now().isoformat(timespec="seconds")
    updates = [
        {
            "id":      int(datetime.now().timestamp() * 1000) + idx,
            "type":    "weread",
            "text":    note["title"],
            "preview": note.get("summary", "")[:40],
            "time":    "刚刚",
        }
        for idx, note in enumerate(notes[:4])
    ] or [{
        "id":      int(datetime.now().timestamp() * 1000),
        "type":    "weread",
        "text":    f"微信读书同步：{len(books)} 本书，{len(notes)} 条笔记",
        "preview": "",
        "time":    "刚刚",
    }]

    cloud.update({
        "books":           other_books + books,
        "notes":           other_notes + notes,
        "updates":         other_updates + updates,
        "weekReadMinutes": week_read_minutes,
        "weekReadDaily":   week_read_daily,
        "totalReadDays":   total_read_days,
        "wereadStats":     weread_stats,
        "wereadSyncedAt":  synced_at,
    })

    push = requests.post(f"{CLOUD_BASE_URL}/api/data", json=cloud, headers=cloud_headers, timeout=30)
    push.raise_for_status()
    print(
        f"✅ Done: {len(books)} books  {len(notes)} notes  "
        f"热力图 {len(weread_stats['dailyReadTimes'])} 天  "
        f"(非weread: {len(other_books)} books / {len(other_notes)} notes)"
    )
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
