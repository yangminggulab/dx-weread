from __future__ import annotations

from pathlib import Path
import sys
import unittest


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from sync.weread.service import _fetch_recent_daily_read_times  # noqa: E402


class FakeClient:
    def __init__(self, monthly_payloads):
        self.monthly_payloads = list(monthly_payloads)
        self.calls = []

    def call(self, api_name, **params):
        self.calls.append((api_name, params))
        return self.monthly_payloads.pop(0)


class WeReadServiceStatsTest(unittest.TestCase):
    def test_fetch_recent_daily_read_times_merges_previous_months(self):
        current = {"readTimes": {"1777564800": 240}}
        client = FakeClient(
            [
                {"readTimes": {"1774972800": 600}},
                {"readTimes": {"1772294400": 900}},
            ]
        )

        days = _fetch_recent_daily_read_times(client, current, month_count=3)

        self.assertEqual([day["date"] for day in days], ["2026-03-01", "2026-04-01", "2026-05-01"])
        self.assertEqual([day["seconds"] for day in days], [900, 600, 240])
        self.assertEqual(len(client.calls), 2)


if __name__ == "__main__":
    unittest.main()
