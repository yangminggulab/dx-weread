"""WeRead reading statistics normalization and derived time fields."""

from __future__ import annotations

from datetime import datetime


def _coerce_int(value):
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def empty_weread_stats():
    return {
        "monthly": {"baseTime": 0, "readDays": 0, "totalReadTime": 0, "dayAverageReadTime": 0, "compare": 0},
        "annual": {"baseTime": 0, "readDays": 0, "totalReadTime": 0, "dayAverageReadTime": 0, "compare": 0},
        "overall": {"baseTime": 0, "readDays": 0, "totalReadTime": 0, "dayAverageReadTime": 0, "compare": 0},
        "dailyReadTimes": [],
    }


def normalize_weread_stats(stats):
    payload = stats if isinstance(stats, dict) else {}

    def _normalize_brief(section):
        item = section if isinstance(section, dict) else {}
        compare = item.get("compare")
        if not isinstance(compare, (int, float)):
            compare = 0
        return {
            "baseTime": _coerce_int(item.get("baseTime")),
            "readDays": _coerce_int(item.get("readDays")),
            "totalReadTime": _coerce_int(item.get("totalReadTime")),
            "dayAverageReadTime": _coerce_int(item.get("dayAverageReadTime")),
            "compare": compare,
        }

    daily_read_times = []
    for item in payload.get("dailyReadTimes") or []:
        if not isinstance(item, dict):
            continue
        date = str(item.get("date", "")).strip()
        seconds = _coerce_int(item.get("seconds"))
        if not date or seconds < 0:
            continue
        daily_read_times.append(
            {
                "date": date,
                "timestamp": _coerce_int(item.get("timestamp")),
                "seconds": seconds,
            }
        )

    daily_read_times.sort(key=lambda item: item.get("date", ""))
    return {
        "monthly": _normalize_brief(payload.get("monthly")),
        "annual": _normalize_brief(payload.get("annual")),
        "overall": _normalize_brief(payload.get("overall")),
        "dailyReadTimes": daily_read_times,
    }


def has_weread_stats(stats):
    payload = normalize_weread_stats(stats)
    if payload.get("dailyReadTimes"):
        return True
    for key in ("monthly", "annual", "overall"):
        section = payload.get(key) or {}
        if has_weread_brief_stats(section):
            return True
        compare = section.get("compare")
        if isinstance(compare, (int, float)) and compare != 0:
            return True
    return False


def has_weread_brief_stats(section):
    payload = section if isinstance(section, dict) else {}
    return any(_coerce_int(payload.get(field)) > 0 for field in ("baseTime", "readDays", "totalReadTime", "dayAverageReadTime"))


def merge_weread_stats(primary, fallback):
    left = normalize_weread_stats(primary)
    right = normalize_weread_stats(fallback)
    return {
        "monthly": left["monthly"] if has_weread_brief_stats(left["monthly"]) else right["monthly"],
        "annual": left["annual"] if has_weread_brief_stats(left["annual"]) else right["annual"],
        "overall": left["overall"] if has_weread_brief_stats(left["overall"]) else right["overall"],
        "dailyReadTimes": left["dailyReadTimes"] or right["dailyReadTimes"],
    }


def _timestamp_seconds_for_date(date_key):
    try:
        return int(datetime.strptime(date_key, "%Y-%m-%d").timestamp())
    except (TypeError, ValueError, OSError):
        return 0


def derive_weread_time_fields(stats):
    payload = normalize_weread_stats(stats)
    current_month = datetime.now().strftime("%Y-%m")
    week_read_daily = {}
    daily_read_times = []

    for item in payload.get("dailyReadTimes") or []:
        date_key = str(item.get("date", "")).strip()
        seconds = max(0, _coerce_int(item.get("seconds")))
        timestamp = _coerce_int(item.get("timestamp"))
        if timestamp > 10**11:
            timestamp = timestamp // 1000
        if not timestamp and date_key:
            timestamp = _timestamp_seconds_for_date(date_key)
        minutes = round(seconds / 60)
        daily_read_times.append({**item, "timestamp": timestamp, "seconds": seconds, "minutes": minutes})
        if date_key.startswith(current_month) and minutes > 0 and timestamp:
            week_read_daily[str(timestamp)] = minutes

    week_read_minutes = sum(week_read_daily.values())
    total_read_days = (
        _coerce_int(payload.get("overall", {}).get("readDays"))
        or _coerce_int(payload.get("annual", {}).get("readDays"))
        or _coerce_int(payload.get("monthly", {}).get("readDays"))
    )
    return {
        "weekReadDaily": week_read_daily,
        "weekReadMinutes": week_read_minutes,
        "totalReadDays": total_read_days,
        "dailyReadTimes": daily_read_times,
    }


def build_weread_time_data(stats, synced_at=""):
    payload = normalize_weread_stats(stats)
    derived = derive_weread_time_fields(payload)
    return {
        "source": "weread",
        "syncedAt": str(synced_at or "").strip(),
        "monthly": payload.get("monthly", {}),
        "annual": payload.get("annual", {}),
        "overall": payload.get("overall", {}),
        "dailyReadTimes": derived["dailyReadTimes"],
        "weekReadDaily": derived["weekReadDaily"],
        "weekReadMinutes": derived["weekReadMinutes"],
        "totalReadDays": derived["totalReadDays"],
    }


def merge_time_data(existing, weread_stats, weread_synced_at=""):
    payload = dict(existing) if isinstance(existing, dict) else {}
    payload["weread"] = build_weread_time_data(weread_stats, weread_synced_at)
    return payload
