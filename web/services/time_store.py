"""Time-domain data normalization and persistence helpers."""

from __future__ import annotations

from services.config import TIME_FILE
from services.json_store import load_json_file, write_json_file
from services.weread_stats import normalize_weread_stats


def _coerce_int(value):
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def empty_time_data():
    return {}


def normalize_time_data(data):
    payload = data if isinstance(data, dict) else {}
    result = dict(payload)
    if "weread" in result:
        weread = result.get("weread") if isinstance(result.get("weread"), dict) else {}
        result["weread"] = {
            "source": "weread",
            "syncedAt": str(weread.get("syncedAt", "")).strip(),
            "monthly": normalize_weread_stats({"monthly": weread.get("monthly")}).get("monthly", {}),
            "annual": normalize_weread_stats({"annual": weread.get("annual")}).get("annual", {}),
            "overall": normalize_weread_stats({"overall": weread.get("overall")}).get("overall", {}),
            "dailyReadTimes": normalize_weread_stats({"dailyReadTimes": weread.get("dailyReadTimes")}).get("dailyReadTimes", []),
            "weekReadDaily": weread.get("weekReadDaily") if isinstance(weread.get("weekReadDaily"), dict) else {},
            "weekReadMinutes": _coerce_int(weread.get("weekReadMinutes")),
            "totalReadDays": _coerce_int(weread.get("totalReadDays")),
        }
    return result


def load_time_data():
    return normalize_time_data(load_json_file(TIME_FILE, empty_time_data()))


def write_time_data(data):
    write_json_file(TIME_FILE, normalize_time_data(data))
