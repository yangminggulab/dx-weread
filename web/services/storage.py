"""Storage and normalization helpers for local app data."""

from __future__ import annotations

import math

from services.config import DATA_FILE
from services.diary_store import archive_diary_if_needed, effective_diary_date, empty_diary, load_diary_file, merge_diary, write_diary_file
from services.json_store import load_json_file, write_json_file
from services.time_store import empty_time_data, load_time_data, normalize_time_data, write_time_data
from services.weread_store import (
    allocate_id,
    coerce_int_id,
    empty_weread_data,
    empty_weread_notes_data,
    extract_note_preview,
    has_weread_content,
    has_weread_notes_content,
    is_weread_book,
    is_weread_note,
    is_weread_update,
    load_weread_data,
    load_weread_notes_data,
    merge_weread_notes_store,
    merge_weread_store,
    normalize_weread_book,
    normalize_weread_data,
    normalize_weread_note,
    normalize_weread_notes_data,
    pick_book_accent,
    write_weread_data,
    write_weread_notes_data,
)
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
