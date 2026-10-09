import unittest
from datetime import date, datetime
from unittest.mock import patch

from engine import Settings, backtest, forecast
from feeds import Bar, DataError, fetch_history, normalize_cafef, normalize_dnse, parse_csv_files, parse_date


class FeedTests(unittest.TestCase):
    def test_dnse_timestamp_uses_vietnam_trading_date_and_rejects_duplicates(self):
        stamp = int(datetime.fromisoformat("2026-09-24T00:00:00+07:00").timestamp())
        payload = {"t": [stamp, stamp + 86400], "o": [10, 11], "h": [12, 12],
                   "l": [9, 10], "c": [11, 11], "v": [100, 120]}
        self.assertEqual(normalize_dnse(payload)[0].date, "2026-09-24")
        with self.assertRaises(DataError):
            normalize_dnse({**payload, "t": [stamp, stamp]})

    def test_cafef_and_csv_require_consistent_daily_bars(self):
        records = [{"Ngay": "25/09/2026", "GiaMoCua": 11, "GiaCaoNhat": 12,
                    "GiaThapNhat": 10, "GiaDongCua": 11, "KhoiLuongKhopLenh": 100},
                   {"Ngay": "24/09/2026", "GiaMoCua": 10, "GiaCaoNhat": 11,
                    "GiaThapNhat": 9, "GiaDongCua": 10, "KhoiLuongKhopLenh": 90}]
        self.assertEqual(normalize_cafef({"Data": {"Data": records}})[0].date, "2026-09-24")
        csv = b"ticker,date,open,high,low,close,volume\nFPT,2026-09-24,10,11,9,10,100\nFPT,2026-09-24,10,11,9,10,100\n"
        with self.assertRaisesRegex(DataError, "Duplicate"):
            parse_csv_files([("prices.csv", csv)])
        records[1]["GiaCaoNhat"] = 8
        with self.assertRaisesRegex(DataError, "Inconsistent"):
            normalize_cafef({"Data": {"Data": records}})

    def test_each_fetch_is_new_and_provider_is_not_substituted(self):
        stamp = int(datetime.fromisoformat("2026-09-24T00:00:00+07:00").timestamp())
        payload = {"t": [stamp, stamp + 86400], "o": [10, 11], "h": [11, 12],
                   "l": [9, 10], "c": [10, 11], "v": [100, 110]}
        with patch("feeds._get_json", side_effect=[payload, payload]) as request:
            a = fetch_history("DNSE", "FPT", date(2026, 9, 24), date(2026, 9, 25))
            b = fetch_history("DNSE", "FPT", date(2026, 9, 24), date(2026, 9, 25))
        self.assertEqual(request.call_count, 2)
        self.assertEqual(a.source, b.source)
        with patch("feeds._get_json", side_effect=DataError("offline")) as request:
            with self.assertRaisesRegex(DataError, "No signal"):
                fetch_history("DNSE", "FPT", date(2026, 9, 24), date(2026, 9, 25))
            self.assertEqual(request.call_count, 2)  # two DNSE hosts, never CafeF

    def test_invalid_calendar_date_rejected(self):
        with self.assertRaises(DataError):
            parse_date("31/02/2026")


class ModelTests(unittest.TestCase):
    def test_signal_uses_next_open_stop_and_costs(self):
        bars = [Bar("2026-09-21", 10, 11, 9, 10, 100),
                Bar("2026-09-22", 12, 12.5, 11.3, 12, 100),
                Bar("2026-09-23", 10, 11, 8, 9, 100)]
        trial = backtest(bars, Settings(strategy="hold", fee_pct=0.25, stop_pct=7))
        self.assertEqual(trial["trades"][0]["entry_date"], "2026-09-22")
        self.assertEqual(trial["trades"][0]["exit_date"], "2026-09-23")
        self.assertEqual(trial["trades"][0]["reason"], "Stop gap")
        self.assertLess(trial["return_pct"], 0)

    def test_forecast_does_not_change_historical_backtest(self):
        bars = [Bar(date(2026, 8, 1).fromordinal(date(2026, 8, 1).toordinal() + i).isoformat(),
                    10 + i, 11 + i, 9 + i, 10 + i, 100) for i in range(23)]
        before = backtest(bars, Settings(strategy="hold"))["return_pct"]
        points = forecast(bars, "momentum")
        self.assertEqual(len(points), 10)
        self.assertEqual(before, backtest(bars, Settings(strategy="hold"))["return_pct"])


if __name__ == "__main__":
    unittest.main()
