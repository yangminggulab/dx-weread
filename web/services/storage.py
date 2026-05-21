"""Storage and normalization helpers for local app data."""

from __future__ import annotations

import math

from services.config import BOOK_ACCENTS, DATA_FILE, WEREAD_DATA_FILE, WEREAD_NOTES_FILE
from services.diary_store import archive_diary_if_needed, effective_diary_date, empty_diary, load_diary_file, merge_diary, write_diary_file
from services.json_store import backup_file, load_json_file, write_json_file
from services.time_store import empty_time_data, load_time_data, normalize_time_data, write_time_data
from services.weread_stats import (
    build_weread_time_data,
    derive_weread_time_fields,
    empty_weread_stats,
    has_weread_brief_stats,
    has_weread_stats,
    merge_time_data,
    merge_weread_stats,
    normalize_weread_stats,
)


def load_base_app_data():
    data = load_json_file(DATA_FILE, {})
    return data if isinstance(data, dict) else {}


def write_base_app_data(data):
    write_json_file(DATA_FILE, data)


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
    payload = normalize_weread_data(data)
    payload["notes"] = []
    write_json_file(WEREAD_DATA_FILE, payload)


def load_weread_notes_data():
    return normalize_weread_notes_data(load_json_file(WEREAD_NOTES_FILE, empty_weread_notes_data()))


def write_weread_notes_data(data):
    backup_file(WEREAD_NOTES_FILE, "weread-notes", keep=1)
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
    existing_time = normalize_time_data(time_data if isinstance(time_data, dict) else payload.get("time"))
    time_weread = existing_time.get("weread") if isinstance(existing_time.get("weread"), dict) else {}
    weread_stats = merge_weread_stats(weread_payload.get("stats"), time_weread)
    weread_synced_at = weread_payload.get("syncedAt", "") or time_weread.get("syncedAt", "")
    weread_time = derive_weread_time_fields(weread_stats)

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
