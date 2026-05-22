"""API request handlers (no framework dependency)."""

from __future__ import annotations

import logging

from services.cloud_sync import pull_from_cloud
from services.diary_store import load_diary_file, merge_diary_update
from services.storage import archive_diary_if_needed, empty_weread_stats, load_app_data, write_diary_file
from services.weread_sync import run_weread_sync, save_combined_data, weread_status_payload
from sync.weread import WeReadApiError, load_weread_api_key


def handle_request(method, path, body):
    try:
        if method == "GET" and path == "/api/data":
            return 200, load_app_data()

        if method == "POST" and path == "/api/data":
            save_combined_data(body or {})
            return 200, {"ok": True}

        if method == "GET" and path == "/api/weread/status":
            return 200, weread_status_payload()

        if method == "POST" and path == "/api/weread/sync":
            return _weread_sync()

        if method == "GET" and path == "/api/diary":
            diary = archive_diary_if_needed()
            write_diary_file(diary)
            return 200, diary

        if method == "POST" and path == "/api/diary":
            diary = merge_diary_update(load_diary_file(), body or {})
            write_diary_file(diary)
            return 200, {"ok": True}

        if method in ("GET", "POST") and path == "/api/sync/pull":
            pull_from_cloud("manual")
            return 200, {"ok": True, "msg": "已从云端拉取并合并"}

        return 404, {"error": "Not found"}

    except WeReadApiError as exc:
        return exc.status_code, {"error": str(exc)}
    except Exception as exc:
        logging.exception("request failed: %s %s", method, path)
        return 500, {"error": str(exc)}


def _weread_sync():
    if not load_weread_api_key():
        return 400, {"error": "缺少 WEREAD_API_KEY，请先在项目根目录 .env 或当前终端环境中配置"}

    try:
        result, counts = run_weread_sync("manual-sync")
        current_status = weread_status_payload()

        return 200, {
            "books": result["books"],
            "notes": result["notes"],
            "stats": load_app_data().get("wereadStats", empty_weread_stats()),
            "dataPath": current_status["dataPath"],
            "notesPath": current_status["notesPath"],
            "backupDir": current_status["backupDir"],
            "provider": "api-key",
            "syncedAt": current_status["syncedAt"],
            "message": f"同步成功：{counts['books']} 本书，{counts['notes']} 份笔记",
        }

    except WeReadApiError as exc:
        return exc.status_code, {"error": str(exc)}
    except Exception as exc:
        logging.exception("WeRead manual sync failed")
        return 500, {"error": str(exc)}
