from __future__ import annotations

from pathlib import Path
import sys
import unittest


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "web"))

from services.diary_store import merge_diary  # noqa: E402


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


if __name__ == "__main__":
    unittest.main()
