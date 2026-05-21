"""Storage and normalization helpers for local app data."""

from __future__ import annotations

from datetime import datetime, timedelta
import json
import math
import os

from services.config import BACKUP_DIR, BOOK_ACCENTS, DATA_FILE, DIARY_FILE, TIME_FILE, WEREAD_DATA_FILE, WEREAD_NOTES_FILE


def load_json_file(path, default):
    if not os.path.exists(path):
        return default
    try:
        with open(path, encoding="utf-8") as handle:
            return json.load(handle)
    except Exception:
        return default


def write_json_file(path, data, mode=None):
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(data, handle, ensure_ascii=False, indent=2)
    if mode is not None:
        try:
            os.chmod(path, mode)
        except OSError:
            pass


def backup_file(path, prefix, keep=20):
    if not os.path.exists(path):
        return
    os.makedirs(BACKUP_DIR, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    target = os.path.join(BACKUP_DIR, f"{prefix}-{stamp}.json")
    with open(path, encoding="utf-8") as src, open(target, "w", encoding="utf-8") as dst:
        dst.write(src.read())

    backups = sorted(
        [
            os.path.join(BACKUP_DIR, name)
            for name in os.listdir(BACKUP_DIR)
            if name.startswith(prefix + "-") and name.endswith(".json")
        ],
        reverse=True,
    )
    for stale in backups[keep:]:
        try:
            os.remove(stale)
        except OSError:
            pass


def load_base_app_data():
    data = load_json_file(DATA_FILE, {})
    return data if isinstance(data, dict) else {}


def write_base_app_data(data):
    backup_file(DATA_FILE, "data")
    write_json_file(DATA_FILE, data)


def empty_diary():
    return {"today": {"date": "", "content": ""}, "archive": []}


def _coerce_diary_view_count(value):
    try:
        return max(0, int(value))
    except (TypeError, ValueError):
        return 0


def _clean_diary_content(text: str) -> str:
    import re as _re

    if not text:
        return ""
    text = _re.sub(r"Your browser does not support the (video|audio) tag\.?", "", text, flags=_re.IGNORECASE)
    text = _re.sub(r"\d{1,2}:\d{2}\s*", "", text)
    if "\n\n---\n" in text:
        text = text.split("\n\n---\n")[0]
    return text.strip()


def _normalize_diary_archive_entry(entry):
    if not isinstance(entry, dict):
        return None
    date = str(entry.get("date", "")).strip()
    if not date:
        return None
    return {
        **entry,
        "date": date,
        "content": str(entry.get("content", "")),
        "viewCount": _coerce_diary_view_count(entry.get("viewCount")),
        "lastViewedAt": str(entry.get("lastViewedAt", "")).strip(),
    }


def _merge_diary_archive_entry(left, right):
    normalized_left = _normalize_diary_archive_entry(left)
    normalized_right = _normalize_diary_archive_entry(right)
    primary = normalized_left or normalized_right
    secondary = normalized_right if normalized_left else None
    if not primary:
        return None
    if not secondary:
        return primary

    left_content = _clean_diary_content(primary.get("content", ""))
    right_content = _clean_diary_content(secondary.get("content", ""))
    content = right_content if len(right_content) > len(left_content) else left_content
    last_viewed_at = max(str(primary.get("lastViewedAt", "") or ""), str(secondary.get("lastViewedAt", "") or ""))
    return {
        **primary,
        "date": primary.get("date") or secondary.get("date") or "",
        "content": content,
        "viewCount": max(
            _coerce_diary_view_count(primary.get("viewCount")),
            _coerce_diary_view_count(secondary.get("viewCount")),
        ),
        "lastViewedAt": last_viewed_at,
    }


def _normalize_diary(diary):
    if not isinstance(diary, dict):
        return empty_diary()
    today = diary.get("today") if isinstance(diary.get("today"), dict) else {}
    archive = [
        normalized
        for normalized in (_normalize_diary_archive_entry(entry) for entry in (diary.get("archive") or []))
        if normalized
    ]
    return {
        "today": {
            **today,
            "date": str(today.get("date", "")).strip(),
            "content": str(today.get("content", "")),
        },
        "archive": archive,
    }


def load_diary_file():
    return _normalize_diary(load_json_file(DIARY_FILE, empty_diary()))


def write_diary_file(diary):
    backup_file(DIARY_FILE, "diary")
    write_json_file(DIARY_FILE, _normalize_diary(diary))


def empty_time_data():
    return {}


def normalize_time_data(data):
    payload = data if isinstance(data, dict) else {}
    result = dict(payload)
    if "weread" in result:
        weread = result.get("weread") if isinstance(result.get("weread"), dict) else {}
        result["weread"] = {
            "source": "weread",
            "syncedAt": str(weread.get("syncedAt", "")).strip(),
            "monthly": normalize_weread_stats({"monthly": weread.get("monthly")}).get("monthly", {}),
            "annual": normalize_weread_stats({"annual": weread.get("annual")}).get("annual", {}),
            "overall": normalize_weread_stats({"overall": weread.get("overall")}).get("overall", {}),
            "dailyReadTimes": normalize_weread_stats({"dailyReadTimes": weread.get("dailyReadTimes")}).get("dailyReadTimes", []),
            "weekReadDaily": weread.get("weekReadDaily") if isinstance(weread.get("weekReadDaily"), dict) else {},
            "weekReadMinutes": coerce_int_id(weread.get("weekReadMinutes")),
            "totalReadDays": coerce_int_id(weread.get("totalReadDays")),
        }
    return result


def load_time_data():
    return normalize_time_data(load_json_file(TIME_FILE, empty_time_data()))


def write_time_data(data):
    backup_file(TIME_FILE, "time")
    write_json_file(TIME_FILE, normalize_time_data(data))


def effective_diary_date():
    now = datetime.now()
    if now.hour < 5:
        return (now - timedelta(days=1)).date().isoformat()
    return now.date().isoformat()


def archive_diary_if_needed(diary=None):
    today_str = effective_diary_date()
    if diary is None:
        diary = load_diary_file()
    diary = _normalize_diary(diary)
    today = diary["today"]
    archive = diary["archive"]

    existing_date = today.get("date", "")
    if existing_date and existing_date != today_str:
        if today.get("content", "").strip():
            archived_today = _normalize_diary_archive_entry(today)
            archive = sorted([*archive, archived_today] if archived_today else archive, key=lambda item: item.get("date", ""))
        today = {"date": today_str, "content": ""}
    elif not existing_date:
        today = {"date": today_str, "content": ""}

    return {"today": today, "archive": archive}


def merge_diary(local_diary: dict, cloud_diary: dict) -> dict:
    local_diary = _normalize_diary(local_diary)
    cloud_diary = _normalize_diary(cloud_diary)

    local_today = local_diary["today"]
    cloud_today = cloud_diary["today"]
    local_clean = _clean_diary_content(str(local_today.get("content", "")))
    cloud_clean = _clean_diary_content(str(cloud_today.get("content", "")))
    if len(cloud_clean) > len(local_clean):
        merged_today = {**cloud_today, "content": cloud_clean}
    else:
        merged_today = {**local_today, "content": local_clean} if local_clean else {**cloud_today, "content": cloud_clean}

    archive_map = {}
    for entry in local_diary["archive"]:
        if entry.get("date"):
            archive_map[entry["date"]] = _merge_diary_archive_entry(entry, {**entry, "content": _clean_diary_content(entry.get("content", ""))})
    for entry in cloud_diary["archive"]:
        date = entry.get("date")
        if not date:
            continue
        archive_map[date] = _merge_diary_archive_entry(
            archive_map.get(date),
            {**entry, "content": _clean_diary_content(entry.get("content", ""))},
        )

    valid = {
        date: _normalize_diary_archive_entry(entry)
        for date, entry in archive_map.items()
        if entry and entry.get("content", "").strip()
    }
    return {"today": merged_today, "archive": sorted([entry for entry in valid.values() if entry], key=lambda item: item.get("date", ""))}


def empty_weread_notes_data():
    return {
        "notes": [],
        "meta": {
            "fullSyncCompleted": False,
            "lastFullSyncAt": "",
            "lastIncrementalSyncAt": "",
            "bookStates": {},
        },
    }


def empty_weread_stats():
    return {
        "monthly": {"baseTime": 0, "readDays": 0, "totalReadTime": 0, "dayAverageReadTime": 0, "compare": 0},
        "annual": {"baseTime": 0, "readDays": 0, "totalReadTime": 0, "dayAverageReadTime": 0, "compare": 0},
        "overall": {"baseTime": 0, "readDays": 0, "totalReadTime": 0, "dayAverageReadTime": 0, "compare": 0},
        "dailyReadTimes": [],
    }


def empty_weread_data():
    return {"books": [], "notes": [], "updates": [], "stats": empty_weread_stats(), "syncedAt": ""}


def coerce_int_id(value):
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def has_tag(tags, name):
    return isinstance(tags, list) and name in tags


def is_weread_book(book):
    return isinstance(book, dict) and (book.get("source") == "weread" or bool(book.get("_bookId")))


def is_weread_note(note):
    return isinstance(note, dict) and (note.get("source") == "weread" or has_tag(note.get("tags"), "微信读书"))


def is_weread_update(item):
    return isinstance(item, dict) and item.get("type") == "weread"


def pick_book_accent(seed=""):
    score = sum(ord(ch) for ch in seed)
    return BOOK_ACCENTS[score % len(BOOK_ACCENTS)]


def normalize_weread_book(book):
    item = dict(book)
    item["source"] = "weread"
    item["title"] = item.get("title", "")
    item["author"] = item.get("author", "")
    item["status"] = item.get("status") or "reading"
    item["accent"] = item.get("accent") or pick_book_accent(item.get("title", ""))
    item["notes"] = item.get("notes") or ""
    item["progressPercent"] = int(item.get("progressPercent") or 0)
    item["chapterIndex"] = int(item.get("chapterIndex") or 0)
    item["chapterCount"] = int(item.get("chapterCount") or 0)
    item["estimatedCurrentPage"] = int(item.get("estimatedCurrentPage") or 0)
    item["estimatedTotalPage"] = int(item.get("estimatedTotalPage") or 0)
    item["pageSource"] = item.get("pageSource") or ""
    item["isbn"] = item.get("isbn") or ""
    item["totalWords"] = int(item.get("totalWords") or 0)
    return item


def normalize_weread_note(note):
    item = dict(note)
    item["source"] = "weread"
    item["title"] = item.get("title", "")
    item["summary"] = item.get("summary", "")
    item["tags"] = [tag for tag in (item.get("tags") or []) if tag]
    item["bookTitle"] = item.get("bookTitle", "")
    item["_bookId"] = str(item.get("_bookId", "")).strip()
    item["noteType"] = item.get("noteType", "")
    item["sourceItemId"] = str(item.get("sourceItemId", "")).strip()
    item["sourceUpdatedAt"] = item.get("sourceUpdatedAt", "")
    item["sourceUpdatedTimestamp"] = coerce_int_id(item.get("sourceUpdatedTimestamp"))
    item["projectId"] = item.get("projectId") if item.get("projectId") not in ("", None) else None
    src_date = (item["sourceUpdatedAt"] or "")[:10]
    if src_date:
        item["updatedAt"] = src_date
    return item


def normalize_weread_update(item):
    update = dict(item)
    update["type"] = "weread"
    update["text"] = update.get("text", "微信读书同步")
    update["preview"] = update.get("preview", "")
    update["time"] = update.get("time", "刚刚")
    return update


def normalize_weread_stats(stats):
    payload = stats if isinstance(stats, dict) else {}

    def _normalize_brief(section):
        item = section if isinstance(section, dict) else {}
        compare = item.get("compare")
        if not isinstance(compare, (int, float)):
            compare = 0
        return {
            "baseTime": coerce_int_id(item.get("baseTime")),
            "readDays": coerce_int_id(item.get("readDays")),
            "totalReadTime": coerce_int_id(item.get("totalReadTime")),
            "dayAverageReadTime": coerce_int_id(item.get("dayAverageReadTime")),
            "compare": compare,
        }

    daily_read_times = []
    for item in payload.get("dailyReadTimes") or []:
        if not isinstance(item, dict):
            continue
        date = str(item.get("date", "")).strip()
        seconds = coerce_int_id(item.get("seconds"))
        if not date or seconds < 0:
            continue
        daily_read_times.append(
            {
                "date": date,
                "timestamp": coerce_int_id(item.get("timestamp")),
                "seconds": seconds,
            }
        )

    daily_read_times.sort(key=lambda item: item.get("date", ""))
    return {
        "monthly": _normalize_brief(payload.get("monthly")),
        "annual": _normalize_brief(payload.get("annual")),
        "overall": _normalize_brief(payload.get("overall")),
        "dailyReadTimes": daily_read_times,
    }


def has_weread_stats(stats):
    payload = normalize_weread_stats(stats)
    if payload.get("dailyReadTimes"):
        return True
    for key in ("monthly", "annual", "overall"):
        section = payload.get(key) or {}
        if any(coerce_int_id(section.get(field)) > 0 for field in ("baseTime", "readDays", "totalReadTime", "dayAverageReadTime")):
            return True
        compare = section.get("compare")
        if isinstance(compare, (int, float)) and compare != 0:
            return True
    return False


def _timestamp_seconds_for_date(date_key):
    try:
        return int(datetime.strptime(date_key, "%Y-%m-%d").timestamp())
    except (TypeError, ValueError, OSError):
        return 0


def derive_weread_time_fields(stats):
    payload = normalize_weread_stats(stats)
    current_month = datetime.now().strftime("%Y-%m")
    week_read_daily = {}
    daily_read_times = []

    for item in payload.get("dailyReadTimes") or []:
        date_key = str(item.get("date", "")).strip()
        seconds = max(0, coerce_int_id(item.get("seconds")))
        timestamp = coerce_int_id(item.get("timestamp"))
        if timestamp > 10**11:
            timestamp = timestamp // 1000
        if not timestamp and date_key:
            timestamp = _timestamp_seconds_for_date(date_key)
        minutes = round(seconds / 60)
        daily_read_times.append({**item, "timestamp": timestamp, "seconds": seconds, "minutes": minutes})
        if date_key.startswith(current_month) and minutes > 0 and timestamp:
            week_read_daily[str(timestamp)] = minutes

    week_read_minutes = sum(week_read_daily.values())
    total_read_days = (
        coerce_int_id(payload.get("overall", {}).get("readDays"))
        or coerce_int_id(payload.get("annual", {}).get("readDays"))
        or coerce_int_id(payload.get("monthly", {}).get("readDays"))
    )
    return {
        "weekReadDaily": week_read_daily,
        "weekReadMinutes": week_read_minutes,
        "totalReadDays": total_read_days,
        "dailyReadTimes": daily_read_times,
    }


def build_weread_time_data(stats, synced_at=""):
    payload = normalize_weread_stats(stats)
    derived = derive_weread_time_fields(payload)
    return {
        "source": "weread",
        "syncedAt": str(synced_at or "").strip(),
        "monthly": payload.get("monthly", {}),
        "annual": payload.get("annual", {}),
        "overall": payload.get("overall", {}),
        "dailyReadTimes": derived["dailyReadTimes"],
        "weekReadDaily": derived["weekReadDaily"],
        "weekReadMinutes": derived["weekReadMinutes"],
        "totalReadDays": derived["totalReadDays"],
    }


def merge_time_data(existing, weread_stats, weread_synced_at=""):
    payload = dict(existing) if isinstance(existing, dict) else {}
    payload["weread"] = build_weread_time_data(weread_stats, weread_synced_at)
    return payload


def normalize_weread_data(data):
    payload = data if isinstance(data, dict) else {}
    return {
        "books": [normalize_weread_book(item) for item in (payload.get("books") or []) if isinstance(item, dict)],
        "notes": [normalize_weread_note(item) for item in (payload.get("notes") or []) if isinstance(item, dict)],
        "updates": [normalize_weread_update(item) for item in (payload.get("updates") or []) if isinstance(item, dict)],
        "stats": normalize_weread_stats(payload.get("stats")),
        "syncedAt": str(payload.get("syncedAt", "")).strip(),
    }


def normalize_weread_notes_data(data):
    payload = data if isinstance(data, dict) else {}
    meta = payload.get("meta") if isinstance(payload.get("meta"), dict) else {}
    raw_states = meta.get("bookStates") if isinstance(meta.get("bookStates"), dict) else {}
    book_states = {}
    for key, value in raw_states.items():
        if not isinstance(value, dict):
            continue
        book_states[str(key)] = {
            "lastSourceSignal": coerce_int_id(value.get("lastSourceSignal")),
            "lastSyncedAt": str(value.get("lastSyncedAt", "")).strip(),
        }
    return {
        "notes": [normalize_weread_note(item) for item in (payload.get("notes") or []) if isinstance(item, dict)],
        "meta": {
            "fullSyncCompleted": bool(meta.get("fullSyncCompleted")),
            "lastFullSyncAt": str(meta.get("lastFullSyncAt", "")).strip(),
            "lastIncrementalSyncAt": str(meta.get("lastIncrementalSyncAt", "")).strip(),
            "bookStates": book_states,
        },
    }


def load_weread_data():
    return normalize_weread_data(load_json_file(WEREAD_DATA_FILE, empty_weread_data()))


def write_weread_data(data):
    backup_file(WEREAD_DATA_FILE, "weread-data")
    payload = normalize_weread_data(data)
    payload["notes"] = []
    write_json_file(WEREAD_DATA_FILE, payload)


def load_weread_notes_data():
    return normalize_weread_notes_data(load_json_file(WEREAD_NOTES_FILE, empty_weread_notes_data()))


def write_weread_notes_data(data):
    backup_file(WEREAD_NOTES_FILE, "weread-notes")
    write_json_file(WEREAD_NOTES_FILE, normalize_weread_notes_data(data))


def has_weread_notes_content(data):
    return bool(normalize_weread_notes_data(data).get("notes"))


def has_weread_content(data):
    payload = normalize_weread_data(data)
    return any(payload[key] for key in ("books", "notes", "updates"))


def extract_note_preview(summary=""):
    for line in summary.splitlines():
        line = line.lstrip("📌💭").strip()
        if line:
            return line
    return "已同步到笔记与文档"


def estimate_total_pages(total_words):
    words = coerce_int_id(total_words)
    if words <= 0:
        return 0
    return max(1, math.ceil(words / 500))


def estimate_current_page(progress_percent, total_pages):
    total = coerce_int_id(total_pages)
    progress = max(0, min(100, coerce_int_id(progress_percent)))
    if total <= 0 or progress <= 0:
        return 0
    return min(total, max(1, round(total * progress / 100)))


def split_combined_payload(data):
    payload = data if isinstance(data, dict) else {}
    tasks = [item for item in (payload.get("tasks") or []) if isinstance(item, dict)]
    books = [item for item in (payload.get("books") or []) if isinstance(item, dict)]
    notes = [item for item in (payload.get("notes") or []) if isinstance(item, dict)]
    updates = [item for item in (payload.get("updates") or []) if isinstance(item, dict)]
    special_keys = {"books", "notes", "updates", "wereadStats", "wereadSyncedAt", "weekReadDaily", "weekReadMinutes", "totalReadDays", "time"}

    user_data = {
        **{key: value for key, value in payload.items() if key not in special_keys},
        "tasks": tasks,
        "books": [dict(item) for item in books if not is_weread_book(item)],
        "notes": [dict(item) for item in notes if not is_weread_note(item)],
        "updates": [dict(item) for item in updates if not is_weread_update(item)],
    }
    weread_data = normalize_weread_data(
        {
            "books": [item for item in books if is_weread_book(item)],
            "notes": [],
            "updates": [item for item in updates if is_weread_update(item)],
            "stats": payload.get("wereadStats"),
            "syncedAt": payload.get("wereadSyncedAt", ""),
        }
    )
    weread_notes_data = normalize_weread_notes_data({"notes": [item for item in notes if is_weread_note(item)]})
    return user_data, weread_data, weread_notes_data


def allocate_id(used_ids, preferred=0):
    if preferred and preferred not in used_ids:
        used_ids.add(preferred)
        return preferred
    next_id = max([0] + list(used_ids)) + 1
    while next_id in used_ids:
        next_id += 1
    used_ids.add(next_id)
    return next_id


def merge_weread_store(existing, incoming):
    base = normalize_weread_data(existing)
    fresh = normalize_weread_data(incoming)

    base_books = [dict(item) for item in base["books"]]
    book_ids = {coerce_int_id(item.get("id")) for item in base_books if coerce_int_id(item.get("id"))}
    books = []
    for wb in fresh["books"]:
        existing_book = next(
            (book for book in base_books if (wb.get("_bookId") and book.get("_bookId") == wb.get("_bookId")) or book.get("title") == wb.get("title")),
            None,
        )
        item = normalize_weread_book({**(existing_book or {}), **wb, "id": (existing_book or {}).get("id") or wb.get("id")})
        item["id"] = allocate_id(book_ids, coerce_int_id(item.get("id")))
        books.append(item)

    remaining_notes = [dict(item) for item in base["notes"]]
    note_ids = {coerce_int_id(item.get("id")) for item in remaining_notes if coerce_int_id(item.get("id"))}
    notes = []
    for wn in fresh["notes"]:
        idx = next(
            (
                i
                for i, note in enumerate(remaining_notes)
                if (wn.get("_bookId") and note.get("_bookId") == wn.get("_bookId") and note.get("title") == wn.get("title"))
                or note.get("title") == wn.get("title")
            ),
            -1,
        )
        existing_note = remaining_notes.pop(idx) if idx >= 0 else {}
        item = normalize_weread_note({**existing_note, **wn, "id": existing_note.get("id") or wn.get("id")})
        item["id"] = allocate_id(note_ids, coerce_int_id(item.get("id")))
        notes.append(item)

    for note in remaining_notes:
        item = normalize_weread_note(note)
        item["id"] = allocate_id(note_ids, coerce_int_id(item.get("id")))
        notes.append(item)

    updates = []
    seen_updates = set()
    update_ids = set()
    for item in [*fresh["updates"], *base["updates"]]:
        update = normalize_weread_update(item)
        key = (update.get("text", ""), update.get("preview", ""))
        if key in seen_updates:
            continue
        seen_updates.add(key)
        update["id"] = allocate_id(update_ids, coerce_int_id(update.get("id")))
        updates.append(update)
        if len(updates) >= 8:
            break

    stats = fresh.get("stats") if has_weread_stats(fresh.get("stats")) else base.get("stats")
    if not has_weread_stats(stats):
        stats = fresh.get("stats") or base.get("stats") or empty_weread_stats()

    return {
        "books": books,
        "notes": notes,
        "updates": updates,
        "stats": stats,
        "syncedAt": fresh.get("syncedAt") or base.get("syncedAt", ""),
    }


def merge_weread_notes_store(existing, incoming):
    base = normalize_weread_notes_data(existing)
    fresh = normalize_weread_notes_data(incoming)

    remaining = [dict(item) for item in base["notes"]]
    note_ids = {coerce_int_id(item.get("id")) for item in remaining if coerce_int_id(item.get("id"))}
    notes = []
    for rn in fresh["notes"]:
        idx = next(
            (
                i
                for i, note in enumerate(remaining)
                if (rn.get("sourceItemId") and note.get("sourceItemId") == rn.get("sourceItemId"))
                or (coerce_int_id(note.get("id")) and coerce_int_id(note.get("id")) == coerce_int_id(rn.get("id")))
                or (note.get("_bookId") == rn.get("_bookId") and note.get("title") == rn.get("title") and note.get("summary") == rn.get("summary"))
            ),
            -1,
        )
        existing_note = remaining.pop(idx) if idx >= 0 else {}
        item = normalize_weread_note({**existing_note, **rn, "id": existing_note.get("id") or rn.get("id")})
        item["id"] = allocate_id(note_ids, coerce_int_id(item.get("id")))
        notes.append(item)

    for note in remaining:
        item = normalize_weread_note(note)
        item["id"] = allocate_id(note_ids, coerce_int_id(item.get("id")))
        notes.append(item)

    return {
        "notes": notes,
        "meta": {
            **base.get("meta", {}),
            **fresh.get("meta", {}),
            "bookStates": fresh.get("meta", {}).get("bookStates") or base.get("meta", {}).get("bookStates", {}),
        },
    }


def merge_app_and_special_data(data, weread, weread_notes_data, time_data=None):
    payload = data if isinstance(data, dict) else {}
    weread_payload = normalize_weread_data(weread)
    weread_notes_payload = normalize_weread_notes_data(weread_notes_data)
    weread_stats = weread_payload.get("stats") or empty_weread_stats()
    weread_synced_at = weread_payload.get("syncedAt", "")
    weread_time = derive_weread_time_fields(weread_stats)
    existing_time = normalize_time_data(time_data if isinstance(time_data, dict) else payload.get("time"))

    user_books = [dict(item) for item in (payload.get("books") or []) if isinstance(item, dict) and not is_weread_book(item)]
    user_notes = [dict(item) for item in (payload.get("notes") or []) if isinstance(item, dict) and not is_weread_note(item)]
    user_updates = [dict(item) for item in (payload.get("updates") or []) if isinstance(item, dict) and not is_weread_update(item)]

    books = [dict(item) for item in user_books]
    book_ids = {coerce_int_id(item.get("id")) for item in books if coerce_int_id(item.get("id"))}
    for wb in weread_payload["books"]:
        item = dict(wb)
        item["id"] = allocate_id(book_ids, coerce_int_id(item.get("id")))
        books.append(item)

    notes = [dict(item) for item in user_notes]
    note_ids = {coerce_int_id(item.get("id")) for item in notes if coerce_int_id(item.get("id"))}
    for wn in weread_notes_payload["notes"]:
        item = dict(wn)
        item["id"] = allocate_id(note_ids, coerce_int_id(item.get("id")))
        notes.append(item)

    updates = []
    update_ids = set()
    for item in [*weread_payload["updates"], *user_updates]:
        entry = dict(item)
        entry["id"] = allocate_id(update_ids, coerce_int_id(entry.get("id")))
        updates.append(entry)
        if len(updates) >= 8:
            break

    return {
        **payload,
        "books": books,
        "notes": notes,
        "updates": updates,
        "wereadStats": weread_stats,
        "wereadSyncedAt": weread_synced_at,
        "weekReadDaily": weread_time["weekReadDaily"],
        "weekReadMinutes": weread_time["weekReadMinutes"],
        "totalReadDays": weread_time["totalReadDays"],
        "time": merge_time_data(existing_time, weread_stats, weread_synced_at),
    }


def migrate_embedded_special_data():
    base = load_base_app_data()
    existing_weread = load_weread_data()
    existing_weread_notes = load_weread_notes_data()
    cleaned_base, embedded_weread, embedded_weread_notes = split_combined_payload(base)

    if isinstance(base.get("time"), dict):
        write_time_data({**load_time_data(), **normalize_time_data(base.get("time"))})

    stored_weread_notes = normalize_weread_notes_data({"notes": existing_weread.get("notes") or []})
    if has_weread_notes_content(stored_weread_notes) or has_weread_notes_content(embedded_weread_notes):
        merged_notes = merge_weread_notes_store(
            existing_weread_notes,
            {"notes": [*(stored_weread_notes.get("notes") or []), *(embedded_weread_notes.get("notes") or [])]},
        )
        write_weread_notes_data(merged_notes)

    cleaned_weread = normalize_weread_data({**existing_weread, "notes": []})
    if cleaned_weread != existing_weread:
        write_weread_data(cleaned_weread)

    if has_weread_content(embedded_weread):
        write_weread_data(merge_weread_store(existing_weread, embedded_weread))
    if cleaned_base != base:
        write_base_app_data(cleaned_base)


def load_app_data():
    migrate_embedded_special_data()
    return merge_app_and_special_data(load_base_app_data(), load_weread_data(), load_weread_notes_data(), load_time_data())
