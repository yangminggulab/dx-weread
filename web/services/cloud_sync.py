"""Cloud push/pull and periodic maintenance jobs."""

from __future__ import annotations

from datetime import datetime
import threading
import time

import requests

from services.config import CLOUD_API_TOKEN, CLOUD_BASE_URL, RESET_FLAG_FILE
from services.storage import (
    archive_diary_if_needed,
    load_app_data,
    load_base_app_data,
    load_diary_file,
    merge_diary,
    migrate_embedded_special_data,
    write_base_app_data,
    write_diary_file,
)


def merge_cloud_into_local(local: dict, cloud: dict, preserve_local_only_tasks: bool = False) -> dict:
    result = dict(local)
    for key in ("tasks", "books", "notes", "updates"):
        local_items = [item for item in (local.get(key) or []) if isinstance(item, dict)]
        cloud_items = [item for item in (cloud.get(key) or []) if isinstance(item, dict)]
        local_by_id = {item["id"]: item for item in local_items if item.get("id") is not None}
        cloud_by_id = {item["id"]: item for item in cloud_items if item.get("id") is not None}

        if key == "tasks":
            merged = dict(cloud_by_id)
            for item_id, local_item in local_by_id.items():
                if item_id not in merged:
                    if preserve_local_only_tasks and local_item.get("status") != "completed":
                        merged[item_id] = local_item
                    continue
                local_ts = str(local_item.get("updatedAt") or local_item.get("createdAt") or "")
                cloud_ts = str(merged[item_id].get("updatedAt") or merged[item_id].get("createdAt") or "")
                if local_ts and local_ts > cloud_ts:
                    merged[item_id] = local_item
        else:
            merged = dict(local_by_id)
            for item in cloud_items:
                item_id = item.get("id")
                if item_id is None:
                    continue
                if key in ("books", "notes", "updates") and item.get("source") == "weread":
                    continue
                if key == "updates" and item.get("type") == "weread":
                    continue
                if item_id not in merged:
                    merged[item_id] = item
                else:
                    local_ts = str(merged[item_id].get("updatedAt") or merged[item_id].get("createdAt") or "")
                    cloud_ts = str(item.get("updatedAt") or item.get("createdAt") or "")
                    if cloud_ts and cloud_ts > local_ts:
                        merged[item_id] = item
        result[key] = list(merged.values())
    return result



def pull_from_cloud(label: str = "scheduled"):
    if not CLOUD_API_TOKEN:
        print(f"[cloud-pull] 跳过：未设置 API_TOKEN（{label}）")
        return
    try:
        headers = {"Authorization": f"Bearer {CLOUD_API_TOKEN}"}
        base = CLOUD_BASE_URL.rstrip("/")

        data_response = requests.get(f"{base}/api/data", headers=headers, timeout=15)
        data_response.raise_for_status()
        cloud_data = data_response.json()
        if isinstance(cloud_data, dict):
            local_data = load_app_data()
            merged = merge_cloud_into_local(local_data, cloud_data)
            base_data = load_base_app_data()
            base_data["tasks"] = [item for item in merged.get("tasks", []) if isinstance(item, dict)]
            write_base_app_data(base_data)
            print(f"[cloud-pull] ✅ 任务合并完成（{label}）tasks={len(base_data['tasks'])}")

        diary_response = requests.get(f"{base}/api/diary", headers=headers, timeout=15)
        diary_response.raise_for_status()
        cloud_diary = diary_response.json()
        if isinstance(cloud_diary, dict):
            local_diary = load_diary_file()
            merged_diary = merge_diary(local_diary, cloud_diary)
            write_diary_file(merged_diary)
            print(f"[cloud-pull] ✅ 日记合并完成（{label}）archive={len(merged_diary['archive'])}天")
    except Exception as exc:
        print(f"[cloud-pull] ⚠️  拉取失败（{label}）: {exc}")


def pull_from_cloud_async(label: str = "scheduled"):
    threading.Thread(target=lambda: pull_from_cloud(label), daemon=True).start()


def _get_last_reset_date():
    try:
        with open(RESET_FLAG_FILE, encoding="utf-8") as handle:
            return handle.read().strip()
    except Exception:
        return ""


def _set_last_reset_date(date_str):
    with open(RESET_FLAG_FILE, "w", encoding="utf-8") as handle:
        handle.write(date_str)


def do_daily_reset(today, label="5am"):
    try:
        pull_from_cloud(f"{label}-pre-pull")
        print(f"[reset] ✅ 云端数据已拉取合并 ({today})")
    except Exception as pull_exc:
        print(f"[reset] ⚠️  云端拉取失败，继续用本地数据: {pull_exc}")

    updated_diary = archive_diary_if_needed(load_diary_file())
    write_diary_file(updated_diary)
    print(f"[reset] ✅ 日记归档完成 ({today})")

    base = load_base_app_data()
    before = len(base.get("tasks", []))
    base["tasks"] = [item for item in (base.get("tasks") or []) if isinstance(item, dict) and item.get("status") != "completed"]
    after = len(base["tasks"])
    write_base_app_data(base)
    print(f"[reset] ✅ 已完成任务清除 {before - after} 条 ({today})")
    _set_last_reset_date(today)


def _cloud_pull_scheduler(interval_minutes: int = 15):
    time.sleep(10)
    pull_from_cloud("startup")
    while True:
        time.sleep(interval_minutes * 60)
        pull_from_cloud(f"every-{interval_minutes}min")


def _daily_5am_reset():
    time.sleep(15)
    try:
        now = datetime.now()
        today = now.date().isoformat()
        if now.hour >= 5 and _get_last_reset_date() != today:
            print(f"[reset] 🔄 开机补跑日重置 ({today})")
            do_daily_reset(today, label="startup")
    except Exception as exc:
        print(f"[reset] ⚠️  开机补跑错误: {exc}")

    while True:
        time.sleep(30)
        try:
            now = datetime.now()
            if now.hour == 5:
                today = now.date().isoformat()
                if _get_last_reset_date() != today:
                    do_daily_reset(today, label="5am")
        except Exception as exc:
            print(f"[reset] ⚠️  凌晨重置错误: {exc}")


def start_background_jobs():
    migrate_embedded_special_data()
    threading.Thread(target=_cloud_pull_scheduler, args=(15,), daemon=True).start()
    threading.Thread(target=_daily_5am_reset, daemon=True).start()
