from __future__ import annotations

from pathlib import Path
import sys
import unittest


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "web"))

from services.weread_store import merge_weread_notes_store, merge_weread_store, normalize_weread_note  # noqa: E402


class WeReadStoreTest(unittest.TestCase):
    def test_merge_weread_store_merges_existing_book(self):
        merged = merge_weread_store(
            {"books": [{"id": 12, "_bookId": "book-1", "title": "旧标题"}]},
            {"books": [{"_bookId": "book-1", "title": "新标题", "progressPercent": "42"}], "syncedAt": "now"},
        )

        self.assertEqual(len(merged["books"]), 1)
        self.assertEqual(merged["books"][0]["title"], "新标题")
        self.assertEqual(merged["books"][0]["progressPercent"], 42)
        self.assertEqual(merged["syncedAt"], "now")

    def test_merge_weread_notes_store_deduplicates_by_source_item_id(self):
        merged = merge_weread_notes_store(
            {"notes": [{"id": 5, "sourceItemId": "note-1", "title": "旧笔记", "summary": "旧"}]},
            {"notes": [{"sourceItemId": "note-1", "title": "新笔记", "summary": "新"}]},
        )

        self.assertEqual(len(merged["notes"]), 1)
        self.assertEqual(merged["notes"][0]["title"], "新笔记")
        self.assertEqual(merged["notes"][0]["summary"], "新")

    def test_normalize_weread_note_derives_updated_at_from_source_time(self):
        note = normalize_weread_note({"sourceUpdatedAt": "2026-05-21 10:30", "tags": ["微信读书", ""]})

        self.assertEqual(note["updatedAt"], "2026-05-21")
        self.assertEqual(note["tags"], ["微信读书"])


if __name__ == "__main__":
    unittest.main()
