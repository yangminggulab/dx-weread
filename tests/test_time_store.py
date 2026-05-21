from __future__ import annotations

from pathlib import Path
import sys
import unittest


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "web"))

from services.time_store import normalize_time_data  # noqa: E402


class TimeStoreTest(unittest.TestCase):
    def test_normalize_time_data_keeps_weread_time_shape(self):
        normalized = normalize_time_data(
            {
                "weread": {
                    "syncedAt": " 2026-05-21T14:23:37 ",
                    "overall": {"readDays": "290"},
                    "dailyReadTimes": [{"date": "2026-05-20", "seconds": "381"}],
                    "weekReadMinutes": "79",
                    "totalReadDays": "290",
                },
                "custom": {"kept": True},
            }
        )

        self.assertEqual(normalized["custom"], {"kept": True})
        self.assertEqual(normalized["weread"]["syncedAt"], "2026-05-21T14:23:37")
        self.assertEqual(normalized["weread"]["overall"]["readDays"], 290)
        self.assertEqual(normalized["weread"]["dailyReadTimes"][0]["seconds"], 381)
        self.assertEqual(normalized["weread"]["weekReadMinutes"], 79)
        self.assertEqual(normalized["weread"]["totalReadDays"], 290)


if __name__ == "__main__":
    unittest.main()
