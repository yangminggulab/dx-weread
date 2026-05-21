"""Small JSON file persistence helpers used by local services."""

from __future__ import annotations

from datetime import datetime
import json
import os

from services.config import BACKUP_DIR


def load_json_file(path, default):
    if not os.path.exists(path):
        return default
    try:
        with open(path, encoding="utf-8") as handle:
            return json.load(handle)
    except Exception:
        return default


def write_json_file(path, data, mode=None):
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(data, handle, ensure_ascii=False, indent=2)
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
