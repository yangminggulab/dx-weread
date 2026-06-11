"""Diary normalization, archive, merge, and persistence helpers."""

from __future__ import annotations

from datetime import datetime, timedelta

from services.config import DIARY_FILE
from services.json_store import backup_file, load_json_file, write_json_file


DIARY_TAGS = [
    "学习卡壳",
    "复习考试",
    "焦虑内耗",
    "灾难化",
    "失眠亢奋",
    "安静恢复",
    "计划执行",
    "决策止损",
    "求职面试",
    "人际边界",
]


def empty_diary():
    return {"today": {"date": "", "content": ""}, "archive": []}


def _coerce_diary_view_count(value):
    try:
        return max(0, int(value))
    except (TypeError, ValueError):
        return 0


def _clean_diary_content(text: str) -> str:
    import re as _re

    if not text:
        return ""
    text = _re.sub(r"Your browser does not support the (video|audio) tag\.?", "", text, flags=_re.IGNORECASE)
    text = _re.sub(r"\d{1,2}:\d{2}\s*", "", text)
    if "\n\n---\n" in text:
        text = text.split("\n\n---\n")[0]
    return text.strip()


def _coerce_tag_score(value):
    try:
        return min(5, max(0, int(value)))
    except (TypeError, ValueError):
        return 0


def _normalize_diary_tags(value):
    if not isinstance(value, list):
        return []
    seen = set()
    tags = []
    for item in value:
        tag = str(item or "").strip()
        if tag in DIARY_TAGS and tag not in seen:
            seen.add(tag)
            tags.append(tag)
    return tags


def _normalize_diary_tag_scores(scores, tags=None):
    normalized = {}
    if isinstance(scores, dict):
        for key, value in scores.items():
            tag = str(key or "").strip()
            if tag in DIARY_TAGS:
                score = _coerce_tag_score(value)
                if score > 0:
                    normalized[tag] = score
    for tag in _normalize_diary_tags(tags):
        normalized.setdefault(tag, 1)
    return {tag: normalized[tag] for tag in DIARY_TAGS if tag in normalized}


def _entry_with_normalized_tags(entry):
    tag_scores = _normalize_diary_tag_scores(entry.get("tagScores"), entry.get("tags"))
    tags = [tag for tag in DIARY_TAGS if tag_scores.get(tag, 0) > 0]
    return {**entry, "tags": tags, "tagScores": tag_scores}


def _merge_diary_tag_scores(left, right):
    left_scores = _normalize_diary_tag_scores((left or {}).get("tagScores"), (left or {}).get("tags"))
    right_scores = _normalize_diary_tag_scores((right or {}).get("tagScores"), (right or {}).get("tags"))
    merged = {}
    for tag in DIARY_TAGS:
        score = max(left_scores.get(tag, 0), right_scores.get(tag, 0))
        if score > 0:
            merged[tag] = score
    return merged


def _normalize_diary_archive_entry(entry):
    if not isinstance(entry, dict):
        return None
    date = str(entry.get("date", "")).strip()
    if not date:
        return None
    normalized = {
        **entry,
        "date": date,
        "content": str(entry.get("content", "")),
        "viewCount": _coerce_diary_view_count(entry.get("viewCount")),
        "lastViewedAt": str(entry.get("lastViewedAt", "")).strip(),
    }
    return _entry_with_normalized_tags(normalized)


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
    last_viewed_at = max(str(primary.get("lastViewedAt", "") or ""), str(secondary.get("lastViewedAt", "") or ""))
    tag_scores = _merge_diary_tag_scores(primary, secondary)
    return {
        **primary,
        "date": primary.get("date") or secondary.get("date") or "",
        "content": content,
        "viewCount": max(
            _coerce_diary_view_count(primary.get("viewCount")),
            _coerce_diary_view_count(secondary.get("viewCount")),
        ),
        "lastViewedAt": last_viewed_at,
        "tags": [tag for tag in DIARY_TAGS if tag_scores.get(tag, 0) > 0],
        "tagScores": tag_scores,
    }


def _timestamp_order(incoming, stored):
    incoming_updated_at = str((incoming or {}).get("updatedAt", "") or "").strip()
    stored_updated_at = str((stored or {}).get("updatedAt", "") or "").strip()
    if incoming_updated_at and stored_updated_at:
        return incoming_updated_at >= stored_updated_at
    if incoming_updated_at:
        return True
    return None


def _normalize_diary(diary):
    if not isinstance(diary, dict):
        return empty_diary()
    today = diary.get("today") if isinstance(diary.get("today"), dict) else {}
    archive = [
        normalized
        for normalized in (_normalize_diary_archive_entry(entry) for entry in (diary.get("archive") or []))
        if normalized
    ]
    return {
        "today": _entry_with_normalized_tags({
            **today,
            "date": str(today.get("date", "")).strip(),
            "content": str(today.get("content", "")),
        }),
        "archive": archive,
    }


def load_diary_file():
    return _normalize_diary(load_json_file(DIARY_FILE, empty_diary()))


def write_diary_file(diary):
    backup_file(DIARY_FILE, "diary", keep=1)
    write_json_file(DIARY_FILE, _normalize_diary(diary))


def effective_diary_date():
    now = datetime.now()
    if now.hour < 5:
        return (now - timedelta(days=1)).date().isoformat()
    return now.date().isoformat()


def archive_diary_if_needed(diary=None):
    today_str = effective_diary_date()
    if diary is None:
        diary = load_diary_file()
    diary = _normalize_diary(diary)
    today = diary["today"]
    archive = diary["archive"]

    existing_date = today.get("date", "")
    if existing_date and existing_date != today_str:
        if today.get("content", "").strip():
            archived_today = _normalize_diary_archive_entry(today)
            archive = sorted([*archive, archived_today] if archived_today else archive, key=lambda item: item.get("date", ""))
        today = {"date": today_str, "content": ""}
    elif not existing_date:
        today = {"date": today_str, "content": ""}

    return {"today": today, "archive": archive}


def merge_diary_update(stored_diary: dict, incoming_diary: dict) -> dict:
    incoming_raw_today = (incoming_diary or {}).get("today") if isinstance(incoming_diary, dict) else None
    incoming_today_has_tags = isinstance(incoming_raw_today, dict) and (
        "tags" in incoming_raw_today or "tagScores" in incoming_raw_today
    )
    stored_diary = archive_diary_if_needed(stored_diary)
    incoming_has_today = isinstance((incoming_diary or {}).get("today"), dict)
    incoming_diary = archive_diary_if_needed(incoming_diary)

    archive_map = {}
    for entry in [*stored_diary["archive"], *incoming_diary["archive"]]:
        date = entry.get("date")
        if not date:
            continue
        archive_map[date] = _merge_diary_archive_entry(archive_map.get(date), entry)

    stored_today = stored_diary["today"]
    incoming_today = incoming_diary["today"]
    merged_today = stored_today
    if incoming_has_today:
        timestamp_wins = _timestamp_order(incoming_today, stored_today)
        incoming_content = str(incoming_today.get("content", "") or "")
        stored_content = str(stored_today.get("content", "") or "")
        if timestamp_wins is True:
            merged_today = {**stored_today, **incoming_today}
        elif timestamp_wins is None and (incoming_content.strip() or not stored_content.strip()):
            merged_today = {**stored_today, **incoming_today}
        if not incoming_today_has_tags:
            merged_today = {
                **merged_today,
                "tags": stored_today.get("tags", []),
                "tagScores": stored_today.get("tagScores", {}),
            }
        else:
            tag_scores = _merge_diary_tag_scores(stored_today, incoming_today)
            merged_today = {
                **merged_today,
                "tags": [tag for tag in DIARY_TAGS if tag_scores.get(tag, 0) > 0],
                "tagScores": tag_scores,
            }

    valid_archive = [
        entry
        for entry in (_normalize_diary_archive_entry(value) for value in archive_map.values())
        if entry and str(entry.get("content", "")).strip()
    ]
    return {"today": merged_today, "archive": sorted(valid_archive, key=lambda item: item.get("date", ""))}


def merge_diary(local_diary: dict, cloud_diary: dict) -> dict:
    local_diary = _normalize_diary(local_diary)
    cloud_diary = _normalize_diary(cloud_diary)

    local_today = local_diary["today"]
    cloud_today = cloud_diary["today"]
    local_clean = _clean_diary_content(str(local_today.get("content", "")))
    cloud_clean = _clean_diary_content(str(cloud_today.get("content", "")))
    if len(cloud_clean) > len(local_clean):
        merged_today = {**cloud_today, "content": cloud_clean}
    else:
        merged_today = {**local_today, "content": local_clean} if local_clean else {**cloud_today, "content": cloud_clean}

    archive_map = {}
    for entry in local_diary["archive"]:
        if entry.get("date"):
            archive_map[entry["date"]] = _merge_diary_archive_entry(entry, {**entry, "content": _clean_diary_content(entry.get("content", ""))})
    for entry in cloud_diary["archive"]:
        date = entry.get("date")
        if not date:
            continue
        archive_map[date] = _merge_diary_archive_entry(
            archive_map.get(date),
            {**entry, "content": _clean_diary_content(entry.get("content", ""))},
        )

    valid = {
        date: _normalize_diary_archive_entry(entry)
        for date, entry in archive_map.items()
        if entry and entry.get("content", "").strip()
    }
    return {"today": merged_today, "archive": sorted([entry for entry in valid.values() if entry], key=lambda item: item.get("date", ""))}
