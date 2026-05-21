from __future__ import annotations

from pathlib import Path
import sys
import unittest


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "web"))

from services.storage import merge_app_and_special_data  # noqa: E402
from services.weread_stats import merge_weread_stats, normalize_weread_stats  # noqa: E402


class WeReadStatsTest(unittest.TestCase):
    def test_normalizes_string_seconds_and_discards_invalid_days(self):
        stats = normalize_weread_stats(
            {
                "dailyReadTimes": [
                    {"date": "2026-05-20", "timestamp": 1779206400000, "seconds": "381"},
                    {"date": "", "seconds": 120},
                    {"date": "2026-05-21", "seconds": -1},
                ]
            }
        )

        self.assertEqual(stats["dailyReadTimes"], [{"date": "2026-05-20", "timestamp": 1779206400000, "seconds": 381}])

    def test_time_weread_backfills_top_level_stats_for_api_payload(self):
        data = merge_app_and_special_data(
            {"tasks": [], "books": [], "notes": [], "updates": []},
            {},
            {},
            {
                "weread": {
                    "syncedAt": "2026-05-21T14:23:37",
                    "overall": {"readDays": 290},
                    "dailyReadTimes": [{"date": "2026-05-20", "seconds": 381}],
                }
            },
        )

        self.assertEqual(data["wereadSyncedAt"], "2026-05-21T14:23:37")
        self.assertEqual(data["wereadStats"]["dailyReadTimes"][0]["seconds"], 381)
        self.assertEqual(data["time"]["weread"]["dailyReadTimes"][0]["minutes"], 6)
        self.assertEqual(data["totalReadDays"], 290)

    def test_primary_stats_win_over_time_fallback(self):
        merged = merge_weread_stats(
            {"dailyReadTimes": [{"date": "2026-05-21", "seconds": 900}]},
            {"dailyReadTimes": [{"date": "2026-05-20", "seconds": 381}]},
        )

        self.assertEqual(merged["dailyReadTimes"], [{"date": "2026-05-21", "timestamp": 0, "seconds": 900}])


if __name__ == "__main__":
    unittest.main()
