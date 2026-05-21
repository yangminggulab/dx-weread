"""WeRead synchronization workflow."""

from __future__ import annotations

from datetime import datetime
import os
import threading
import time

from sync.weread import WeReadApiError, load_weread_api_key, sync_weread_snapshot

from services.cloud_sync import push_to_cloud_sync
from services.config import (
    BACKUP_DIR,
    CLOUD_API_TOKEN,
    WEREAD_AUTO_SYNC_INTERVAL_HOURS,
    WEREAD_AUTO_SYNC_ON_START,
    WEREAD_AUTO_SYNC_SOURCE,
    WEREAD_AUTO_SYNC_START_DELAY_SECONDS,
    WEREAD_DATA_FILE,
    WEREAD_NOTES_FILE,
    WEREAD_SYNC_MODE,
)
from services.storage import (
    load_app_data,
    load_base_app_data,
    merge_app_and_special_data,
    migrate_embedded_special_data,
    split_combined_payload,
    write_base_app_data,
)
from services.time_store import load_time_data, write_time_data
from services.weread_stats import empty_weread_stats, has_weread_stats, merge_time_data, normalize_weread_stats
from services.weread_store import (
    extract_note_preview,
    has_weread_content,
    has_weread_notes_content,
    load_weread_data,
    load_weread_notes_data,
    merge_weread_store,
    normalize_weread_book,
    normalize_weread_note,
    normalize_weread_notes_data,
    pick_book_accent,
    write_weread_data,
    write_weread_notes_data,
)


def fetch_weread_data(existing_notes_store=None):
    return sync_weread_snapshot(existing_notes_store=existing_notes_store)


def build_weread_sync_payload(result):
    today = datetime.now().date().isoformat()
    synced_at = datetime.now().isoformat(timespec="seconds")
    books = [
        normalize_weread_book(
            {
                **book,
                "source": "weread",
                "author": book.get("author", ""),
                "status": "reading",
                "accent": pick_book_accent(book.get("title", "")),
                "startDate": today,
                "notes": "",
            }
        )
        for book in result["books"]
    ]
    notes = [
        normalize_weread_note(
            {
                **note,
                "source": "weread",
                "updatedAt": (note.get("sourceUpdatedAt") or "")[:10] or today,
                "syncedAt": synced_at,
                "projectId": None,
            }
        )
        for note in result["notes"]
    ]
    updates = [
        {
            "id": int(datetime.now().timestamp() * 1000) + idx,
            "type": "weread",
            "text": note["title"],
            "preview": extract_note_preview(note.get("summary", "")),
            "time": "刚刚",
        }
        for idx, note in enumerate(result["notes"][:4])
    ]
    if not updates:
        updates = [
            {
                "id": int(datetime.now().timestamp() * 1000),
                "type": "weread",
                "text": f"微信读书同步：{len(result['books'])} 本书",
                "preview": "",
                "time": "刚刚",
            }
        ]
    return {
        "books": books,
        "notes": notes,
        "stats": normalize_weread_stats(result.get("stats")),
        "notesMeta": normalize_weread_notes_data({"notes": [], "meta": result.get("notesMeta", {})}).get("meta", {}),
        "updates": updates,
        "syncedAt": synced_at,
    }


def persist_weread_sync_payload(payload):
    merged = merge_weread_store(load_weread_data(), {**payload, "notes": []})
    notes_store = normalize_weread_notes_data({"notes": payload.get("notes", []), "meta": payload.get("notesMeta", {})})
    write_weread_data(merged)
    write_weread_notes_data(notes_store)
    write_time_data(merge_time_data(load_time_data(), merged.get("stats"), merged.get("syncedAt", "")))
    return {
        "books": len(payload.get("books") or []),
        "notes": len(payload.get("notes") or []),
        "updates": len(payload.get("updates") or []),
    }


def persist_weread_result(result):
    payload = build_weread_sync_payload(result)
    counts = persist_weread_sync_payload(payload)
    return payload, counts


def run_weread_sync(label: str):
    print(f"[weread-sync] 开始同步（{label}）")
    result = fetch_weread_data(load_weread_notes_data())
    migrate_embedded_special_data()
    payload, counts = persist_weread_result(result)
    cloud_app_data = merge_app_and_special_data(
        load_base_app_data(),
        payload,
        {"notes": payload.get("notes", []), "meta": payload.get("notesMeta", {})},
        load_time_data(),
    )
    cloud_result = push_to_cloud_sync(label, app_data=cloud_app_data)
    print(
        "[weread-sync] 同步完成"
        f"（{label}） books={counts['books']} notes={counts['notes']} updates={counts['updates']}"
    )
    return result, counts, cloud_result


def save_combined_data(data):
    migrate_embedded_special_data()
    current_weread = load_weread_data()
    current_weread_notes = load_weread_notes_data()
    user_data, weread_data, weread_notes_data = split_combined_payload(data)
    write_base_app_data(user_data)
    if isinstance(data.get("time"), dict):
        write_time_data(data.get("time"))
    if has_weread_content(weread_data):
        if "wereadStats" not in data or not has_weread_stats(weread_data.get("stats")):
            weread_data["stats"] = current_weread.get("stats", empty_weread_stats())
        weread_data["syncedAt"] = weread_data.get("syncedAt") or current_weread.get("syncedAt", "")
        write_weread_data(weread_data)
    elif not has_weread_content(current_weread):
        write_weread_data(weread_data)

    if has_weread_notes_content(weread_notes_data):
        write_weread_notes_data({"notes": weread_notes_data.get("notes", []), "meta": current_weread_notes.get("meta", {})})
    elif weread_notes_data.get("meta") or not has_weread_notes_content(current_weread_notes):
        write_weread_notes_data(weread_notes_data)


def weread_status_payload():
    migrate_embedded_special_data()
    current_weread = load_weread_data()
    current_notes = load_weread_notes_data()
    has_api_key = bool(load_weread_api_key())
    return {
        "hasApiKey": has_api_key,
        "provider": "api-key",
        "dataPath": os.path.basename(WEREAD_DATA_FILE),
        "notesPath": os.path.basename(WEREAD_NOTES_FILE),
        "backupDir": os.path.basename(BACKUP_DIR),
        "syncedAt": current_weread.get("syncedAt", ""),
        "bookCount": len(current_weread.get("books") or []),
        "noteCount": len(current_notes.get("notes") or []),
        "wereadSyncMode": WEREAD_SYNC_MODE,
        "wereadAutoSyncEnabled": True,
        "wereadAutoSyncSource": WEREAD_AUTO_SYNC_SOURCE,
        "wereadAutoSyncIntervalHours": WEREAD_AUTO_SYNC_INTERVAL_HOURS,
        "wereadAutoSyncOnStart": WEREAD_AUTO_SYNC_ON_START,
        "cloudPushEnabled": bool(CLOUD_API_TOKEN),
        "message": "" if has_api_key else "未配置 WEREAD_API_KEY，暂时无法同步微信读书数据",
    }


def _weread_auto_sync_scheduler(interval_hours: float = 2):
    time.sleep(WEREAD_AUTO_SYNC_START_DELAY_SECONDS)
    first_round = True
    while True:
        if first_round and not WEREAD_AUTO_SYNC_ON_START:
            first_round = False
            time.sleep(interval_hours * 3600)
            continue

        try:
            if load_weread_api_key():
                print("[weread-auto] 🔄 自动同步微信读书...")
                _, counts, cloud_result = run_weread_sync("weread-auto-sync")
                if cloud_result.get("attempted") and not cloud_result.get("ok"):
                    print(f"[weread-auto] ⚠️  本地同步成功，但云端推送失败：{cloud_result.get('message', '')}")
                print(f"[weread-auto] ✅ 完成：{counts}")
            else:
                print("[weread-auto] ⚠️  跳过：未配置 WEREAD_API_KEY")
        except WeReadApiError as exc:
            print(f"[weread-auto] ⚠️  跳过（{exc}）")
        except Exception as exc:
            print(f"[weread-auto] ❌ 同步失败：{exc}")
        first_round = False
        time.sleep(interval_hours * 3600)


def start_background_jobs():
    threading.Thread(target=_weread_auto_sync_scheduler, args=(WEREAD_AUTO_SYNC_INTERVAL_HOURS,), daemon=True).start()
