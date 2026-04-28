"""
WeRead + Dashboard 本地服务
运行: python3 server.py
访问: http://localhost:8080
"""
from flask import Flask, request, jsonify, send_from_directory
from datetime import datetime
import hashlib
import math
import secrets
import threading
import time
import requests, os, json

app = Flask(__name__, static_folder=os.path.dirname(__file__))
DATA_FILE = os.path.join(os.path.dirname(__file__), "data.json")

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

def _push_to_cloud_async(label: str = "auto"):
    """在后台线程里把本地数据推送到 Cloudflare Worker，同步接口不阻塞。"""
    def _do():
        if not CLOUD_API_TOKEN:
            print(f"[cloud-push] 跳过：未设置 API_TOKEN（{label}）")
            return
        try:
            data = load_app_data()
            endpoint = CLOUD_BASE_URL.rstrip("/") + "/api/data"
            resp = requests.post(
                endpoint,
                json=data,
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {CLOUD_API_TOKEN}",
                },
                timeout=15,
            )
            resp.raise_for_status()
            print(f"[cloud-push] ✅ 推送成功（{label}）tasks={len(data.get('tasks', []))} books={len(data.get('books', []))}")
        except Exception as exc:
            print(f"[cloud-push] ⚠️  推送失败（{label}）: {exc}")

    threading.Thread(target=_do, daemon=True).start()

# ── 任务数据云端合并（不含日记） ─────────────────────────
def _merge_cloud_into_local(local: dict, cloud: dict) -> dict:
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

def _normalize_diary(diary):
    if not isinstance(diary, dict):
        return empty_diary()
    today   = diary.get("today")   if isinstance(diary.get("today"),   dict) else {}
    archive = [e for e in (diary.get("archive") or []) if isinstance(e, dict) and e.get("date")]
    return {"today": today, "archive": archive}

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
            archive = sorted([*archive, today], key=lambda x: x.get("date", ""))
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
            archive_map[e["date"]] = {**e, "content": _clean_diary_content(e.get("content", ""))}

    for entry in cloud_diary["archive"]:
        d = entry.get("date")
        if not d:
            continue
        cloud_content = _clean_diary_content(entry.get("content", ""))
        if d not in archive_map:
            archive_map[d] = {**entry, "content": cloud_content}
        elif len(cloud_content) > len(archive_map[d].get("content", "")):
            archive_map[d] = {**entry, "content": cloud_content}

    # 过滤掉清理后内容为空的条目
    valid = {d: e for d, e in archive_map.items() if e.get("content", "").strip()}

    return {
        "today":   merged_today,
        "archive": sorted(valid.values(), key=lambda x: x.get("date", "")),
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
    """每 N 小时自动从 Chrome 读取微信读书 Cookie 并同步，无需手动操作。
    Chrome 必须曾经登录过 weread.qq.com，不需要浏览器正在运行。"""
    time.sleep(60)   # 启动后等 60s，等系统稳定
    while True:
        try:
            cookie = load_weread_cookie_from_chrome()
            if cookie:
                print("[weread-auto] 🔄 自动同步微信读书...")
                result = fetch_weread_data(cookie, load_weread_notes_data())
                save_weread_cookie(cookie)
                _, counts = persist_weread_result(result)
                _push_to_cloud_async("weread-auto-sync")
                print(f"[weread-auto] ✅ 完成：{counts}")
        except RuntimeError as e:
            # Cookie 不存在或 Chrome 未授权，静默跳过
            print(f"[weread-auto] ⚠️  跳过（{e}）")
        except Exception as e:
            print(f"[weread-auto] ❌ 同步失败：{e}")
        time.sleep(interval_hours * 3600)

threading.Thread(target=_weread_auto_sync_scheduler, args=(2,), daemon=True).start()

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
WEREAD_COOKIE_FILE = os.path.join(os.path.dirname(__file__), ".weread_cookie.json")
WEREAD_DATA_FILE = os.path.join(os.path.dirname(__file__), ".weread_data.json")
WEREAD_NOTES_FILE = os.path.join(os.path.dirname(__file__), ".weread_notes.json")
WEREAD_BRIDGE_FILE = os.path.join(os.path.dirname(__file__), ".weread_bridge.json")
WEREAD_READ_TEMPLATE_FILE = os.path.join(os.path.dirname(__file__), ".weread_read_template.json")
BOOK_ACCENTS = ["#2d6a4f", "#4a4a6a", "#6a4a2a", "#3a6a5a", "#5a3a6a"]

HEADERS_BASE = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)",
    "Accept-Encoding": "gzip, deflate",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    "accept": "application/json, text/plain, */*",
    "Content-Type": "application/json",
}
WEREAD_WEB_BASE = "https://weread.qq.com"
WEREAD_MOBILE_BASE = "https://i.weread.qq.com"

# ── GitHub Actions Secret 自动更新 ──────────────────────────────────────────
# 需在 .env 中配置：
#   GH_PAT  = 你的 GitHub Personal Access Token（需要 repo / secrets 权限）
#   GH_REPO = 仓库路径，格式 owner/repo（例如 dx/task-app）
_GH_PAT  = os.environ.get("GH_PAT", "")
_GH_REPO = os.environ.get("GH_REPO", "")

def _update_github_secret(cookie: str) -> bool:
    """将最新 Cookie 推送到 GitHub Actions Secret WEREAD_COOKIE。
    依赖 PyNaCl（pip install PyNaCl）和环境变量 GH_PAT、GH_REPO。
    失败时静默返回 False，不影响主流程。
    """
    if not _GH_PAT or not _GH_REPO:
        return False
    try:
        from base64 import b64encode
        from nacl import encoding, public as nacl_public

        gh_headers = {
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {_GH_PAT}",
            "X-GitHub-Api-Version": "2022-11-28",
        }
        # 1. 获取仓库公钥
        key_resp = requests.get(
            f"https://api.github.com/repos/{_GH_REPO}/actions/secrets/public-key",
            headers=gh_headers, timeout=10,
        )
        key_resp.raise_for_status()
        key_data   = key_resp.json()
        public_key = key_data["key"]
        key_id     = key_data["key_id"]

        # 2. 用 libsodium SealedBox 加密
        pk        = nacl_public.PublicKey(public_key.encode(), encoding.Base64Encoder())
        encrypted = nacl_public.SealedBox(pk).encrypt(cookie.encode("utf-8"))
        enc_b64   = b64encode(encrypted).decode("utf-8")

        # 3. PUT 更新 Secret
        put_resp = requests.put(
            f"https://api.github.com/repos/{_GH_REPO}/actions/secrets/WEREAD_COOKIE",
            headers=gh_headers,
            json={"encrypted_value": enc_b64, "key_id": key_id},
            timeout=10,
        )
        if put_resp.status_code in (201, 204):
            print(f"[github-secret] ✅ WEREAD_COOKIE 已更新（{_GH_REPO}）")
            return True
        print(f"[github-secret] ⚠️  更新失败 HTTP {put_resp.status_code}: {put_resp.text[:200]}")
        return False
    except Exception as e:
        print(f"[github-secret] ❌ 更新异常: {e}")
        return False

def _update_github_secret_async(cookie: str):
    """在后台线程中更新 GitHub Secret，不阻塞 HTTP 响应。"""
    threading.Thread(target=_update_github_secret, args=(cookie,), daemon=True).start()

# ────────────────────────────────────────────────────────────────────────────

def wr_get(path, cookie, params=None, base_url=WEREAD_WEB_BASE):
    last_error = None
    for attempt in range(3):
        try:
            resp = requests.get(
                f"{base_url}{path}",
                headers={**HEADERS_BASE, "Cookie": cookie},
                params=params,
                timeout=15,
            )
            resp.raise_for_status()
            data = resp.json()
            if isinstance(data, dict) and data.get("errCode") not in (None, 0):
                err = requests.HTTPError(data.get("errMsg") or f"WeRead errCode={data.get('errCode')}")
                err.response = resp
                err.weread_payload = data
                raise err
            return data
        except (requests.ConnectionError, requests.Timeout) as e:
            last_error = e
            if attempt == 2:
                raise
            time.sleep(0.4 * (attempt + 1))
    if last_error is not None:
        raise last_error

def load_weread_cookie():
    if not os.path.exists(WEREAD_COOKIE_FILE):
        return ""
    try:
        with open(WEREAD_COOKIE_FILE, encoding="utf-8") as f:
            payload = json.load(f)
        if isinstance(payload, dict):
            return str(payload.get("cookie", "")).strip()
        if isinstance(payload, str):
            return payload.strip()
    except Exception:
        return ""
    return ""

def save_weread_cookie(cookie):
    payload = {
        "cookie": cookie,
        "updatedAt": datetime.now().isoformat(timespec="seconds"),
    }
    with open(WEREAD_COOKIE_FILE, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    try:
        os.chmod(WEREAD_COOKIE_FILE, 0o600)
    except OSError:
        pass

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
            "updatedAt": today,
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

def fetch_weread_data(cookie, existing_notes_store=None):
    # 1. 书架
    shelf = wr_get("/web/shelf/sync", cookie)
    books_raw = shelf.get("books", [])
    progress_map = {
        str(item.get("bookId")): item
        for item in (shelf.get("bookProgress") or [])
        if item.get("bookId")
    }
    existing_notes_payload = normalize_weread_notes_data(existing_notes_store)
    existing_note_map = {}
    for note in existing_notes_payload.get("notes", []):
        bid = str(note.get("_bookId") or "")
        if bid:
            existing_note_map.setdefault(bid, []).append(note)
    sync_started_at = datetime.now().isoformat(timespec="seconds")

    books = []
    shelf_note_candidates = []
    shelf_note_candidate_map = {}
    for item in books_raw:
        b = item.get("book", item) if isinstance(item, dict) else {}
        bid = str(b.get("bookId", "") or "").strip()
        if not bid:
            continue

        progress = progress_map.get(str(bid), {})
        current_page = progress.get("chapterIdx", 0) if isinstance(progress, dict) else 0
        total_page = (b.get("lastChapterIdx", 0) or 0) + 1
        progress_percent = max(0, min(100, coerce_int_id(progress.get("progress"))))
        read_ts = pick_timestamp_ms(item, b, progress)
        source_signal = note_source_signal(item, b, progress)

        books.append({
            "title": b.get("title", ""),
            "author": b.get("author", ""),
            "currentPage": current_page,
            "totalPage": total_page or 1,
            "chapterIndex": current_page,
            "chapterCount": total_page or 1,
            "progressPercent": progress_percent,
            "_bookId": bid,
            "readTimestamp": read_ts,
            "readAt": format_timestamp_label(read_ts),
        })
        candidate = {
            "bookId": bid,
            "title": b.get("title", ""),
            "author": b.get("author", ""),
            "sourceSignal": source_signal,
        }
        shelf_note_candidates.append(candidate)
        shelf_note_candidate_map[bid] = candidate

    books.sort(key=lambda item: (item.get("readTimestamp") or 0, item.get("progressPercent") or 0), reverse=True)

    # 获取今日阅读时长
    today_str = datetime.now().strftime("%Y%m%d")
    try:
        read_detail = wr_get("/web/book/read", cookie, {"synckey": 0, "date": today_str})
        today_read_map = {}
        for item in (read_detail.get("readTimes") or read_detail.get("items") or []):
            bid = str(item.get("bookId") or "")
            mins = coerce_int_id(item.get("readingTime") or item.get("duration") or 0) // 60
            if bid and mins > 0:
                today_read_map[bid] = mins
    except Exception:
        today_read_map = {}

    for book in books:
        book["todayReadMinutes"] = today_read_map.get(str(book.get("_bookId", "")), 0)

    for book in books[:6]:
        try:
            info = wr_get("/web/book/info", cookie, {"bookId": book["_bookId"]})
        except Exception:
            continue

        total_words = coerce_int_id(info.get("totalWords"))
        estimated_total_page = estimate_total_pages(total_words)
        estimated_current_page = estimate_current_page(book.get("progressPercent"), estimated_total_page)
        book["isbn"] = info.get("isbn", "") or ""
        book["totalWords"] = total_words
        book["estimatedTotalPage"] = estimated_total_page
        book["estimatedCurrentPage"] = estimated_current_page
        book["pageSource"] = "estimated_words" if estimated_total_page else ""

    note_sync_candidates = shelf_note_candidates
    try:
        notebook_payload = wr_get("/user/notebooks", cookie, base_url=WEREAD_MOBILE_BASE)
        notebook_candidates = []
        for item in extract_notebook_books(notebook_payload):
            bid = str(item.get("bookId", "") or "").strip()
            if not bid:
                continue
            shelf_candidate = shelf_note_candidate_map.get(bid, {})
            notebook_candidates.append({
                "bookId": bid,
                "title": item.get("title", "") or shelf_candidate.get("title", ""),
                "author": item.get("author", "") or shelf_candidate.get("author", ""),
                "sourceSignal": max(
                    coerce_int_id(item.get("sourceSignal")),
                    coerce_int_id(shelf_candidate.get("sourceSignal")),
                ),
            })
        if notebook_candidates:
            note_sync_candidates = notebook_candidates
    except Exception:
        pass

    # 3. 笔记 / 划线
    notes = []
    next_book_states = {}
    all_note_fetches_succeeded = True
    for candidate in note_sync_candidates:
        bid = str(candidate.get("bookId", "") or "").strip()
        title = candidate.get("title", "") or bid
        if not bid:
            continue

        next_book_states[bid] = {
            "lastSourceSignal": candidate["sourceSignal"],
            "lastSyncedAt": sync_started_at,
        }

        book_notes = []
        book_fetch_failed = False
        seen_note_ids = set()

        def append_book_note(item):
            source_item_id = item.get("sourceItemId") or f"{item.get('noteType')}|{item.get('title')}|{item.get('summary')}"
            if source_item_id in seen_note_ids:
                return
            seen_note_ids.add(source_item_id)
            book_notes.append(item)

        bookmark_fetch_ok = False
        for path, base_url in (
            ("/book/bookmarklist", WEREAD_MOBILE_BASE),
            ("/web/book/bookmarklist", WEREAD_WEB_BASE),
        ):
            try:
                bm = wr_get(path, cookie, {"bookId": bid}, base_url=base_url)
                bookmark_fetch_ok = True
                for mark in extract_bookmark_items(bm):
                    mark_text = compact_text(
                        mark.get("markText")
                        or mark.get("bookmarkText")
                        or mark.get("abstract")
                        or mark.get("content")
                        or mark.get("text")
                    )
                    if not mark_text:
                        continue
                    mark_ts = pick_timestamp_ms(mark)
                    chapter_title = compact_text(mark.get("chapterTitle") or mark.get("chapterName") or mark.get("chapterUid"))
                    source_item_id = make_source_item_id(
                        bid,
                        "highlight",
                        mark.get("bookmarkId"),
                        mark.get("bookmarkUid"),
                        mark.get("range"),
                        chapter_title,
                        mark_ts or "",
                        mark_text,
                    )
                    append_book_note({
                        "title": build_weread_note_title(title, "划线", mark_text),
                        "tags": ["微信读书", "划线"],
                        "summary": mark_text,
                        "source": "weread",
                        "noteType": "highlight",
                        "bookTitle": title,
                        "_bookId": bid,
                        "sourceItemId": source_item_id,
                        "sourceUpdatedAt": format_timestamp_label(mark_ts),
                        "sourceUpdatedTimestamp": mark_ts or 0,
                        "chapterTitle": chapter_title,
                    })
            except Exception:
                continue
        if not bookmark_fetch_ok:
            book_fetch_failed = True

        review_fetch_ok = False
        for path, params, base_url in (
            ("/review/list", {"bookId": bid, "listType": 11, "mine": 1, "synckey": 0, "listMode": 0}, WEREAD_MOBILE_BASE),
            ("/web/review/list", {"bookId": bid, "listType": 11, "mine": 1}, WEREAD_WEB_BASE),
        ):
            try:
                rv = wr_get(path, cookie, params, base_url=base_url)
                review_fetch_ok = True
                for review_item in extract_review_items(rv):
                    review = review_item.get("review", {}) if isinstance(review_item.get("review"), dict) else {}
                    container = review_item.get("container", {}) if isinstance(review_item.get("container"), dict) else {}
                    content = compact_text(review.get("content") or container.get("content"))
                    if not content:
                        continue
                    review_ts = pick_timestamp_ms(container, review)
                    source_item_id = make_source_item_id(
                        bid,
                        "review",
                        review.get("reviewId"),
                        container.get("reviewId"),
                        review_ts or "",
                        content,
                    )
                    append_book_note({
                        "title": build_weread_note_title(title, "评论", content),
                        "tags": ["微信读书", "评论"],
                        "summary": content,
                        "source": "weread",
                        "noteType": "review",
                        "bookTitle": title,
                        "_bookId": bid,
                        "sourceItemId": source_item_id,
                        "sourceUpdatedAt": format_timestamp_label(review_ts),
                        "sourceUpdatedTimestamp": review_ts or 0,
                    })
            except Exception:
                continue
        if not review_fetch_ok:
            book_fetch_failed = True

        if book_fetch_failed:
            all_note_fetches_succeeded = False
            if existing_note_map.get(bid):
                notes.extend(existing_note_map.get(bid, []))
            else:
                notes.extend(book_notes)
            continue

        notes.extend(book_notes)

    notes.sort(key=lambda item: (item.get("sourceUpdatedTimestamp") or 0, item.get("_bookId") or ""), reverse=True)
    return {
        "books": books,
        "notes": notes,
        "notesMeta": {
            "fullSyncCompleted": all_note_fetches_succeeded,
            "lastFullSyncAt": sync_started_at if all_note_fetches_succeeded else existing_notes_payload.get("meta", {}).get("lastFullSyncAt", ""),
            "lastIncrementalSyncAt": "",
            "bookStates": next_book_states,
        }
    }

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
    bridge = load_weread_bridge_data()
    read_template = load_weread_read_template_data()
    latest_capture = read_template.get("latest", {})
    return jsonify({
        "hasCookie": bool(load_weread_cookie()),
        "cookiePath": os.path.basename(WEREAD_COOKIE_FILE),
        "dataPath": os.path.basename(WEREAD_DATA_FILE),
        "notesPath": os.path.basename(WEREAD_NOTES_FILE),
        "readTemplatePath": os.path.basename(WEREAD_READ_TEMPLATE_FILE),
        "hasReadTemplate": bool(latest_capture.get("url")),
        "readTemplateCapturedAt": latest_capture.get("capturedAt", ""),
        "readTemplateLastUrl": latest_capture.get("url", ""),
        "readTemplateCount": len(read_template.get("captures", [])),
        "bridgePath": os.path.basename(WEREAD_BRIDGE_FILE),
        "bridgeReady": bool(bridge.get("token")),
        "bridgeEndpoint": "/api/weread/mini-sync",
        "bridgeTokenCreatedAt": bridge.get("createdAt", ""),
        "bridgeLatestPushAt": bridge.get("latestPushAt", ""),
        "bridgeLatestStatus": bridge.get("latestStatus", ""),
        "autoImportBrowser": "Chrome",
        "extensionDir": "chrome-extension/weread-sync",
    })

@app.route("/api/weread/read-template", methods=["GET", "POST"])
def weread_read_template():
    if request.method == "GET":
        return jsonify(load_weread_read_template_data())

    body = request.get_json(force=True) or {}
    capture = body.get("capture") if isinstance(body.get("capture"), dict) else {}
    if not capture:
        return jsonify({"error": "缺少 capture 数据"}), 400

    try:
        payload = save_weread_read_template_capture(capture)
        latest = payload.get("latest", {})
        return jsonify({
            "ok": True,
            "templatePath": os.path.basename(WEREAD_READ_TEMPLATE_FILE),
            "capturedAt": latest.get("capturedAt", ""),
            "url": latest.get("url", ""),
            "captures": len(payload.get("captures", [])),
            "message": "已保存微信读书阅读请求模板",
        })
    except Exception as exc:
        return jsonify({"error": str(exc)}), 400

@app.route("/api/weread/bridge-token", methods=["POST"])
def weread_bridge_token():
    body = request.get_json(silent=True) or {}
    force = bool(body.get("rotate"))
    bridge = ensure_weread_bridge_token(force=force)
    return jsonify({
        "ok": True,
        "token": bridge.get("token", ""),
        "createdAt": bridge.get("createdAt", ""),
        "bridgePath": os.path.basename(WEREAD_BRIDGE_FILE),
        "endpoint": "/api/weread/mini-sync",
    })

@app.route("/api/weread/mini-sync", methods=["POST"])
def weread_mini_sync():
    body = request.get_json(force=True)
    bridge = load_weread_bridge_data()
    token = str(body.get("token", "")).strip()
    source = str(body.get("source", "mini-program")).strip() or "mini-program"

    if not bridge.get("token"):
        return jsonify({"error": "桥接 token 尚未生成，请先调用 /api/weread/bridge-token"}), 400
    if token != bridge.get("token"):
        update_weread_bridge_record(
            latestPushAt=datetime.now().isoformat(timespec="seconds"),
            latestSource=source,
            latestStatus="rejected",
            latestMessage="bridge token 不匹配",
        )
        return jsonify({"error": "bridge token 不匹配"}), 403

    try:
        incoming_cookie = str(body.get("cookie", "")).strip()
        incoming_payload = body.get("payload") if isinstance(body.get("payload"), dict) else None

        if incoming_cookie:
            result = fetch_weread_data(incoming_cookie, load_weread_notes_data())
            save_weread_cookie(incoming_cookie)
            _, counts = persist_weread_result(result)
            update_weread_bridge_record(
                latestPushAt=datetime.now().isoformat(timespec="seconds"),
                latestSource=source,
                latestStatus="ok",
                latestMessage=f"通过桥接同步 {counts['books']} 本书、{counts['notes']} 条笔记",
            )
            return jsonify({
                "ok": True,
                "mode": "cookie",
                "books": counts["books"],
                "notes": counts["notes"],
                "dataPath": os.path.basename(WEREAD_DATA_FILE),
                "notesPath": os.path.basename(WEREAD_NOTES_FILE),
            })

        if incoming_payload:
            payload = build_weread_sync_payload({
                "books": incoming_payload.get("books") or [],
                "notes": incoming_payload.get("notes") or [],
                "notesMeta": incoming_payload.get("notesMeta") or {},
                "updates": incoming_payload.get("updates") or [],
            })
            counts = persist_weread_sync_payload(payload)
            update_weread_bridge_record(
                latestPushAt=datetime.now().isoformat(timespec="seconds"),
                latestSource=source,
                latestStatus="ok",
                latestMessage=f"通过桥接写入 {counts['books']} 本书、{counts['notes']} 条笔记",
            )
            return jsonify({
                "ok": True,
                "mode": "payload",
                "books": counts["books"],
                "notes": counts["notes"],
                "dataPath": os.path.basename(WEREAD_DATA_FILE),
                "notesPath": os.path.basename(WEREAD_NOTES_FILE),
            })

        return jsonify({"error": "缺少 cookie 或 payload"}), 400
    except requests.HTTPError as e:
        payload = getattr(e, "weread_payload", {}) if hasattr(e, "weread_payload") else {}
        err_code = payload.get("errCode")
        err_msg = payload.get("errMsg") or payload.get("errmsg") or ""
        update_weread_bridge_record(
            latestPushAt=datetime.now().isoformat(timespec="seconds"),
            latestSource=source,
            latestStatus="error",
            latestMessage=err_msg or str(e),
        )
        if err_code == -2012 or "登录超时" in err_msg:
            return jsonify({"error": "Cookie 已失效，请重新登录微信读书后再试"}), 401
        if e.response is not None and e.response.status_code in (401, 403):
            return jsonify({"error": "Cookie 已失效，请重新登录微信读书后再试"}), 401
        return jsonify({"error": f"微信读书接口错误: {e}"}), 502
    except Exception as e:
        app.logger.exception("WeRead mini-sync failed")
        update_weread_bridge_record(
            latestPushAt=datetime.now().isoformat(timespec="seconds"),
            latestSource=source,
            latestStatus="error",
            latestMessage=str(e),
        )
        return jsonify({"error": str(e)}), 500

@app.route("/api/weread/import-cookie", methods=["POST"])
def weread_import_cookie():
    try:
        cookie = load_weread_cookie_from_chrome()
        save_weread_cookie(cookie)
        return jsonify({
            "ok": True,
            "cookiePath": os.path.basename(WEREAD_COOKIE_FILE),
            "message": "已从 Chrome 自动读取并保存 Cookie",
        })
    except RuntimeError as e:
        return jsonify({"error": str(e)}), 400

@app.route("/api/weread/extension-sync", methods=["POST"])
def weread_extension_sync():
    body = request.get_json(force=True)
    cookie = str(body.get("cookie", "")).strip()
    if not cookie:
        return jsonify({"error": "扩展未提供 Cookie"}), 400

    try:
        result = fetch_weread_data(cookie, load_weread_notes_data())
        save_weread_cookie(cookie)
        migrate_embedded_special_data()
        _, counts = persist_weread_result(result)
        # 同步成功后：推送云端 + 更新 GitHub Actions Secret（均后台异步，不阻塞响应）
        _push_to_cloud_async("extension-sync")
        _update_github_secret_async(cookie)
        return jsonify({
            "ok": True,
            "books": counts["books"],
            "notes": counts["notes"],
            "cookiePath": os.path.basename(WEREAD_COOKIE_FILE),
            "dataPath": os.path.basename(WEREAD_DATA_FILE),
            "notesPath": os.path.basename(WEREAD_NOTES_FILE),
            "message": f"同步成功：{counts['books']} 本书，{counts['notes']} 份笔记",
        })
    except requests.HTTPError as e:
        payload = getattr(e, "weread_payload", {}) if hasattr(e, "weread_payload") else {}
        err_code = payload.get("errCode")
        err_msg = payload.get("errMsg") or payload.get("errmsg") or ""
        if err_code == -2012 or "登录超时" in err_msg:
            return jsonify({"error": "Cookie 已失效，请重新登录微信读书后再试"}), 401
        if e.response is not None and e.response.status_code in (401, 403):
            return jsonify({"error": "Cookie 已失效，请重新登录微信读书后再试"}), 401
        return jsonify({"error": f"微信读书接口错误: {e}"}), 502
    except Exception as e:
        app.logger.exception("WeRead extension-sync failed")
        return jsonify({"error": str(e)}), 500

# ── WeRead 同步接口 ───────────────────────────────────
@app.route("/api/weread/sync", methods=["POST"])
def weread_sync():
    migrate_embedded_special_data()
    body = request.get_json(silent=True) or {}
    incoming_cookie = body.get("cookie", "").strip()
    cookie = incoming_cookie or load_weread_cookie()
    if not cookie:
        return jsonify({"error": "缺少 Cookie，且未找到本地保存的 Cookie"}), 400

    try:
        result = fetch_weread_data(cookie, load_weread_notes_data())

        if incoming_cookie:
            save_weread_cookie(incoming_cookie)

        persist_weread_result(result)
        _push_to_cloud_async("manual-sync")

        return jsonify({
            "books": result["books"],
            "notes": result["notes"],
            "savedCookie": True,
            "usedSavedCookie": bool(cookie and not incoming_cookie),
            "cookiePath": os.path.basename(WEREAD_COOKIE_FILE),
            "dataPath": os.path.basename(WEREAD_DATA_FILE),
            "notesPath": os.path.basename(WEREAD_NOTES_FILE),
        })

    except requests.HTTPError as e:
        payload = getattr(e, "weread_payload", {}) if hasattr(e, "weread_payload") else {}
        err_code = payload.get("errCode")
        err_msg = payload.get("errMsg") or payload.get("errmsg") or ""
        if err_code == -2012 or "登录超时" in err_msg:
            return jsonify({"error": "Cookie 已失效，请重新获取"}), 401
        if e.response is not None and e.response.status_code in (401, 403):
            return jsonify({"error": "Cookie 已失效，请重新获取"}), 401
        return jsonify({"error": f"微信读书接口错误: {e}"}), 502
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
