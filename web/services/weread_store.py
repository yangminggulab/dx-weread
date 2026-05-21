"""WeRead book, note, update normalization and local store merge helpers."""

from __future__ import annotations

from services.config import BOOK_ACCENTS, WEREAD_DATA_FILE, WEREAD_NOTES_FILE
from services.json_store import backup_file, load_json_file, write_json_file
from services.weread_stats import empty_weread_stats, has_weread_stats, normalize_weread_stats


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


def allocate_id(used_ids, preferred=0):
    if preferred and preferred not in used_ids:
        used_ids.add(preferred)
        return preferred
    next_id = max([0] + list(used_ids)) + 1
    while next_id in used_ids:
        next_id += 1
    used_ids.add(next_id)
    return next_id


def preserve_or_allocate_id(used_ids, preferred=0, matched_existing=False):
    preferred = coerce_int_id(preferred)
    if preferred and matched_existing:
        used_ids.add(preferred)
        return preferred
    return allocate_id(used_ids, preferred)


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
        item["id"] = preserve_or_allocate_id(book_ids, item.get("id"), matched_existing=bool(existing_book))
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
        item["id"] = preserve_or_allocate_id(note_ids, item.get("id"), matched_existing=bool(existing_note))
        notes.append(item)

    for note in remaining_notes:
        item = normalize_weread_note(note)
        item["id"] = preserve_or_allocate_id(note_ids, item.get("id"), matched_existing=True)
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
        item["id"] = preserve_or_allocate_id(note_ids, item.get("id"), matched_existing=bool(existing_note))
        notes.append(item)

    for note in remaining:
        item = normalize_weread_note(note)
        item["id"] = preserve_or_allocate_id(note_ids, item.get("id"), matched_existing=True)
        notes.append(item)

    return {
        "notes": notes,
        "meta": {
            **base.get("meta", {}),
            **fresh.get("meta", {}),
            "bookStates": fresh.get("meta", {}).get("bookStates") or base.get("meta", {}).get("bookStates", {}),
        },
    }
