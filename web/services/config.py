"""Shared runtime configuration for the local dashboard app."""

from __future__ import annotations

import os


ROOT_DIR = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
DATA_DIR = os.path.join(ROOT_DIR, "data")

DATA_FILE = os.path.join(DATA_DIR, "tasks.json")
DIARY_FILE = os.path.join(DATA_DIR, "diary.json")
TIME_FILE = os.path.join(DATA_DIR, "time.json")
BACKUP_DIR = os.path.join(ROOT_DIR, "local_backups")
RESET_FLAG_FILE = os.path.join(DATA_DIR, ".daily_reset_date")
ENV_FILE = os.path.join(ROOT_DIR, ".env")
WEREAD_DATA_FILE = os.path.join(DATA_DIR, "weread_data.json")
WEREAD_NOTES_FILE = os.path.join(DATA_DIR, "weread_notes.json")

BOOK_ACCENTS = ["#2d6a4f", "#4a4a6a", "#6a4a2a", "#3a6a5a", "#5a3a6a"]
LOCAL_BRIDGE_ALLOWED_ORIGINS = {
    "https://yangminggu.com",
    "https://www.yangminggu.com",
    "http://127.0.0.1:8080",
    "http://localhost:8080",
}


def load_env_file() -> None:
    """Load repo-local .env values without overriding existing env vars."""
    if not os.path.exists(ENV_FILE):
        return

    with open(ENV_FILE, encoding="utf-8") as handle:
        for raw_line in handle:
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def env_flag(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name)
    if raw is None or str(raw).strip() == "":
        return default
    return str(raw).strip().lower() in {"1", "true", "yes", "on"}


def env_float(name: str, default: float) -> float:
    raw = os.environ.get(name)
    if raw is None or str(raw).strip() == "":
        return default
    try:
        return float(raw)
    except (TypeError, ValueError):
        return default


load_env_file()

CLOUD_BASE_URL = os.environ.get("CLOUD_BASE_URL", "https://yangminggu.com/tasks")
CLOUD_API_TOKEN = os.environ.get("API_TOKEN", "")

WEREAD_SYNC_MODE = "api-key"
WEREAD_AUTO_SYNC_SOURCE = "api-key"
WEREAD_AUTO_SYNC_INTERVAL_HOURS = max(env_float("WEREAD_AUTO_SYNC_INTERVAL_HOURS", 2.0), 0.25)
WEREAD_AUTO_SYNC_START_DELAY_SECONDS = max(env_float("WEREAD_AUTO_SYNC_START_DELAY_SECONDS", 60.0), 0.0)
WEREAD_AUTO_SYNC_ON_START = env_flag("WEREAD_AUTO_SYNC_ON_START", True)
