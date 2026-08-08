"""Tests for the offline data pipeline. Standard library only, no network.

Run from code/scripts:  python -m unittest test_pipeline -v
"""

import unittest
from datetime import datetime, timezone

import build_deck as bd
import fetch_yahoo as fy
import fetch_polygon as fp


def epoch(year, month, day, hour=0):
    return int(datetime(year, month, day, hour, tzinfo=timezone.utc).timestamp())


def bar(t, o=None, h=None, l=None, c=100.0, v=1000.0):
    """A bar defaulting to a flat candle at `c`."""
    return {
        "t": t,
        "o": c if o is None else o,
        "h": c if h is None else h,
        "l": c if l is None else l,
        "c": c,
        "v": v,
    }


def daily_series(n, start_day=1, start_price=100.0, step=1.0):
    """`n` consecutive daily bars rising by `step` each day."""
    out = []
    for i in range(n):
        price = start_price + i * step
        out.append(bar(epoch(2020, 1, 1) + i * 86400, c=price, h=price + 0.5, l=price - 0.5))
    _ = start_day
    return out


class MonthlyAggregation(unittest.TestCase):
    def test_aggregates_open_high_low_close_and_volume_per_month(self):
        days = [
            bar(epoch(2021, 3, 1), o=10, h=12, l=9, c=11, v=100),
            bar(epoch(2021, 3, 15), o=11, h=15, l=8, c=14, v=200),
            bar(epoch(2021, 3, 31), o=14, h=14, l=13, c=13, v=300),
            bar(epoch(2021, 4, 1), o=13, h=20, l=13, c=19, v=400),
            # A trailing month that will be discarded as partial.
            bar(epoch(2021, 5, 3), o=19, h=21, l=18, c=20, v=500),
        ]
        months = bd.aggregate_monthly(days)
        self.assertEqual(len(months), 2, "the trailing month is dropped")
        march = months[0]
        self.assertEqual(march["o"], 10)
        self.assertEqual(march["h"], 15)
        self.assertEqual(march["l"], 8)
        self.assertEqual(march["c"], 13)
        self.assertEqual(march["v"], 600)

    def test_a_month_with_a_single_trading_day_still_aggregates(self):
        days = [
            bar(epoch(2021, 3, 10), o=1, h=2, l=0.5, c=1.5, v=10),
            bar(epoch(2021, 4, 10), c=2),
        ]
        months = bd.aggregate_monthly(days)
        self.assertEqual(len(months), 1)
        self.assertEqual(months[0]["c"], 1.5)

    def test_no_full_months_yields_nothing(self):
        self.assertEqual(bd.aggregate_monthly([bar(epoch(2021, 3, 10))]), [])
        self.assertEqual(bd.aggregate_monthly([]), [])


class WindowSlicing(unittest.TestCase):
    def test_windows_have_exact_setup_and_future_lengths(self):
        bars = daily_series(200)
        for horizon in (1, 5, 20):
            windows = bd.slice_windows(bars, horizon)
            self.assertTrue(windows, f"horizon {horizon} produced no windows")
            for w in windows:
                self.assertEqual(len(w["setup"]), bd.SETUP_LENGTH)
                self.assertEqual(len(w["future"]), horizon)

    def test_accepted_windows_are_at_least_the_stride_apart(self):
        windows = bd.slice_windows(daily_series(400), 5)
        starts = [w["start"] for w in windows]
        self.assertTrue(len(starts) >= 2)
        for a, b in zip(starts, starts[1:]):
            self.assertGreaterEqual(b - a, bd.STRIDE)

    def test_the_last_window_fits_entirely_inside_the_series(self):
        bars = daily_series(200)
        for horizon in (1, 5, 20):
            last = bd.slice_windows(bars, horizon)[-1]
            self.assertLessEqual(last["start"] + bd.SETUP_LENGTH + horizon, len(bars))

    def test_a_series_one_bar_too_short_yields_nothing(self):
        exactly_enough = daily_series(bd.SETUP_LENGTH + 5)
        self.assertEqual(len(bd.slice_windows(exactly_enough, 5)), 1)
        too_short = daily_series(bd.SETUP_LENGTH + 4)
        self.assertEqual(bd.slice_windows(too_short, 5), [])


class AnswerAndTies(unittest.TestCase):
    def test_answer_follows_the_final_future_close(self):
        setup = daily_series(60)
        self.assertEqual(bd.answer_of(setup, [bar(0, c=setup[-1]["c"] * 1.10)]), "up")
        self.assertEqual(bd.answer_of(setup, [bar(0, c=setup[-1]["c"] * 0.90)]), "down")

    def test_a_move_below_the_tie_threshold_has_no_answer(self):
        setup = daily_series(60)
        last = setup[-1]["c"]
        half = last * bd.TIE_THRESHOLD * 0.5
        self.assertIsNone(bd.answer_of(setup, [bar(0, c=last + half)]))
        self.assertIsNone(bd.answer_of(setup, [bar(0, c=last - half)]))
        self.assertIsNone(bd.answer_of(setup, [bar(0, c=last)]), "no move at all")

    def test_a_move_clearly_above_the_tie_threshold_counts(self):
        # The exact boundary is deliberately not asserted. At these price levels no
        # future close can sit exactly TIE_THRESHOLD away from the last setup close:
        # adding 0.0795 to 159.0 and subtracting it back yields 0.07949999999999591,
        # short by 4e-15. The ratio form loses the same precision. Since the rule
        # exists only to drop coin-flip questions, whether a 0.049999% move is kept
        # is not a product-meaningful distinction, and pinning it down would be
        # asserting IEEE754 rounding rather than behaviour.
        setup = daily_series(60)
        last = setup[-1]["c"]
        step = last * bd.TIE_THRESHOLD * 2
        self.assertEqual(bd.answer_of(setup, [bar(0, c=last + step)]), "up")
        self.assertEqual(bd.answer_of(setup, [bar(0, c=last - step)]), "down")


class RejectionRules(unittest.TestCase):
    def setUp(self):
        # One contiguous series split into setup and future, so the gap rule sees a
        # realistic timeline. Building the two halves independently would restart
        # the clock and trip the gap check on an otherwise clean window.
        series = daily_series(65)
        self.setup = series[:60]
        self.future = series[60:]
        self.max_gap = 5 * 86400

    def reason(self, setup=None, future=None):
        return bd.reject_reason(
            setup if setup is not None else self.setup,
            future if future is not None else self.future,
            self.max_gap,
        )

    def test_a_clean_window_is_accepted(self):
        self.assertIsNone(self.reason())

    def test_zero_volume_anywhere_in_the_setup_is_rejected(self):
        broken = [dict(b) for b in self.setup]
        broken[17]["v"] = 0
        self.assertEqual(self.reason(setup=broken), "volume")

    def test_zero_volume_anywhere_in_the_future_is_rejected(self):
        broken = [dict(b) for b in self.future]
        broken[-1]["v"] = 0
        self.assertEqual(self.reason(future=broken), "volume")

    def test_missing_volume_is_rejected(self):
        broken = [dict(b) for b in self.setup]
        broken[3]["v"] = None
        self.assertEqual(self.reason(setup=broken), "volume")

    def test_a_high_below_its_low_is_rejected(self):
        broken = [dict(b) for b in self.setup]
        broken[5]["h"] = broken[5]["l"] - 1
        self.assertEqual(self.reason(setup=broken), "corrupt")

    def test_a_close_outside_the_high_low_range_is_rejected(self):
        broken = [dict(b) for b in self.setup]
        broken[5]["c"] = broken[5]["h"] + 5
        self.assertEqual(self.reason(setup=broken), "corrupt")

    def test_a_non_positive_price_is_rejected(self):
        broken = [dict(b) for b in self.setup]
        broken[5] = bar(broken[5]["t"], o=0, h=0, l=0, c=0)
        self.assertEqual(self.reason(setup=broken), "corrupt")

    def test_a_long_gap_between_bars_is_rejected(self):
        broken = [dict(b) for b in self.setup]
        for b in broken[30:]:
            b["t"] += 86400 * 30
        self.assertEqual(self.reason(setup=broken), "gap")

    def test_a_gap_within_the_threshold_is_accepted(self):
        stretched = [dict(b) for b in self.setup]
        for b in stretched[30:]:
            b["t"] += 86400 * 3
        self.assertIsNone(self.reason(setup=stretched))

    def test_the_check_is_disabled_when_no_threshold_could_be_derived(self):
        broken = [dict(b) for b in self.setup]
        for b in broken[30:]:
            b["t"] += 86400 * 365
        self.assertIsNone(bd.reject_reason(broken, self.future, 0))


class GapThreshold(unittest.TestCase):
    """Regression cover for a bug that silently deleted an entire timeframe.

    The threshold was originally 5x the *median* bar gap. For hourly equity bars
    the median gap is one hour, but 60 hourly bars span about nine trading days, so
    every window contained an overnight close and the hourly timeframe produced
    zero questions. Nothing failed loudly — the bank was simply missing 1h.
    """

    @staticmethod
    def session_series(days, bars_per_day, bar_seconds, session_start=14 * 3600):
        """Bars inside a daily session, with a real overnight gap between days."""
        out = []
        for day in range(days):
            base = epoch(2024, 1, 1) + day * 86400 + session_start
            for i in range(bars_per_day):
                out.append(bar(base + i * bar_seconds, c=100 + day))
        return out

    def test_regular_overnight_closes_do_not_count_as_gaps(self):
        # Hourly bars, 7 per session, 30 sessions. A 60-bar window necessarily
        # straddles overnight closes.
        bars = self.session_series(days=30, bars_per_day=7, bar_seconds=3600)
        threshold = bd.gap_threshold(bars)
        windows = bd.slice_windows(bars, 5)
        self.assertTrue(windows, "fixture should produce windows")
        accepted = [
            w for w in windows if bd.reject_reason(w["setup"], w["future"], threshold) is None
        ]
        self.assertTrue(accepted, "overnight closes must not reject every hourly window")

    def test_a_genuine_hole_still_rejects(self):
        bars = self.session_series(days=30, bars_per_day=7, bar_seconds=3600)
        threshold = bd.gap_threshold(bars)
        holed = [dict(b) for b in bars]
        for b in holed[100:]:
            b["t"] += 86400 * 20
        window = {"setup": holed[70:130], "future": holed[130:135]}
        self.assertEqual(
            bd.reject_reason(window["setup"], window["future"], threshold), "gap"
        )

    def test_a_continuous_series_gets_a_tight_threshold(self):
        # 24/7 hourly bars: every gap is an hour, so the threshold is five hours.
        bars = [bar(epoch(2024, 1, 1) + i * 3600, c=100) for i in range(500)]
        self.assertEqual(bd.gap_threshold(bars), 5 * 3600)

    def test_a_series_too_short_to_measure_disables_the_check(self):
        self.assertEqual(bd.gap_threshold([]), 0)
        self.assertEqual(bd.gap_threshold([bar(1)]), 0)


class Balancing(unittest.TestCase):
    def test_every_bucket_ends_with_equal_up_and_down(self):
        candidates = []
        for i in range(30):
            candidates.append({"assetClass": "equity", "timeframe": "1d", "horizon": 5, "answer": "up", "id": f"u{i}"})
        for i in range(12):
            candidates.append({"assetClass": "equity", "timeframe": "1d", "horizon": 5, "answer": "down", "id": f"d{i}"})
        for i in range(4):
            candidates.append({"assetClass": "crypto", "timeframe": "1m", "horizon": 1, "answer": "up", "id": f"cu{i}"})
        for i in range(9):
            candidates.append({"assetClass": "crypto", "timeframe": "1m", "horizon": 1, "answer": "down", "id": f"cd{i}"})

        balanced = bd.balance_buckets(candidates, seed=1)
        buckets = {}
        for q in balanced:
            key = (q["assetClass"], q["timeframe"], q["horizon"])
            buckets.setdefault(key, []).append(q)

        self.assertEqual(len(buckets), 2)
        for key, items in buckets.items():
            ups = sum(1 for q in items if q["answer"] == "up")
            self.assertEqual(ups, len(items) - ups, f"bucket {key} is unbalanced")
        self.assertEqual(len(buckets[("equity", "1d", 5)]), 24, "capped by the smaller side")
        self.assertEqual(len(buckets[("crypto", "1m", 1)]), 8)

    def test_a_bucket_with_only_one_direction_is_dropped_entirely(self):
        candidates = [
            {"assetClass": "equity", "timeframe": "1d", "horizon": 5, "answer": "up", "id": f"u{i}"}
            for i in range(10)
        ]
        self.assertEqual(bd.balance_buckets(candidates, seed=1), [])

    def test_balancing_is_reproducible_for_a_given_seed(self):
        candidates = [
            {"assetClass": "equity", "timeframe": "1d", "horizon": 5,
             "answer": "up" if i % 2 else "down", "id": f"q{i}"}
            for i in range(40)
        ]
        first = [q["id"] for q in bd.balance_buckets(candidates, seed=7)]
        second = [q["id"] for q in bd.balance_buckets(candidates, seed=7)]
        self.assertEqual(first, second)


class QuestionIds(unittest.TestCase):
    def test_the_same_window_always_gets_the_same_id(self):
        a = bd.question_id("stooq", "aapl.us", "1d", 5, 1600000000)
        b = bd.question_id("stooq", "aapl.us", "1d", 5, 1600000000)
        self.assertEqual(a, b)
        self.assertEqual(len(a), 12)
        self.assertTrue(all(ch in "0123456789abcdef" for ch in a))

    def test_different_windows_get_different_ids(self):
        seen = set()
        for symbol in ("aapl.us", "msft.us"):
            for horizon in (1, 5, 20):
                for start in range(50):
                    seen.add(bd.question_id("stooq", symbol, "1d", horizon, start))
        self.assertEqual(len(seen), 2 * 3 * 50, "no collisions")

    def test_the_id_does_not_contain_the_symbol(self):
        self.assertNotIn("aapl", bd.question_id("stooq", "aapl.us", "1d", 5, 1600000000))


class ShippedBars(unittest.TestCase):
    def test_a_shipped_bar_carries_no_timestamp(self):
        shipped = bd.ship_bar(bar(1600000000, o=1.23456, h=2.34567, l=0.98765, c=1.5, v=1234.7))
        self.assertEqual(sorted(shipped.keys()), ["c", "h", "l", "o", "v"])

    def test_prices_are_rounded_to_four_significant_figures(self):
        shipped = bd.ship_bar(bar(0, o=61234.56789, h=61234.56789, l=61234.56789, c=61234.56789, v=1))
        self.assertEqual(shipped["c"], 61230.0)
        shipped_small = bd.ship_bar(bar(0, c=0.00123456, h=0.00123456, l=0.00123456, o=0.00123456, v=1))
        self.assertEqual(shipped_small["c"], 0.001235)

    def test_volume_is_an_integer(self):
        shipped = bd.ship_bar(bar(0, c=1, v=1234.7))
        self.assertIsInstance(shipped["v"], int)
        self.assertEqual(shipped["v"], 1235)


class YahooParsing(unittest.TestCase):
    @staticmethod
    def payload(timestamps, opens, highs, lows, closes, volumes):
        return {
            "chart": {
                "error": None,
                "result": [
                    {
                        "meta": {"symbol": "AAPL"},
                        "timestamp": timestamps,
                        "indicators": {
                            "quote": [
                                {
                                    "open": opens,
                                    "high": highs,
                                    "low": lows,
                                    "close": closes,
                                    "volume": volumes,
                                }
                            ]
                        },
                    }
                ],
            }
        }

    def test_parses_parallel_arrays_into_ascending_bars(self):
        bars = fy.parse_chart(
            self.payload(
                [1600000000, 1600086400],
                [74.06, 74.29],
                [75.15, 75.14],
                [73.80, 74.13],
                [75.09, 74.36],
                [135480400, 146322800],
            )
        )
        self.assertEqual(len(bars), 2)
        self.assertEqual(bars[0]["t"], 1600000000)
        self.assertEqual(bars[0]["o"], 74.06)
        self.assertEqual(bars[0]["c"], 75.09)
        self.assertEqual(bars[0]["v"], 135480400.0)
        self.assertLess(bars[0]["t"], bars[1]["t"])

    def test_skips_index_positions_with_null_fields(self):
        # Yahoo pads its arrays with nulls for sessions that produced no bar.
        bars = fy.parse_chart(
            self.payload(
                [1, 2, 3],
                [1.0, None, 3.0],
                [1.0, None, 3.0],
                [1.0, None, 3.0],
                [1.0, None, 3.0],
                [10, None, 30],
            )
        )
        self.assertEqual([b["t"] for b in bars], [1, 3])

    def test_a_null_volume_alone_drops_that_bar(self):
        bars = fy.parse_chart(
            self.payload([1, 2], [1.0, 2.0], [1.0, 2.0], [1.0, 2.0], [1.0, 2.0], [10, None])
        )
        self.assertEqual(len(bars), 1)

    def test_an_error_response_parses_to_nothing(self):
        self.assertEqual(fy.parse_chart({"chart": {"error": {"code": "Not Found"}, "result": None}}), [])
        self.assertEqual(fy.parse_chart({}), [])
        self.assertEqual(fy.parse_chart({"chart": {"result": []}}), [])

    def test_a_result_without_timestamps_parses_to_nothing(self):
        payload = self.payload([], [], [], [], [], [])
        del payload["chart"]["result"][0]["timestamp"]
        self.assertEqual(fy.parse_chart(payload), [])


class YahooGranularity(unittest.TestCase):
    """Regression cover for a silent data corruption.

    Requesting interval=1d with range=max makes Yahoo quietly return monthly or
    even quarterly bars — AAPL came back with a 91-day median gap — while still
    labelling the response as the daily series that was asked for. Cached as "1d",
    those bars would then have been aggregated into "monthly" questions built from
    quarterly data. Nothing would have failed; the bank would just have been wrong.

    The fetcher therefore verifies the spacing it got instead of trusting the label.
    """

    @staticmethod
    def spaced(count, seconds):
        return [bar(epoch(2020, 1, 1) + i * seconds, c=100 + i) for i in range(count)]

    def test_bars_matching_the_requested_timeframe_are_accepted(self):
        self.assertTrue(fy.granularity_ok(self.spaced(100, 60), "1m"))
        self.assertTrue(fy.granularity_ok(self.spaced(100, 3600), "1h"))
        self.assertTrue(fy.granularity_ok(self.spaced(100, 86400), "1d"))

    def test_coarser_bars_than_requested_are_rejected(self):
        self.assertFalse(fy.granularity_ok(self.spaced(100, 86400 * 91), "1d"), "quarterly")
        self.assertFalse(fy.granularity_ok(self.spaced(100, 86400 * 31), "1d"), "monthly")
        self.assertFalse(fy.granularity_ok(self.spaced(100, 86400 * 7), "1d"), "weekly")
        self.assertFalse(fy.granularity_ok(self.spaced(100, 86400), "1h"), "daily for hourly")

    def test_weekends_and_overnight_closes_do_not_fail_the_check(self):
        # Real daily data: five bars then a two-day weekend, repeated.
        bars = []
        t = epoch(2020, 1, 6)
        for week in range(30):
            for day in range(5):
                bars.append(bar(t + day * 86400, c=100 + week))
            t += 7 * 86400
        self.assertTrue(fy.granularity_ok(bars, "1d"))

    def test_too_few_bars_to_judge_is_not_a_rejection(self):
        self.assertTrue(fy.granularity_ok([], "1d"))
        self.assertTrue(fy.granularity_ok(self.spaced(1, 86400), "1d"))

    def test_an_unknown_timeframe_is_not_judged(self):
        self.assertTrue(fy.granularity_ok(self.spaced(100, 999), "1y"))


class PolygonParsing(unittest.TestCase):
    SAMPLE = {
        "status": "OK",
        "resultsCount": 2,
        "results": [
            {"t": 1600000000000, "o": 1.0, "h": 2.0, "l": 0.5, "c": 1.5, "v": 100},
            {"t": 1600000060000, "o": 1.5, "h": 2.5, "l": 1.0, "c": 2.0, "v": 200},
        ],
    }

    def test_converts_millisecond_timestamps_to_seconds(self):
        bars = fp.parse_aggregates(self.SAMPLE)
        self.assertEqual(len(bars), 2)
        self.assertEqual(bars[0]["t"], 1600000000)

    def test_a_response_with_no_results_parses_to_nothing(self):
        self.assertEqual(fp.parse_aggregates({"status": "OK", "resultsCount": 0}), [])
        self.assertEqual(fp.parse_aggregates({}), [])

    def test_rows_missing_fields_are_skipped(self):
        payload = {"results": [{"t": 1, "o": 1, "h": 2, "l": 0.5}, self.SAMPLE["results"][0]]}
        self.assertEqual(len(fp.parse_aggregates(payload)), 1)


class Resume(unittest.TestCase):
    def test_a_valid_cache_file_counts_as_done(self):
        import json
        import os
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "cached.json")
            self.assertFalse(fp.is_cached(path), "absent file is not cached")

            with open(path, "w", encoding="utf-8") as fh:
                fh.write('{"bars": [')
            self.assertFalse(fp.is_cached(path), "a truncated file must be refetched")

            with open(path, "w", encoding="utf-8") as fh:
                json.dump({"source": "polygon", "bars": [bar(1)]}, fh)
            self.assertTrue(fp.is_cached(path))


if __name__ == "__main__":
    unittest.main()


class SelectDemoQuestions(unittest.TestCase):
    """The four questions the landing page plays on loop."""

    @staticmethod
    def q(qid, timeframe="1d"):
        return {
            "id": qid,
            "assetClass": "equity",
            "timeframe": timeframe,
            "horizon": 5,
            "setup": [{"o": 1, "h": 1, "l": 1, "c": 1, "v": 1}],
            "future": [{"o": 1, "h": 1, "l": 1, "c": 1, "v": 1}],
            "answer": "up",
        }

    def test_picks_the_requested_count(self):
        pool = [self.q(f"q{i:03d}") for i in range(40)]
        self.assertEqual(len(bd.select_demo_questions(pool, count=4)), 4)

    def test_picks_distinct_questions(self):
        pool = [self.q(f"q{i:03d}") for i in range(40)]
        chosen = bd.select_demo_questions(pool, count=4)
        self.assertEqual(len({q["id"] for q in chosen}), 4)

    def test_is_deterministic(self):
        pool = [self.q(f"q{i:03d}") for i in range(40)]
        first = [q["id"] for q in bd.select_demo_questions(pool, count=4)]
        second = [q["id"] for q in bd.select_demo_questions(list(reversed(pool)), count=4)]
        self.assertEqual(first, second)

    def test_spreads_across_timeframes_when_it_can(self):
        pool = []
        for timeframe in ("1m", "1h", "1d", "1mo"):
            pool += [self.q(f"{timeframe}-{i:03d}", timeframe) for i in range(10)]
        chosen = bd.select_demo_questions(pool, count=4)
        self.assertEqual(len({q["timeframe"] for q in chosen}), 4)

    def test_handles_a_bank_smaller_than_the_count(self):
        pool = [self.q("q000"), self.q("q001")]
        self.assertEqual(len(bd.select_demo_questions(pool, count=4)), 2)

    def test_handles_an_empty_bank(self):
        self.assertEqual(bd.select_demo_questions([], count=4), [])
