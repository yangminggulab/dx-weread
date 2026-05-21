"""Flask routes for dashboard, diary, cloud sync, and WeRead APIs."""

from __future__ import annotations

import os

from flask import Blueprint, current_app, jsonify, request, send_from_directory

from services.cloud_sync import pull_from_cloud, push_diary_to_cloud_async
from services.config import CLOUD_API_TOKEN, ROOT_DIR
from services.storage import archive_diary_if_needed, empty_weread_stats, load_app_data, write_diary_file
from services.weread_sync import run_weread_sync, save_combined_data, weread_status_payload
from sync.weread import WeReadApiError, load_weread_api_key


api = Blueprint("api", __name__)


@api.route("/")
@api.route("/dashboard.html")
def index():
    return send_from_directory(ROOT_DIR, "dashboard.html")


@api.route("/api/data", methods=["GET"])
def get_data():
    return jsonify(load_app_data())


@api.route("/api/data", methods=["POST"])
def save_data():
    data = request.get_json(force=True)
    save_combined_data(data)
    return jsonify({"ok": True})


@api.route("/api/weread/status", methods=["GET"])
def weread_status():
    return jsonify(weread_status_payload())


@api.route("/api/weread/sync", methods=["POST"])
def weread_sync():
    if not load_weread_api_key():
        return jsonify({"error": "缺少 WEREAD_API_KEY，请先在项目根目录 .env 或当前终端环境中配置"}), 400

    try:
        result, counts, cloud_result = run_weread_sync("manual-sync")
        current_status = weread_status_payload()

        if cloud_result.get("attempted") and not cloud_result.get("ok"):
            return (
                jsonify(
                    {
                        "error": f"本地同步和备份已完成，但云端同步失败：{cloud_result.get('message', '')}",
                        "localSaved": True,
                        "dataPath": current_status["dataPath"],
                        "notesPath": current_status["notesPath"],
                        "backupDir": current_status["backupDir"],
                        "syncedAt": current_status["syncedAt"],
                        "cloudPush": cloud_result,
                    }
                ),
                502,
            )

        return jsonify(
            {
                "books": result["books"],
                "notes": result["notes"],
                "stats": load_app_data().get("wereadStats", empty_weread_stats()),
                "dataPath": current_status["dataPath"],
                "notesPath": current_status["notesPath"],
                "backupDir": current_status["backupDir"],
                "provider": "api-key",
                "syncedAt": current_status["syncedAt"],
                "cloudPush": cloud_result,
                "message": f"同步成功：{counts['books']} 本书，{counts['notes']} 份笔记",
            }
        )
    except WeReadApiError as exc:
        return jsonify({"error": str(exc)}), exc.status_code
    except Exception as exc:
        current_app.logger.exception("WeRead manual sync failed")
        return jsonify({"error": str(exc)}), 500


@api.route("/api/diary", methods=["GET"])
def get_diary():
    diary = archive_diary_if_needed()
    write_diary_file(diary)
    return jsonify(diary)


@api.route("/api/diary", methods=["POST"])
def save_diary():
    incoming = request.get_json(force=True)
    diary = archive_diary_if_needed(incoming)
    write_diary_file(diary)
    return jsonify({"ok": True})


@api.route("/api/sync/pull", methods=["GET", "POST"])
def sync_pull():
    try:
        pull_from_cloud("manual")
        return jsonify({"ok": True, "msg": "已从云端拉取并合并"})
    except Exception as exc:
        return jsonify({"ok": False, "error": str(exc)}), 500


@api.route("/api/diary/push", methods=["GET", "POST"])
def diary_push():
    if not CLOUD_API_TOKEN:
        return jsonify({"ok": False, "error": "未配置 API_TOKEN"}), 400
    try:
        push_diary_to_cloud_async("manual")
        return jsonify({"ok": True, "msg": "日记推送任务已启动"})
    except Exception as exc:
        return jsonify({"ok": False, "error": str(exc)}), 500
