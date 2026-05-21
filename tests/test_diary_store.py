from __future__ import annotations

from pathlib import Path
import sys
import unittest


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "web"))

from services.diary_store import effective_diary_date, merge_diary, merge_diary_update  # noqa: E402


class DiaryStoreTest(unittest.TestCase):
    def test_merge_diary_keeps_longer_clean_today_content(self):
        merged = merge_diary(
            {"today": {"date": "2026-05-21", "content": "本地"}, "archive": []},
            {"today": {"date": "2026-05-21", "content": "云端内容更完整"}, "archive": []},
        )

        self.assertEqual(merged["today"]["content"], "云端内容更完整")

    def test_merge_diary_cleans_media_fallback_text_from_archive(self):
        merged = merge_diary(
            {
                "today": {"date": "2026-05-21", "content": ""},
                "archive": [
                    {
                        "date": "2026-05-20",
                        "content": "10:24 Your browser does not support the video tag. 正文",
                        "viewCount": "2",
                    }
                ],
            },
            {"today": {"date": "2026-05-21", "content": ""}, "archive": []},
        )

        self.assertEqual(merged["archive"][0]["content"], "正文")
        self.assertEqual(merged["archive"][0]["viewCount"], 2)

    def test_diary_update_preserves_archive_for_today_only_payload(self):
        today = effective_diary_date()
        merged = merge_diary_update(
            {
                "today": {"date": today, "content": "旧内容"},
                "archive": [{"date": "2026-05-20", "content": "昨天"}],
            },
            {"today": {"date": today, "content": "新内容"}, "archive": []},
        )

        self.assertEqual(merged["today"]["content"], "新内容")
        self.assertEqual(merged["archive"], [{"date": "2026-05-20", "content": "昨天", "viewCount": 0, "lastViewedAt": ""}])

    def test_diary_update_allows_timestamped_empty_today(self):
        today = effective_diary_date()
        merged = merge_diary_update(
            {"today": {"date": today, "content": "要删除", "updatedAt": "2026-05-21T01:00:00.000Z"}, "archive": []},
            {"today": {"date": today, "content": "", "updatedAt": "2026-05-21T01:01:00.000Z"}, "archive": []},
        )

        self.assertEqual(merged["today"]["content"], "")
        self.assertEqual(merged["today"]["updatedAt"], "2026-05-21T01:01:00.000Z")

    def test_diary_update_ignores_untimestamped_empty_today(self):
        today = effective_diary_date()
        merged = merge_diary_update(
            {"today": {"date": today, "content": "保留"}, "archive": []},
            {"today": {"date": today, "content": ""}, "archive": []},
        )

        self.assertEqual(merged["today"]["content"], "保留")


if __name__ == "__main__":
    unittest.main()
