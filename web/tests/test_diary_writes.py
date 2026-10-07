from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from services.diary_writes import update_diary_entry


class DatedDiaryWriteTest(unittest.TestCase):
    def fixture(self):
        return {"today": {"date": "2026-10-07", "content": "Today", "updatedAt": "v1"},
                "archive": [{"date": "2026-10-06", "content": "Long past body", "updatedAt": "a1", "tagScores": {"焦虑内耗": 4}}]}

    @patch("services.diary_writes.effective_diary_date", return_value="2026-10-07")
    def test_history_clear_preserves_metadata_and_today(self, _):
        diary = self.fixture()
        status, receipt, saved = update_diary_entry(diary, {"date": "2026-10-06", "content": "", "expectedContent": "Long past body", "expectedUpdatedAt": "a1"})
        self.assertEqual(status, 200)
        self.assertEqual(saved["today"], diary["today"])
        self.assertEqual(saved["archive"][0]["content"], "")
        self.assertEqual(receipt["entry"]["tagScores"], {"焦虑内耗": 4})
        self.assertTrue(receipt["entry"]["updatedAt"])

    @patch("services.diary_writes.effective_diary_date", return_value="2026-10-07")
    def test_stale_baseline_and_invalid_date_do_not_write(self, _):
        for fields, expected in [({"expectedUpdatedAt": "old"}, 409), ({"expectedContent": "old"}, 409), ({"date": "2026-02-30"}, 400), ({"date": "2026-10-08"}, 400), ({"date": "2020-01-01"}, 404)]:
            body = {"date": "2026-10-07", "content": "New", "expectedContent": "Today", "expectedUpdatedAt": "v1", **fields}
            status, receipt, saved = update_diary_entry(self.fixture(), body)
            self.assertEqual(status, expected)
            self.assertIsNone(saved)

    @patch("services.diary_writes.effective_diary_date", return_value="2026-10-07")
    def test_shorter_raw_text_replaces_body_without_cleaning(self, _):
        status, receipt, _ = update_diary_entry(self.fixture(), {"date": "2026-10-07", "content": "  a\n\n", "expectedContent": "Today", "expectedUpdatedAt": "v1"})
        self.assertEqual(status, 200)
        self.assertEqual(receipt["entry"]["content"], "  a\n\n")

    def test_local_route_receipt_matches_disk_and_stale_followup_is_rejected(self):
        from tempfile import TemporaryDirectory
        from routes.api import handle_request
        from services.diary_store import write_diary_file
        with TemporaryDirectory() as directory, patch('services.diary_store.DIARY_FILE', Path(directory) / 'diary.json'), patch('services.diary_store.backup_file'), patch('services.diary_store.effective_diary_date', return_value='2026-10-07'), patch('services.diary_writes.effective_diary_date', return_value='2026-10-07'):
            write_diary_file(self.fixture())
            body = {'date': '2026-10-06', 'content': '  08:30 原始文本\n\n', 'expectedContent': 'Long past body', 'expectedUpdatedAt': 'a1'}
            status, receipt = handle_request('POST', '/api/diary/entry', body)
            self.assertEqual(status, 200)
            status, saved = handle_request('GET', '/api/diary', None)
            self.assertEqual(status, 200)
            self.assertEqual(saved['archive'][0]['content'], body['content'])
            self.assertEqual(saved['archive'][0]['updatedAt'], receipt['entry']['updatedAt'])
            status, _ = handle_request('POST', '/api/diary/entry', {**body, 'content': 'Stale'})
            self.assertEqual(status, 409)
