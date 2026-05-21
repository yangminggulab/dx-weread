from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
import hashlib
import os
from typing import Any

import requests

SKILL_VERSION = "1.0.3"
GATEWAY_URL = "https://i.weread.qq.com/api/agent/gateway"
BOOK_ACCENTS = ["#2d6a4f", "#4a4a6a", "#6a4a2a", "#3a6a5a", "#5a3a6a"]
TRANSIENT_STATUS_CODES = {408, 425, 429, 500, 502, 503, 504}


class WeReadApiError(RuntimeError):
    def __init__(self, message: str, *, status_code: int = 500, payload: dict[str, Any] | None = None):
        super().__init__(message)
        self.status_code = status_code
        self.payload = payload or {}


def load_weread_api_key() -> str:
    return str(os.environ.get("WEREAD_API_KEY", "")).strip()


def _log(message: str) -> None:
    print(f"[weread-api] {message}")


def _pick_book_accent(seed: str = "") -> str:
    score = sum(ord(ch) for ch in seed)
    return BOOK_ACCENTS[score % len(BOOK_ACCENTS)]


def _coerce_int(value: Any, default: int = 0) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return default


def _as_epoch_ms(value: Any) -> int:
    number = _coerce_int(value)
    if number <= 0:
        return 0
    return number * 1000 if number < 10**11 else number


def _format_timestamp(ms: int, with_time: bool = True) -> str:
    if not ms:
        return ""
    ts = ms / 1000 if ms > 10**11 else ms
    fmt = "%Y-%m-%d %H:%M" if with_time else "%Y-%m-%d"
    try:
        return datetime.fromtimestamp(ts).strftime(fmt)
    except (OSError, OverflowError, ValueError):
        return ""


def _normalize_readdata_brief(payload: dict[str, Any] | None) -> dict[str, Any]:
    data = payload if isinstance(payload, dict) else {}
    return {
        "baseTime": _coerce_int(data.get("baseTime")),
        "readDays": _coerce_int(data.get("readDays")),
        "totalReadTime": _coerce_int(data.get("totalReadTime")),
        "dayAverageReadTime": _coerce_int(data.get("dayAverageReadTime")),
        "compare": data.get("compare") if isinstance(data.get("compare"), (int, float)) else 0,
    }


def _normalize_daily_read_times(raw_map: Any) -> list[dict[str, Any]]:
    if not isinstance(raw_map, dict):
        return []

    items: list[dict[str, Any]] = []
    for raw_ts, raw_seconds in raw_map.items():
        ts = _as_epoch_ms(raw_ts)
        seconds = max(0, _coerce_int(raw_seconds))
        date = _format_timestamp(ts, with_time=False)
        if not date or seconds <= 0:
            continue
        items.append({
            "date": date,
            "timestamp": ts,
            "seconds": seconds,
        })

    items.sort(key=lambda item: item["timestamp"])
    return items


def _shorten_text(text: str, limit: int = 18) -> str:
    compact = " ".join(str(text or "").split())
    if len(compact) <= limit:
        return compact
    return compact[:limit].rstrip() + "..."


def _build_note_title(book_title: str, note_label: str, content: str) -> str:
    preview = _shorten_text(content, 18)
    if preview:
        return f"《{book_title}》{note_label} · {preview}"
    return f"《{book_title}》{note_label}"


def _make_source_item_id(book_id: str, note_type: str, *parts: Any) -> str:
    normalized = "||".join(" ".join(str(part or "").split()) for part in parts if str(part or "").strip())
    digest = hashlib.sha1(f"{book_id}|{note_type}|{normalized}".encode("utf-8")).hexdigest()[:16]
    return f"{book_id}:{note_type}:{digest}"


class WeReadGatewayClient:
    def __init__(self, api_key: str, *, timeout: int = 20):
        if not api_key:
            raise WeReadApiError("缺少 WEREAD_API_KEY，请先在本机环境中配置", status_code=400)
        self.api_key = api_key
        self.timeout = timeout

    def call(self, api_name: str, **params: Any) -> dict[str, Any]:
        payload = {"api_name": api_name, "skill_version": SKILL_VERSION, **params}
        response = None
        last_error: requests.RequestException | None = None
        for attempt in range(3):
            try:
                response = requests.post(
                    GATEWAY_URL,
                    json=payload,
                    headers={
                        "Authorization": f"Bearer {self.api_key}",
                        "Content-Type": "application/json",
                    },
                    timeout=self.timeout,
                )
                if response.status_code not in TRANSIENT_STATUS_CODES:
                    break
                _log(f"{api_name} 返回 HTTP {response.status_code}，准备第 {attempt + 2} 次重试")
            except requests.RequestException as exc:
                last_error = exc
                if attempt == 2:
                    raise WeReadApiError(f"微信读书网关请求失败：{exc}", status_code=502) from exc
                _log(f"{api_name} 请求异常：{exc}，准备第 {attempt + 2} 次重试")
                continue

        if response is None:
            raise WeReadApiError(f"微信读书网关请求失败：{last_error}", status_code=502)

        raw_text = response.text
        try:
            data = response.json()
        except ValueError as exc:
            raise WeReadApiError(
                f"微信读书网关返回了非 JSON 响应：{raw_text[:200]}",
                status_code=502,
            ) from exc

        if response.status_code in (401, 403):
            raise WeReadApiError("微信读书 API Key 无效或已失效", status_code=401, payload=data)
        if response.status_code >= 400:
            raise WeReadApiError(
                data.get("errmsg") or data.get("errMsg") or f"微信读书网关错误：HTTP {response.status_code}",
                status_code=502,
                payload=data,
            )

        upgrade_info = data.get("upgrade_info")
        if isinstance(upgrade_info, dict) and upgrade_info.get("message"):
            raise WeReadApiError(
                f"当前微信读书 skill 需要升级：{upgrade_info['message']}",
                status_code=409,
                payload=data,
            )

        errcode = data.get("errcode", data.get("errCode", 0))
        if errcode not in (0, None):
            raise WeReadApiError(
                data.get("errmsg") or data.get("errMsg") or f"微信读书接口错误：errcode={errcode}",
                status_code=502,
                payload=data,
            )

        return data


def _page_notebooks(client: WeReadGatewayClient) -> list[dict[str, Any]]:
    books: list[dict[str, Any]] = []
    last_sort: int | None = None
    for _ in range(50):
        params: dict[str, Any] = {"count": 100}
        if last_sort:
            params["lastSort"] = last_sort
        payload = client.call("/user/notebooks", **params)
        page_books = payload.get("books") or []
        books.extend(item for item in page_books if isinstance(item, dict))
        if not payload.get("hasMore") or not page_books:
            break
        last_sort = _coerce_int(page_books[-1].get("sort"))
        if not last_sort:
            break
    return books


def _page_reviews(client: WeReadGatewayClient, book_id: str) -> list[dict[str, Any]]:
    reviews: list[dict[str, Any]] = []
    synckey = 0
    for _ in range(50):
        payload = client.call("/review/list/mine", bookid=book_id, count=100, synckey=synckey)
        page_reviews = payload.get("reviews") or []
        reviews.extend(item for item in page_reviews if isinstance(item, dict))
        if not payload.get("hasMore") or not page_reviews:
            break
        next_synckey = _coerce_int(payload.get("synckey"))
        if next_synckey == synckey:
            break
        synckey = next_synckey
    return reviews


def _normalize_book(item: dict[str, Any], progress_payload: dict[str, Any] | None) -> dict[str, Any]:
    book = item if isinstance(item, dict) else {}
    progress = progress_payload.get("book") if isinstance(progress_payload, dict) else {}
    book_id = str(book.get("bookId") or "").strip()
    progress_percent = max(0, min(100, _coerce_int(progress.get("progress"))))
    read_ts = _as_epoch_ms(progress.get("updateTime") or book.get("readUpdateTime") or book.get("updateTime"))
    record_reading_time = _coerce_int(progress.get("recordReadingTime") or progress.get("readingTime"))
    finish_reading = bool(progress_percent >= 100 or _coerce_int(book.get("finishReading")) == 1)
    return {
        "title": book.get("title", ""),
        "author": book.get("author", ""),
        "cover": book.get("cover", ""),
        "category": book.get("category", ""),
        "status": "finished" if finish_reading else "reading",
        "progressPercent": progress_percent,
        "_bookId": book_id,
        "readTimestamp": read_ts,
        "readAt": _format_timestamp(read_ts),
        "todayReadMinutes": 0,
        "accent": _pick_book_accent(book.get("title", "")),
        "sourceUpdatedTimestamp": read_ts,
        "recordReadingTime": record_reading_time,
        "chapterUid": _coerce_int(progress.get("chapterUid")),
        "chapterOffset": _coerce_int(progress.get("chapterOffset")),
        "isStartReading": bool(_coerce_int(progress.get("isStartReading"))),
        "secret": _coerce_int(book.get("secret")),
        "isTop": _coerce_int(book.get("isTop")),
    }


def _normalize_bookmark_note(book_title: str, book_id: str, mark: dict[str, Any], chapter_titles: dict[int, str]) -> dict[str, Any] | None:
    mark_text = " ".join(str(mark.get("markText") or "").split())
    if not mark_text:
        return None
    create_ts = _as_epoch_ms(mark.get("createTime"))
    chapter_uid = _coerce_int(mark.get("chapterUid"))
    chapter_title = chapter_titles.get(chapter_uid, "")
    source_item_id = _make_source_item_id(
        book_id,
        "highlight",
        mark.get("bookmarkId"),
        mark.get("range"),
        chapter_uid,
        mark_text,
        create_ts,
    )
    return {
        "title": _build_note_title(book_title, "划线", mark_text),
        "tags": ["微信读书", "划线"],
        "summary": mark_text,
        "noteType": "highlight",
        "bookTitle": book_title,
        "_bookId": book_id,
        "sourceItemId": source_item_id,
        "sourceUpdatedAt": _format_timestamp(create_ts),
        "sourceUpdatedTimestamp": create_ts,
        "updatedAt": _format_timestamp(create_ts, with_time=False),
        "chapterTitle": chapter_title,
        "chapterUid": chapter_uid,
        "range": str(mark.get("range") or "").strip(),
        "colorStyle": _coerce_int(mark.get("colorStyle")),
    }


def _normalize_review_note(book_title: str, book_id: str, review_item: dict[str, Any]) -> dict[str, Any] | None:
    review = review_item.get("review") if isinstance(review_item.get("review"), dict) else {}
    content = " ".join(str(review.get("content") or "").split())
    if not content:
        return None
    create_ts = _as_epoch_ms(review.get("createTime"))
    source_item_id = _make_source_item_id(
        book_id,
        "review",
        review.get("reviewId"),
        review.get("range"),
        create_ts,
        content,
    )
    return {
        "title": _build_note_title(book_title, "评论", content),
        "tags": ["微信读书", "评论"],
        "summary": content,
        "noteType": "review",
        "bookTitle": book_title,
        "_bookId": book_id,
        "sourceItemId": source_item_id,
        "sourceUpdatedAt": _format_timestamp(create_ts),
        "sourceUpdatedTimestamp": create_ts,
        "updatedAt": _format_timestamp(create_ts, with_time=False),
        "chapterTitle": str(review.get("chapterTitle") or review.get("chapterName") or "").strip(),
        "chapterUid": _coerce_int(review.get("chapterUid")),
        "range": str(review.get("range") or "").strip(),
    }


def _fetch_book_progress(client: WeReadGatewayClient, book: dict[str, Any]) -> dict[str, Any]:
    book_id = str(book.get("bookId") or "").strip()
    if not book_id:
        return {}
    try:
        return client.call("/book/getprogress", bookId=book_id)
    except WeReadApiError:
        return {}


def _fetch_book_notes(
    client: WeReadGatewayClient,
    notebook_book: dict[str, Any],
    existing_notes_by_book: dict[str, list[dict[str, Any]]],
) -> tuple[list[dict[str, Any]], bool]:
    book_id = str(notebook_book.get("bookId") or "").strip()
    book_meta = notebook_book.get("book") if isinstance(notebook_book.get("book"), dict) else {}
    book_title = book_meta.get("title", "") or str(notebook_book.get("title") or "") or book_id
    if not book_id:
        return [], True

    try:
        bookmark_payload = client.call("/book/bookmarklist", bookId=book_id)
        bookmark_items = bookmark_payload.get("updated") or []
        chapters = bookmark_payload.get("chapters") or []
        chapter_titles = {
            _coerce_int(chapter.get("chapterUid")): str(chapter.get("title") or "").strip()
            for chapter in chapters
            if isinstance(chapter, dict)
        }
        review_items = _page_reviews(client, book_id)
    except WeReadApiError:
        return [dict(note) for note in existing_notes_by_book.get(book_id, [])], False

    notes: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    for item in bookmark_items:
        if not isinstance(item, dict):
            continue
        note = _normalize_bookmark_note(book_title, book_id, item, chapter_titles)
        if not note or note["sourceItemId"] in seen_ids:
            continue
        seen_ids.add(note["sourceItemId"])
        notes.append(note)

    for item in review_items:
        if not isinstance(item, dict):
            continue
        note = _normalize_review_note(book_title, book_id, item)
        if not note or note["sourceItemId"] in seen_ids:
            continue
        seen_ids.add(note["sourceItemId"])
        notes.append(note)

    notes.sort(key=lambda item: item.get("sourceUpdatedTimestamp") or 0, reverse=True)
    return notes, True


def sync_weread_snapshot(existing_notes_store: dict[str, Any] | None = None) -> dict[str, Any]:
    client = WeReadGatewayClient(load_weread_api_key())
    _log("开始同步书架、笔记和阅读统计")

    shelf = client.call("/shelf/sync")
    raw_books = [item for item in (shelf.get("books") or []) if isinstance(item, dict)]
    _log(f"书架读取完成：books={len(raw_books)} albums={len(shelf.get('albums') or [])} mp={'yes' if shelf.get('mp') else 'no'}")
    notebook_books = _page_notebooks(client)
    _log(f"笔记本概览读取完成：notebook_books={len(notebook_books)}")
    stats = client.call("/readdata/detail", mode="monthly")
    annual_stats = client.call("/readdata/detail", mode="annually", baseTime=int(datetime.now().timestamp()))
    daily_read_times = _normalize_daily_read_times(annual_stats.get("dailyReadTimes"))
    if not daily_read_times:
        daily_read_times = _normalize_daily_read_times(stats.get("readTimes"))
    _log(
        "阅读统计读取完成："
        f"monthlyReadDays={_coerce_int(stats.get('readDays'))} "
        f"monthlyTotalReadTime={_coerce_int(stats.get('totalReadTime'))}s "
        f"heatmapDays={len(daily_read_times)}"
    )

    existing_notes_by_book: dict[str, list[dict[str, Any]]] = {}
    if isinstance(existing_notes_store, dict):
        for note in existing_notes_store.get("notes", []) or []:
            if not isinstance(note, dict):
                continue
            book_id = str(note.get("_bookId") or "").strip()
            if book_id:
                existing_notes_by_book.setdefault(book_id, []).append(note)

    progress_map: dict[str, dict[str, Any]] = {}
    with ThreadPoolExecutor(max_workers=6) as pool:
        future_map = {
            pool.submit(_fetch_book_progress, client, book): str(book.get("bookId") or "").strip()
            for book in raw_books
            if str(book.get("bookId") or "").strip()
        }
        for future in as_completed(future_map):
            progress_map[future_map[future]] = future.result() or {}

    books = [_normalize_book(book, progress_map.get(str(book.get("bookId") or "").strip())) for book in raw_books]
    books.sort(key=lambda item: item.get("readTimestamp") or 0, reverse=True)

    notes: list[dict[str, Any]] = []
    full_sync_completed = True
    book_states: dict[str, dict[str, Any]] = {}
    sync_started_at = datetime.now().isoformat(timespec="seconds")
    with ThreadPoolExecutor(max_workers=4) as pool:
        future_map = {
            pool.submit(_fetch_book_notes, client, notebook_book, existing_notes_by_book): notebook_book
            for notebook_book in notebook_books
        }
        for future in as_completed(future_map):
            notebook_book = future_map[future]
            book_id = str(notebook_book.get("bookId") or "").strip()
            book_states[book_id] = {
                "lastSourceSignal": _coerce_int(notebook_book.get("sort")),
                "lastSyncedAt": sync_started_at,
            }
            book_notes, ok = future.result()
            notes.extend(book_notes)
            full_sync_completed = full_sync_completed and ok

    notes.sort(key=lambda item: item.get("sourceUpdatedTimestamp") or 0, reverse=True)
    _log(f"同步结束：books={len(books)} notes={len(notes)} fullSyncCompleted={'yes' if full_sync_completed else 'no'}")
    return {
        "books": books,
        "notes": notes,
        "stats": {
            "monthly": _normalize_readdata_brief(stats),
            "annual": _normalize_readdata_brief(annual_stats),
            "dailyReadTimes": daily_read_times,
        },
        "summary": {
            "shelfBookCount": len(raw_books),
            "shelfEntryCount": len(raw_books) + len(shelf.get("albums") or []) + (1 if shelf.get("mp") else 0),
            "notebookBookCount": len(notebook_books),
            "totalNoteCount": sum(
                _coerce_int(book.get("reviewCount")) + _coerce_int(book.get("noteCount")) + _coerce_int(book.get("bookmarkCount"))
                for book in notebook_books
            ),
        },
        "notesMeta": {
            "fullSyncCompleted": full_sync_completed,
            "lastFullSyncAt": sync_started_at if full_sync_completed else "",
            "lastIncrementalSyncAt": "",
            "bookStates": book_states,
        },
    }
