"""
WeRead + Dashboard 本地服务
运行: python3 server.py
访问: http://localhost:8080
"""
from flask import Flask, request, jsonify, send_from_directory, make_response
from datetime import datetime
import hashlib
import math
import secrets
import threading
import time
import requests, os, json

from weread import WeReadApiError, load_weread_api_key, sync_weread_snapshot

app = Flask(__name__, static_folder=os.path.dirname(__file__))
DATA_FILE = os.path.join(os.path.dirname(__file__), "data.json")
LOCAL_BRIDGE_ALLOWED_ORIGINS = {
    "https://yangminggu.com",
    "https://www.yangminggu.com",
    "http://127.0.0.1:8080",
    "http://localhost:8080",
}


def _apply_local_bridge_headers(response):
    origin = request.headers.get("Origin", "")
    if origin in LOCAL_BRIDGE_ALLOWED_ORIGINS:
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
        response.headers["Access-Control-Allow-Headers"] = (
            request.headers.get("Access-Control-Request-Headers")
            or "Content-Type, Authorization"
        )
        response.headers["Vary"] = "Origin, Access-Control-Request-Headers, Access-Control-Request-Private-Network"
        if request.headers.get("Access-Control-Request-Private-Network") == "true":
            response.headers["Access-Control-Allow-Private-Network"] = "true"
    return response


@app.before_request
def _handle_local_bridge_preflight():
    if request.method == "OPTIONS" and request.path.startswith("/api/"):
        return _apply_local_bridge_headers(make_response("", 204))
    return None


@app.after_request
def _after_request(response):
    if request.path.startswith("/api/"):
        return _apply_local_bridge_headers(response)
    return response

# ── 云端自动推送配置 ──────────────────────────────────────
_ENV_FILE = os.path.join(os.path.dirname(__file__), ".env")

def _load_env_file():
    """从 .env 文件加载环境变量（不覆盖已有的）"""
    if not os.path.exists(_ENV_FILE):
        return
    with open(_ENV_FILE) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, val = line.partition("=")
            os.environ.setdefault(key.strip(), val.strip().strip('"').strip("'"))

_load_env_file()

CLOUD_BASE_URL = os.environ.get("CLOUD_BASE_URL", "https://yangminggu.com/tasks")
CLOUD_API_TOKEN = os.environ.get("API_TOKEN", "")


def _env_flag(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name)
    if raw is None or str(raw).strip() == "":
        return default
    return str(raw).strip().lower() in {"1", "true", "yes", "on"}


def _env_float(name: str, default: float) -> float:
    raw = os.environ.get(name)
    if raw is None or str(raw).strip() == "":
        return default
    try:
        return float(raw)
    except (TypeError, ValueError):
        return default


WEREAD_SYNC_MODE = "api-key"
WEREAD_ENABLE_GITHUB_SECRET_SYNC = _env_flag(
    "WEREAD_ENABLE_GITHUB_SECRET_SYNC",
    default=WEREAD_SYNC_MODE != "local-only",
)
WEREAD_AUTO_SYNC_SOURCE = "api-key"
WEREAD_AUTO_SYNC_INTERVAL_HOURS = max(_env_float("WEREAD_AUTO_SYNC_INTERVAL_HOURS", 2.0), 0.25)
WEREAD_AUTO_SYNC_START_DELAY_SECONDS = max(_env_float("WEREAD_AUTO_SYNC_START_DELAY_SECONDS", 60.0), 0.0)
WEREAD_AUTO_SYNC_ON_START = _env_flag("WEREAD_AUTO_SYNC_ON_START", True)

def _push_to_cloud_async(label: str = "auto"):
    """在后台线程里把本地数据推送到 Cloudflare Worker，同步接口不阻塞。
    任务（tasks）以云端为权威：推送前先拉云端最新任务，防止本地旧状态覆盖
    小程序刚标记的「已完成」。"""
    def _do():
        if not CLOUD_API_TOKEN:
            print(f"[cloud-push] 跳过：未设置 API_TOKEN（{label}）")
            return
        try:
            data = load_app_data()
            base = CLOUD_BASE_URL.rstrip("/")
            headers = {
                "Content-Type": "application/json",
                "Authorization": f"Bearer {CLOUD_API_TOKEN}",
            }
            # 推送前先拉云端最新数据，按更新时间合并，避免本地旧副本覆盖小程序修改
            try:
                r = requests.get(f"{base}/api/data", headers=headers, timeout=10)
                r.raise_for_status()
                cloud_data = r.json()
                if isinstance(cloud_data, dict):
                    data = _merge_cloud_into_local(data, cloud_data, preserve_local_only_tasks=True)
            except Exception as pull_exc:
                print(f"[cloud-push] ⚠️  拉取云端数据失败，使用本地副本（{pull_exc}）")

            resp = requests.post(f"{base}/api/data", json=data, headers=headers, timeout=15)
            resp.raise_for_status()
            print(f"[cloud-push] ✅ 推送成功（{label}）tasks={len(data.get('tasks', []))} books={len(data.get('books', []))}")
        except Exception as exc:
            print(f"[cloud-push] ⚠️  推送失败（{label}）: {exc}")

    threading.Thread(target=_do, daemon=True).start()

# ── 任务数据云端合并（不含日记） ─────────────────────────
def _merge_cloud_into_local(local: dict, cloud: dict, preserve_local_only_tasks: bool = False) -> dict:
    """把云端 tasks/books/notes/updates 合并进本地，不处理日记（日记单独管理）。"""
    result = dict(local)
    for key in ("tasks", "books", "notes", "updates"):
        local_items = [x for x in (local.get(key) or []) if isinstance(x, dict)]
        cloud_items = [x for x in (cloud.get(key) or []) if isinstance(x, dict)]
        local_by_id = {x["id"]: x for x in local_items if x.get("id") is not None}
        cloud_by_id = {x["id"]: x for x in cloud_items if x.get("id") is not None}

        if key == "tasks":
            # tasks 以云端为准：云端不存在的任务（已被重置删除）本地也不保留
            merged = dict(cloud_by_id)
            for iid, local_item in local_by_id.items():
                if iid not in merged:
                    if preserve_local_only_tasks and local_item.get("status") != "completed":
                        merged[iid] = local_item
                    continue  # 云端已删除，丢弃本地副本
                local_ts = str(local_item.get("updatedAt") or local_item.get("createdAt") or "")
                cloud_ts = str(merged[iid].get("updatedAt") or merged[iid].get("createdAt") or "")
                if local_ts and local_ts > cloud_ts:
                    merged[iid] = local_item  # 本地版本更新，保留本地
        else:
            merged = dict(local_by_id)
            for item in cloud_items:
                iid = item.get("id")
                if iid is None:
                    continue
                if iid not in merged:
                    merged[iid] = item
                else:
                    local_ts = str(merged[iid].get("updatedAt") or merged[iid].get("createdAt") or "")
                    cloud_ts = str(item.get("updatedAt") or item.get("createdAt") or "")
                    if cloud_ts and cloud_ts > local_ts:
                        merged[iid] = item

        result[key] = list(merged.values())
    return result

# ── 日记独立文件 ──────────────────────────────────────────
DIARY_FILE = os.path.join(os.path.dirname(__file__), "diary.json")

def empty_diary():
    return {"today": {"date": "", "content": ""}, "archive": []}

def _coerce_diary_view_count(value):
    try:
        return max(0, int(value))
    except (TypeError, ValueError):
        return 0

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
    last_viewed_at = max(
        str(primary.get("lastViewedAt", "") or ""),
        str(secondary.get("lastViewedAt", "") or ""),
    )
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
    today   = diary.get("today")   if isinstance(diary.get("today"),   dict) else {}
    archive = [
        normalized
        for normalized in (
            _normalize_diary_archive_entry(e)
            for e in (diary.get("archive") or [])
        )
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

def effective_diary_date():
    """日记的"今天"以凌晨5点为分界线，5点前仍属昨天"""
    from datetime import timedelta
    now = datetime.now()
    if now.hour < 5:
        return (now - timedelta(days=1)).date().isoformat()
    return now.date().isoformat()

def archive_diary_if_needed(diary=None):
    """检查并归档过期的今日日记，归档条数永不删除"""
    today_str = effective_diary_date()
    if diary is None:
        diary = load_diary_file()
    diary   = _normalize_diary(diary)
    today   = diary["today"]
    archive = diary["archive"]

    existing_date = today.get("date", "")
    if existing_date and existing_date != today_str:
        if today.get("content", "").strip():
            archived_today = _normalize_diary_archive_entry(today)
            archive = sorted(
                [*archive, archived_today] if archived_today else archive,
                key=lambda x: x.get("date", ""),
            )
        today = {"date": today_str, "content": ""}
    elif not existing_date:
        today = {"date": today_str, "content": ""}

    return {"today": today, "archive": archive}

def _clean_diary_content(text: str) -> str:
    """去除重复内容（--- 分隔的镜像复制）和 video tag 乱码"""
    import re as _re
    if not text:
        return ""
    # 去掉 video tag
    text = _re.sub(r'Your browser does not support the (video|audio) tag\.?', '', text, flags=_re.IGNORECASE)
    text = _re.sub(r'\d{1,2}:\d{2}\s*', '', text)
    # --- 分隔的重复：取第一段
    if '\n\n---\n' in text:
        text = text.split('\n\n---\n')[0]
    return text.strip()

def _merge_diary(local_diary: dict, cloud_diary: dict) -> dict:
    """合并两份日记，归档按日期去重，内容先清理再比长"""
    local_diary  = _normalize_diary(local_diary)
    cloud_diary  = _normalize_diary(cloud_diary)

    local_today  = local_diary["today"]
    cloud_today  = cloud_diary["today"]
    local_clean  = _clean_diary_content(str(local_today.get("content", "")))
    cloud_clean  = _clean_diary_content(str(cloud_today.get("content", "")))
    if len(cloud_clean) > len(local_clean):
        merged_today = {**cloud_today, "content": cloud_clean}
    else:
        merged_today = {**local_today, "content": local_clean} if local_clean else {**cloud_today, "content": cloud_clean}

    archive_map = {}
    for e in local_diary["archive"]:
        if e.get("date"):
            archive_map[e["date"]] = _merge_diary_archive_entry(
                e,
                {**e, "content": _clean_diary_content(e.get("content", ""))},
            )

    for entry in cloud_diary["archive"]:
        d = entry.get("date")
        if not d:
            continue
        archive_map[d] = _merge_diary_archive_entry(
            archive_map.get(d),
            {**entry, "content": _clean_diary_content(entry.get("content", ""))},
        )

    # 过滤掉清理后内容为空的条目
    valid = {
        d: _normalize_diary_archive_entry(e)
        for d, e in archive_map.items()
        if e and e.get("content", "").strip()
    }

    return {
        "today":   merged_today,
        "archive": sorted(
            [entry for entry in valid.values() if entry],
            key=lambda x: x.get("date", ""),
        ),
    }

# ── 云端拉取（任务 + 日记分开处理） ──────────────────────
def _pull_from_cloud(label: str = "scheduled"):
    if not CLOUD_API_TOKEN:
        print(f"[cloud-pull] 跳过：未设置 API_TOKEN（{label}）")
        return
    try:
        headers = {"Authorization": f"Bearer {CLOUD_API_TOKEN}"}
        base    = CLOUD_BASE_URL.rstrip("/")

        # 1. 拉任务数据
        r_data = requests.get(f"{base}/api/data", headers=headers, timeout=15)
        r_data.raise_for_status()
        cloud_data = r_data.json()
        if isinstance(cloud_data, dict):
            local_data = load_app_data()
            merged     = _merge_cloud_into_local(local_data, cloud_data)
            base_data  = load_base_app_data()
            base_data["tasks"] = [t for t in merged.get("tasks", []) if isinstance(t, dict)]
            write_base_app_data(base_data)
            print(f"[cloud-pull] ✅ 任务合并完成（{label}）tasks={len(base_data['tasks'])}")

        # 2. 拉日记数据（独立文件）
        r_diary = requests.get(f"{base}/api/diary", headers=headers, timeout=15)
        r_diary.raise_for_status()
        cloud_diary = r_diary.json()
        if isinstance(cloud_diary, dict):
            local_diary  = load_diary_file()
            merged_diary = _merge_diary(local_diary, cloud_diary)
            write_diary_file(merged_diary)
            print(f"[cloud-pull] ✅ 日记合并完成（{label}）archive={len(merged_diary['archive'])}天")

    except Exception as exc:
        print(f"[cloud-pull] ⚠️  拉取失败（{label}）: {exc}")

def _pull_from_cloud_async(label: str = "scheduled"):
    threading.Thread(target=lambda: _pull_from_cloud(label), daemon=True).start()

def _cloud_pull_scheduler(interval_minutes: int = 15):
    time.sleep(10)
    _pull_from_cloud("startup")
    while True:
        time.sleep(interval_minutes * 60)
        _pull_from_cloud(f"every-{interval_minutes}min")

threading.Thread(target=_cloud_pull_scheduler, args=(15,), daemon=True).start()

RESET_FLAG_FILE = os.path.join(os.path.dirname(__file__), ".daily_reset_date")

def _get_last_reset_date():
    try:
        with open(RESET_FLAG_FILE) as f:
            return f.read().strip()
    except Exception:
        return ""

def _set_last_reset_date(date_str):
    with open(RESET_FLAG_FILE, "w") as f:
        f.write(date_str)

def _do_daily_reset(today, label="5am"):
    """归档日记 + 清除已完成任务 + 推送云端"""
    # 0. 先从云端拉日记合并
    try:
        _pull_from_cloud(f"{label}-pre-pull")
        print(f"[reset] ✅ 云端数据已拉取合并 ({today})")
    except Exception as pull_exc:
        print(f"[reset] ⚠️  云端拉取失败，继续用本地数据: {pull_exc}")

    # 1. 归档日记
    updated_diary = archive_diary_if_needed(load_diary_file())
    write_diary_file(updated_diary)
    _push_diary_to_cloud_async(f"{label}-archive")
    print(f"[reset] ✅ 日记归档完成 ({today})")

    # 2. 清除已完成任务
    base = load_base_app_data()
    before = len(base.get("tasks", []))
    base["tasks"] = [
        t for t in (base.get("tasks") or [])
        if isinstance(t, dict) and t.get("status") != "completed"
    ]
    after = len(base["tasks"])
    write_base_app_data(base)
    _push_to_cloud_async(f"{label}-clean-completed")
    print(f"[reset] ✅ 已完成任务清除 {before - after} 条 ({today})")

    _set_last_reset_date(today)

def _daily_5am_reset():
    """凌晨5点执行 + 开机补跑（如果今天还没执行过）"""
    # 开机时检查：今天是否已执行（凌晨5点后才补跑）
    time.sleep(15)
    try:
        now = datetime.now()
        today = now.date().isoformat()
        if now.hour >= 5 and _get_last_reset_date() != today:
            print(f"[reset] 🔄 开机补跑日重置 ({today})")
            _do_daily_reset(today, label="startup")
    except Exception as exc:
        print(f"[reset] ⚠️  开机补跑错误: {exc}")

    # 常驻循环：等凌晨5点
    while True:
        time.sleep(30)
        try:
            now = datetime.now()
            if now.hour == 5:
                today = now.date().isoformat()
                if _get_last_reset_date() != today:
                    _do_daily_reset(today, label="5am")
        except Exception as exc:
            print(f"[reset] ⚠️  凌晨重置错误: {exc}")

threading.Thread(target=_daily_5am_reset, daemon=True).start()

def _weread_auto_sync_scheduler(interval_hours: int = 2):
    """每 N 小时用本机配置的 WEREAD_API_KEY 自动同步一次微信读书数据。"""
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
                _, counts = _run_weread_sync("weread-auto-sync")
                print(f"[weread-auto] ✅ 完成：{counts}")
            else:
                print("[weread-auto] ⚠️  跳过：未配置 WEREAD_API_KEY")
        except WeReadApiError as e:
            print(f"[weread-auto] ⚠️  跳过（{e}）")
        except Exception as e:
            print(f"[weread-auto] ❌ 同步失败：{e}")
        first_round = False
        time.sleep(interval_hours * 3600)

def _push_diary_to_cloud_async(label: str = "auto"):
    """把本地 diary.json 推送到云端 /api/diary"""
    def _do():
        if not CLOUD_API_TOKEN:
            return
        try:
            diary = load_diary_file()
            resp  = requests.post(
                CLOUD_BASE_URL.rstrip("/") + "/api/diary",
                json=diary,
                headers={"Content-Type": "application/json", "Authorization": f"Bearer {CLOUD_API_TOKEN}"},
                timeout=15,
            )
            resp.raise_for_status()
            print(f"[diary-push] ✅ 推送成功（{label}）archive={len(diary.get('archive', []))}天")
        except Exception as exc:
            print(f"[diary-push] ⚠️  推送失败（{label}）: {exc}")
    threading.Thread(target=_do, daemon=True).start()

BACKUP_DIR = os.path.join(os.path.dirname(__file__), ".backups")
WEREAD_DATA_FILE = os.path.join(os.path.dirname(__file__), ".weread_data.json")
WEREAD_NOTES_FILE = os.path.join(os.path.dirname(__file__), ".weread_notes.json")
BOOK_ACCENTS = ["#2d6a4f", "#4a4a6a", "#6a4a2a", "#3a6a5a", "#5a3a6a"]

def empty_weread_read_template_data():
    return {
        "latest": {},
        "captures": [],
        "updatedAt": "",
    }

def _sanitize_json_like(value, depth=0):
    if depth > 6:
        return None
    if value is None or isinstance(value, (bool, int, float)):
        return value
    if isinstance(value, str):
        return value[:50000]
    if isinstance(value, list):
        return [_sanitize_json_like(item, depth + 1) for item in value[:100]]
    if isinstance(value, dict):
        cleaned = {}
        for raw_key, raw_value in list(value.items())[:100]:
            key = str(raw_key)[:200]
            cleaned[key] = _sanitize_json_like(raw_value, depth + 1)
        return cleaned
    return str(value)[:2000]

def normalize_weread_read_capture(capture):
    if not isinstance(capture, dict):
        return {}
    request_headers = capture.get("requestHeaders") if isinstance(capture.get("requestHeaders"), dict) else {}
    body_data = capture.get("bodyData")
    body_keys = capture.get("bodyKeys") if isinstance(capture.get("bodyKeys"), list) else []
    hints = capture.get("hints") if isinstance(capture.get("hints"), list) else []
    return {
        "fingerprint": str(capture.get("fingerprint", "")).strip(),
        "capturedAt": str(capture.get("capturedAt", "")).strip(),
        "completedAt": str(capture.get("completedAt", "")).strip(),
        "method": str(capture.get("method", "POST")).strip().upper() or "POST",
        "url": str(capture.get("url", "")).strip(),
        "path": str(capture.get("path", "")).strip(),
        "tabUrl": str(capture.get("tabUrl", "")).strip(),
        "documentUrl": str(capture.get("documentUrl", "")).strip(),
        "statusCode": int(capture.get("statusCode") or 0),
        "bodyFormat": str(capture.get("bodyFormat", "")).strip(),
        "bodyText": str(capture.get("bodyText", "")).strip()[:50000],
        "bodyKeys": [str(item)[:200] for item in body_keys[:50]],
        "hints": [str(item)[:200] for item in hints[:30]],
        "requestHeaders": _sanitize_json_like(request_headers),
        "bodyData": _sanitize_json_like(body_data),
    }

def load_weread_read_template_data():
    data = load_json_file(WEREAD_READ_TEMPLATE_FILE, empty_weread_read_template_data())
    if not isinstance(data, dict):
        return empty_weread_read_template_data()
    latest = normalize_weread_read_capture(data.get("latest", {}))
    captures = []
    for item in data.get("captures", []):
        normalized = normalize_weread_read_capture(item)
        if normalized.get("url"):
            captures.append(normalized)
    return {
        "latest": latest if latest.get("url") else (captures[0] if captures else {}),
        "captures": captures[:12],
        "updatedAt": str(data.get("updatedAt", "")).strip(),
    }

def save_weread_read_template_capture(capture):
    normalized = normalize_weread_read_capture(capture)
    if not normalized.get("url"):
        raise ValueError("缺少读取模板的 URL")
    existing = load_weread_read_template_data()
    captures = [normalized]
    seen = {normalized.get("fingerprint") or normalized.get("url")}
    for item in existing.get("captures", []):
        key = item.get("fingerprint") or item.get("url")
        if key in seen:
            continue
        seen.add(key)
        captures.append(item)
        if len(captures) >= 12:
            break
    payload = {
        "latest": normalized,
        "captures": captures,
        "updatedAt": datetime.now().isoformat(timespec="seconds"),
    }
    write_json_file(WEREAD_READ_TEMPLATE_FILE, payload, mode=0o600)
    return payload

def load_json_file(path, default):
    if not os.path.exists(path):
        return default
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return default

def write_json_file(path, data, mode=None):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
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

def empty_weread_notes_data():
    return {
        "notes": [],
        "meta": {
            "fullSyncCompleted": False,
            "lastFullSyncAt": "",
            "lastIncrementalSyncAt": "",
            "bookStates": {},
        }
    }

def empty_weread_data():
    return {"books": [], "notes": [], "updates": [], "syncedAt": ""}

def empty_weread_bridge_data():
    return {
        "token": "",
        "createdAt": "",
        "latestPushAt": "",
        "latestSource": "",
        "latestStatus": "",
        "latestMessage": "",
    }

def coerce_int_id(value):
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0

def has_tag(tags, name):
    return isinstance(tags, list) and name in tags

def is_weread_book(book):
    return isinstance(book, dict) and (
        book.get("source") == "weread"
        or bool(book.get("_bookId"))
    )

def is_weread_note(note):
    return isinstance(note, dict) and (
        note.get("source") == "weread"
        or has_tag(note.get("tags"), "微信读书")
    )

def is_weread_update(item):
    return isinstance(item, dict) and item.get("type") == "weread"

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
    # updatedAt 永远用微信读书原始时间的日期部分，不受同步日期污染
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
        "books": [
            normalize_weread_book(item)
            for item in (payload.get("books") or [])
            if isinstance(item, dict)
        ],
        "notes": [
            normalize_weread_note(item)
            for item in (payload.get("notes") or [])
            if isinstance(item, dict)
        ],
        "updates": [
            normalize_weread_update(item)
            for item in (payload.get("updates") or [])
            if isinstance(item, dict)
        ],
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
        "notes": [
            normalize_weread_note(item)
            for item in (payload.get("notes") or [])
            if isinstance(item, dict)
        ],
        "meta": {
            "fullSyncCompleted": bool(meta.get("fullSyncCompleted")),
            "lastFullSyncAt": str(meta.get("lastFullSyncAt", "")).strip(),
            "lastIncrementalSyncAt": str(meta.get("lastIncrementalSyncAt", "")).strip(),
            "bookStates": book_states,
        }
    }

def normalize_weread_bridge_data(data):
    payload = data if isinstance(data, dict) else {}
    return {
        "token": str(payload.get("token", "")).strip(),
        "createdAt": str(payload.get("createdAt", "")).strip(),
        "latestPushAt": str(payload.get("latestPushAt", "")).strip(),
        "latestSource": str(payload.get("latestSource", "")).strip(),
        "latestStatus": str(payload.get("latestStatus", "")).strip(),
        "latestMessage": str(payload.get("latestMessage", "")).strip(),
    }

def load_weread_notes_data():
    return normalize_weread_notes_data(load_json_file(WEREAD_NOTES_FILE, empty_weread_notes_data()))

def write_weread_notes_data(data):
    backup_file(WEREAD_NOTES_FILE, "weread-notes")
    write_json_file(WEREAD_NOTES_FILE, normalize_weread_notes_data(data))

def load_weread_bridge_data():
    return normalize_weread_bridge_data(load_json_file(WEREAD_BRIDGE_FILE, empty_weread_bridge_data()))

def write_weread_bridge_data(data):
    backup_file(WEREAD_BRIDGE_FILE, "weread-bridge")
    write_json_file(WEREAD_BRIDGE_FILE, normalize_weread_bridge_data(data), mode=0o600)

def has_weread_notes_content(data):
    return bool(normalize_weread_notes_data(data).get("notes"))

def note_source_signal(book_item, book_info, progress_info):
    return max([
        ts for ts in (
            pick_timestamp_ms(progress_info),
            pick_timestamp_ms(book_item),
            pick_timestamp_ms(book_info),
        ) if ts
    ], default=0)

def load_weread_data():
    return normalize_weread_data(load_json_file(WEREAD_DATA_FILE, empty_weread_data()))

def write_weread_data(data):
    backup_file(WEREAD_DATA_FILE, "weread-data")
    payload = normalize_weread_data(data)
    payload["notes"] = []
    write_json_file(WEREAD_DATA_FILE, payload)

def has_weread_content(data):
    payload = normalize_weread_data(data)
    return any(payload[key] for key in ("books", "notes", "updates"))

def pick_book_accent(seed=""):
    score = sum(ord(ch) for ch in seed)
    return BOOK_ACCENTS[score % len(BOOK_ACCENTS)]

def extract_note_preview(summary=""):
    for line in summary.splitlines():
        line = line.lstrip("📌💭").strip()
        if line:
            return line
    return "已同步到笔记与文档"

def as_epoch_ms(value):
    if value in (None, "", 0, "0"):
        return None
    try:
        num = int(float(value))
    except (TypeError, ValueError):
        return None
    if num <= 0:
        return None
    if num < 10**11:
        num *= 1000
    return num

def pick_timestamp_ms(*sources):
    candidate_keys = (
        "readUpdateTime", "readTime", "readingTime", "lastReadTime",
        "updateTime", "modifiedTime", "mtime", "ctime", "createTime",
        "reviewCreateTime", "bookmarkUpdateTime", "sort",
    )
    for source in sources:
        if not isinstance(source, dict):
            continue
        for key in candidate_keys:
            ts = as_epoch_ms(source.get(key))
            if ts:
                return ts
    return None

def format_timestamp_label(ms):
    if not ms:
        return ""
    try:
        return datetime.fromtimestamp(ms / 1000).strftime("%Y-%m-%d %H:%M")
    except Exception:
        return ""

def estimate_total_pages(total_words):
    words = coerce_int_id(total_words)
    if words <= 0:
        return 0
    # 中文非漫画类书籍按每页约 500 字估算，避免继续展示错误的章节数。
    return max(1, math.ceil(words / 500))

def estimate_current_page(progress_percent, total_pages):
    total = coerce_int_id(total_pages)
    progress = max(0, min(100, coerce_int_id(progress_percent)))
    if total <= 0 or progress <= 0:
        return 0
    return min(total, max(1, round(total * progress / 100)))

def compact_text(text):
    return " ".join(str(text or "").split())

def shorten_text(text, limit=18):
    compact = compact_text(text)
    if not compact:
        return ""
    if len(compact) <= limit:
        return compact
    return compact[:limit].rstrip() + "..."

def make_source_item_id(book_id, note_type, *parts):
    raw = "||".join(compact_text(part) for part in parts if compact_text(part))
    digest = hashlib.sha1(f"{book_id}|{note_type}|{raw}".encode("utf-8")).hexdigest()[:16]
    return f"{book_id}:{note_type}:{digest}"

def build_weread_note_title(book_title, note_label, content):
    preview = shorten_text(content, 18)
    if preview:
        return f"《{book_title}》{note_label} · {preview}"
    return f"《{book_title}》{note_label}"

def walk_json_nodes(value):
    if isinstance(value, dict):
        yield value
        for child in value.values():
            yield from walk_json_nodes(child)
        return
    if isinstance(value, list):
        for child in value:
            yield from walk_json_nodes(child)

def extract_notebook_books(payload):
    books = []
    seen = set()
    if not isinstance(payload, dict):
        return books

    raw_books = payload.get("books")
    if not isinstance(raw_books, list):
        raw_books = payload.get("notebooks")
    if not isinstance(raw_books, list):
        raw_books = []

    for item in raw_books:
        if not isinstance(item, dict):
            continue
        book = item.get("book") if isinstance(item.get("book"), dict) else item
        bid = str(book.get("bookId") or item.get("bookId") or "").strip()
        if not bid or bid in seen:
            continue
        seen.add(bid)
        books.append({
            "bookId": bid,
            "title": book.get("title", "") or item.get("title", "") or "",
            "author": book.get("author", "") or item.get("author", "") or "",
            "sourceSignal": note_source_signal(item, book),
        })
    return books

def extract_bookmark_items(payload):
    items = []
    seen = set()
    for node in walk_json_nodes(payload):
        if not isinstance(node, dict):
            continue

        mark_text = compact_text(
            node.get("markText")
            or node.get("bookmarkText")
            or node.get("abstract")
            or node.get("content")
            or node.get("text")
        )
        if not mark_text:
            continue

        has_bookmark_identity = any(
            node.get(key) not in (None, "", [])
            for key in ("bookmarkId", "bookmarkUid", "range", "chapterUid", "chapterTitle", "chapterName")
        )
        if not has_bookmark_identity and "markText" not in node:
            continue

        dedupe_key = (
            compact_text(node.get("bookmarkId") or node.get("bookmarkUid") or node.get("range") or ""),
            compact_text(node.get("chapterUid") or node.get("chapterTitle") or node.get("chapterName") or ""),
            mark_text,
        )
        if dedupe_key in seen:
            continue
        seen.add(dedupe_key)
        items.append(node)
    return items

def extract_review_items(payload):
    items = []
    seen = set()
    for node in walk_json_nodes(payload):
        if not isinstance(node, dict):
            continue
        review = node.get("review") if isinstance(node.get("review"), dict) else node
        content = compact_text(review.get("content") or node.get("content"))
        if not content:
            continue
        if not any(review.get(key) not in (None, "", []) or node.get(key) not in (None, "", []) for key in ("reviewId", "reviewUid", "review")):
            continue
        dedupe_key = (
            compact_text(review.get("reviewId") or node.get("reviewId") or review.get("reviewUid") or node.get("reviewUid") or ""),
            content,
        )
        if dedupe_key in seen:
            continue
        seen.add(dedupe_key)
        items.append({
            "review": review,
            "container": node,
        })
    return items

def split_combined_payload(data):
    payload = data if isinstance(data, dict) else {}
    tasks = [item for item in (payload.get("tasks") or []) if isinstance(item, dict)]
    books = [item for item in (payload.get("books") or []) if isinstance(item, dict)]
    notes = [item for item in (payload.get("notes") or []) if isinstance(item, dict)]
    updates = [item for item in (payload.get("updates") or []) if isinstance(item, dict)]

    user_data = {
        **{k: v for k, v in payload.items() if k not in {"books", "notes", "updates"}},
        "tasks": tasks,
        "books": [dict(item) for item in books if not is_weread_book(item)],
        "notes": [dict(item) for item in notes if not is_weread_note(item)],
        "updates": [dict(item) for item in updates if not is_weread_update(item)],
    }
    weread_data = normalize_weread_data({
        "books": [item for item in books if is_weread_book(item)],
        "notes": [],
        "updates": [item for item in updates if is_weread_update(item)],
    })
    weread_notes_data = normalize_weread_notes_data({
        "notes": [item for item in notes if is_weread_note(item)],
    })
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
            (book for book in base_books
             if (wb.get("_bookId") and book.get("_bookId") == wb.get("_bookId")) or book.get("title") == wb.get("title")),
            None,
        )
        item = normalize_weread_book({
                **(existing_book or {}),
                **wb,
                "id": (existing_book or {}).get("id") or wb.get("id"),
            })
        item["id"] = allocate_id(book_ids, coerce_int_id(item.get("id")))
        books.append(item)

    remaining_notes = [dict(item) for item in base["notes"]]
    note_ids = {coerce_int_id(item.get("id")) for item in remaining_notes if coerce_int_id(item.get("id"))}
    notes = []
    for wn in fresh["notes"]:
        idx = next(
            (i for i, note in enumerate(remaining_notes)
             if (wn.get("_bookId") and note.get("_bookId") == wn.get("_bookId") and note.get("title") == wn.get("title"))
             or note.get("title") == wn.get("title")),
            -1,
        )
        existing_note = remaining_notes.pop(idx) if idx >= 0 else {}
        item = normalize_weread_note({
            **existing_note,
            **wn,
            "id": existing_note.get("id") or wn.get("id"),
        })
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

    return {
        "books": books,
        "notes": notes,
        "updates": updates,
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
            (i for i, note in enumerate(remaining)
             if (
                 rn.get("sourceItemId")
                 and note.get("sourceItemId") == rn.get("sourceItemId")
             ) or (
                 coerce_int_id(note.get("id"))
                 and coerce_int_id(note.get("id")) == coerce_int_id(rn.get("id"))
             ) or (
                 note.get("_bookId") == rn.get("_bookId")
                 and note.get("title") == rn.get("title")
                 and note.get("summary") == rn.get("summary")
             )),
            -1,
        )
        existing_note = remaining.pop(idx) if idx >= 0 else {}
        item = normalize_weread_note({
            **existing_note,
            **rn,
            "id": existing_note.get("id") or rn.get("id"),
        })
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
        }
    }

def merge_app_and_special_data(data, weread, weread_notes_data):
    payload = data if isinstance(data, dict) else {}
    weread_payload = normalize_weread_data(weread)
    weread_notes_payload = normalize_weread_notes_data(weread_notes_data)

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
    }

def migrate_embedded_special_data():
    base = load_base_app_data()
    existing_weread = load_weread_data()
    existing_weread_notes = load_weread_notes_data()
    cleaned_base, embedded_weread, embedded_weread_notes = split_combined_payload(base)

    stored_weread_notes = normalize_weread_notes_data({
        "notes": existing_weread.get("notes") or [],
    })
    if has_weread_notes_content(stored_weread_notes) or has_weread_notes_content(embedded_weread_notes):
        merged_notes = merge_weread_notes_store(existing_weread_notes, {
            "notes": [
                *(stored_weread_notes.get("notes") or []),
                *(embedded_weread_notes.get("notes") or []),
            ]
        })
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
    return merge_app_and_special_data(load_base_app_data(), load_weread_data(), load_weread_notes_data())

def build_weread_sync_payload(result):
    today = datetime.now().date().isoformat()
    synced_at = datetime.now().isoformat(timespec="seconds")
    books = [
        normalize_weread_book({
            **wb,
            "source": "weread",
            "author": wb.get("author", ""),
            "status": "reading",
            "accent": pick_book_accent(wb.get("title", "")),
            "startDate": today,
            "notes": "",
        })
        for wb in result["books"]
    ]
    notes = [
        normalize_weread_note({
            **wn,
            "source": "weread",
            # 优先用微信读书原始划线时间，没有才用同步日期
            "updatedAt": (wn.get("sourceUpdatedAt") or "")[:10] or today,
            "syncedAt": synced_at,
            "projectId": None,
        })
        for wn in result["notes"]
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
        updates = [{
            "id": int(datetime.now().timestamp() * 1000),
            "type": "weread",
            "text": f"微信读书同步：{len(result['books'])} 本书",
            "preview": "",
            "time": "刚刚",
        }]
    return {
        "books": books,
        "notes": notes,
        "notesMeta": normalize_weread_notes_data({
            "notes": [],
            "meta": result.get("notesMeta", {}),
        }).get("meta", {}),
        "updates": updates,
        "syncedAt": synced_at,
    }

def persist_weread_sync_payload(payload):
    merged = merge_weread_store(load_weread_data(), {**payload, "notes": []})
    notes_store = normalize_weread_notes_data({
        "notes": payload.get("notes", []),
        "meta": payload.get("notesMeta", {}),
    })
    write_weread_data(merged)
    write_weread_notes_data(notes_store)
    return {
        "books": len(payload.get("books") or []),
        "notes": len(payload.get("notes") or []),
        "updates": len(payload.get("updates") or []),
    }

def persist_weread_result(result):
    payload = build_weread_sync_payload(result)
    counts = persist_weread_sync_payload(payload)
    return payload, counts

def update_weread_bridge_record(**patch):
    bridge = load_weread_bridge_data()
    bridge.update({key: value for key, value in patch.items() if value is not None})
    write_weread_bridge_data(bridge)
    return bridge

def ensure_weread_bridge_token(force=False):
    bridge = load_weread_bridge_data()
    if bridge.get("token") and not force:
        return bridge
    now = datetime.now().isoformat(timespec="seconds")
    bridge = {
        **bridge,
        "token": secrets.token_urlsafe(24),
        "createdAt": now,
    }
    write_weread_bridge_data(bridge)
    return bridge

def load_weread_cookie_from_chrome():
    try:
        import browser_cookie3
        from browser_cookie3 import BrowserCookieError
    except ImportError as e:
        raise RuntimeError("缺少 browser-cookie3 依赖，请先安装 requirements.txt") from e

    try:
        jar = browser_cookie3.chrome(domain_name="weread.qq.com")
    except BrowserCookieError as e:
        raise RuntimeError(
            "自动读取失败：macOS 未授权读取 Chrome 的登录 Cookie。"
            "请允许钥匙串访问，或继续手动粘贴 Cookie。"
        ) from e
    except Exception as e:
        raise RuntimeError(f"自动读取失败：{e}") from e

    pairs = []
    seen = set()
    for cookie in jar:
        if "weread.qq.com" not in cookie.domain:
            continue
        if not cookie.value:
            continue
        if cookie.name in seen:
            continue
        seen.add(cookie.name)
        pairs.append(f"{cookie.name}={cookie.value}")

    required = {"wr_skey", "wr_vid", "wr_rt"}
    names = {part.split("=", 1)[0] for part in pairs}
    missing = sorted(required - names)
    if missing:
        raise RuntimeError(
            "自动读取失败：Chrome 里未找到完整的微信读书登录 Cookie，缺少 "
            + ", ".join(missing)
            + "。请先确认 weread.qq.com 已登录。"
        )

    return "; ".join(pairs)


def _resolve_auto_sync_cookie() -> str:
    source = WEREAD_AUTO_SYNC_SOURCE
    if source == "saved-cookie":
        cookie = load_weread_cookie()
        if cookie:
            return cookie
        raise RuntimeError("本地未找到可用的已保存 Cookie，请先手动同步一次或粘贴 Cookie")

    if source == "chrome":
        return load_weread_cookie_from_chrome()

    if source == "prefer-saved":
        return load_weread_cookie() or load_weread_cookie_from_chrome()

    if source == "prefer-chrome":
        try:
            return load_weread_cookie_from_chrome()
        except RuntimeError:
            cookie = load_weread_cookie()
            if cookie:
                return cookie
            raise

    cookie = load_weread_cookie()
    if cookie:
        return cookie
    return load_weread_cookie_from_chrome()


def _run_weread_sync(label: str):
    print(f"[weread-sync] 开始同步（{label}）")
    result = fetch_weread_data(load_weread_notes_data())
    migrate_embedded_special_data()
    _, counts = persist_weread_result(result)
    _push_to_cloud_async(label)
    print(
        "[weread-sync] 同步完成"
        f"（{label}） books={counts['books']} notes={counts['notes']} updates={counts['updates']}"
    )
    return result, counts


threading.Thread(target=_weread_auto_sync_scheduler, args=(WEREAD_AUTO_SYNC_INTERVAL_HOURS,), daemon=True).start()

def fetch_weread_data(existing_notes_store=None):
    return sync_weread_snapshot(existing_notes_store=existing_notes_store)

# ── 静态文件 ──────────────────────────────────────────
@app.route("/")
@app.route("/dashboard.html")
def index():
    return send_from_directory(os.path.dirname(__file__), "dashboard.html")

# ── 数据读写 ──────────────────────────────────────────
@app.route("/api/data", methods=["GET"])
def get_data():
    return jsonify(load_app_data())

@app.route("/api/data", methods=["POST"])
def save_data():
    migrate_embedded_special_data()
    data = request.get_json(force=True)
    current_weread = load_weread_data()
    current_weread_notes = load_weread_notes_data()
    user_data, weread_data, weread_notes_data = split_combined_payload(data)
    write_base_app_data(user_data)
    if has_weread_content(weread_data):
        weread_data["syncedAt"] = weread_data.get("syncedAt") or current_weread.get("syncedAt", "")
        write_weread_data(weread_data)
    elif not has_weread_content(current_weread):
        write_weread_data(weread_data)
    if has_weread_notes_content(weread_notes_data):
        write_weread_notes_data({
            "notes": weread_notes_data.get("notes", []),
            "meta": current_weread_notes.get("meta", {}),
        })
    elif weread_notes_data.get("meta") or not has_weread_notes_content(current_weread_notes):
        write_weread_notes_data(weread_notes_data)
    return jsonify({"ok": True})

@app.route("/api/weread/status", methods=["GET"])
def weread_status():
    migrate_embedded_special_data()
    current_weread = load_weread_data()
    current_notes = load_weread_notes_data()
    has_api_key = bool(load_weread_api_key())
    return jsonify({
        "hasApiKey": has_api_key,
        "provider": "api-key",
        "dataPath": os.path.basename(WEREAD_DATA_FILE),
        "notesPath": os.path.basename(WEREAD_NOTES_FILE),
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
    })

# ── WeRead 同步接口 ───────────────────────────────────
@app.route("/api/weread/sync", methods=["POST"])
def weread_sync():
    migrate_embedded_special_data()
    if not load_weread_api_key():
        return jsonify({"error": "缺少 WEREAD_API_KEY，请先在项目根目录 .env 或当前终端环境中配置"}), 400

    try:
        result, counts = _run_weread_sync("manual-sync")
        current_weread = load_weread_data()

        return jsonify({
            "books": result["books"],
            "notes": result["notes"],
            "dataPath": os.path.basename(WEREAD_DATA_FILE),
            "notesPath": os.path.basename(WEREAD_NOTES_FILE),
            "provider": "api-key",
            "syncedAt": current_weread.get("syncedAt", ""),
            "message": f"同步成功：{counts['books']} 本书，{counts['notes']} 份笔记",
        })

    except WeReadApiError as e:
        return jsonify({"error": str(e)}), e.status_code
    except Exception as e:
        app.logger.exception("WeRead manual sync failed")
        return jsonify({"error": str(e)}), 500

# ── 日记接口 ─────────────────────────────────────────────
@app.route("/api/diary", methods=["GET"])
def get_diary():
    diary = archive_diary_if_needed(load_diary_file())
    write_diary_file(diary)   # 顺便把归档状态持久化
    return jsonify(diary)

@app.route("/api/diary", methods=["POST"])
def save_diary():
    incoming = request.get_json(force=True)
    diary    = archive_diary_if_needed(incoming)
    write_diary_file(diary)
    return jsonify({"ok": True})

@app.route("/api/sync/pull", methods=["GET", "POST"])
def sync_pull():
    """从云端拉取数据并与本地合并（任务 + 日记）"""
    try:
        _pull_from_cloud("manual")
        return jsonify({"ok": True, "msg": "已从云端拉取并合并"})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

@app.route("/api/diary/push", methods=["GET", "POST"])
def diary_push():
    """把本地 diary.json 推送到云端"""
    if not CLOUD_API_TOKEN:
        return jsonify({"ok": False, "error": "未配置 API_TOKEN"}), 400
    try:
        _push_diary_to_cloud_async("manual")
        return jsonify({"ok": True, "msg": "日记推送任务已启动"})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

if __name__ == "__main__":
    host = os.environ.get("TASK_APP_HOST", "127.0.0.1")
    port = coerce_int_id(os.environ.get("TASK_APP_PORT", "8080")) or 8080
    print(f"Dashboard: http://{host}:{port}")
    app.run(host=host, port=port, debug=False)
