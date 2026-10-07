"""Dated local diary edits, with the same body/version contract as the Worker."""

from datetime import date, datetime, timedelta, timezone

from services.diary_store import effective_diary_date


def update_diary_entry(diary, body):
    if not isinstance(body, dict):
        return 400, {"error": "日期或保存基线无效"}, None
    day = body.get("date")
    try:
        valid_day = isinstance(day, str) and date.fromisoformat(day).isoformat() == day
    except (ValueError, TypeError):
        valid_day = False
    if not valid_day or day > effective_diary_date() or any(
        not isinstance(body.get(key), str) for key in ("content", "expectedContent", "expectedUpdatedAt")
    ):
        return 400, {"error": "日期或保存基线无效"}, None
    current = diary["today"] if diary["today"]["date"] == day else next(
        (entry for entry in diary.get("archive", []) if entry["date"] == day), None
    )
    if current is None:
        return 404, {"error": "这一天的日记已不存在"}, None
    if current["content"] != body["expectedContent"] or (current.get("updatedAt") or "") != body["expectedUpdatedAt"]:
        return 409, {"error": "这一天的日记已被修改", "entry": current}, None
    now = datetime.now(timezone.utc)
    try:
        old = datetime.fromisoformat(current.get("updatedAt", "").replace("Z", "+00:00"))
        if old.tzinfo is not None:
            now = max(now, old + timedelta(milliseconds=1))
    except ValueError:
        pass
    entry = {**current, "content": body["content"], "updatedAt": now.isoformat(timespec="milliseconds").replace("+00:00", "Z")}
    saved = {**diary}
    if diary["today"]["date"] == day:
        saved["today"] = entry
    else:
        saved["archive"] = [entry if item["date"] == day else item for item in diary["archive"]]
    return 200, {"ok": True, "entry": entry}, saved
