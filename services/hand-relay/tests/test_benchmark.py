from __future__ import annotations

from commandcanvas_hand_relay.benchmark import summarize_latencies


def test_benchmark_reports_p50_p95_and_results_per_second() -> None:
    summary = summarize_latencies([0.010, 0.020, 0.030, 0.040, 0.050])

    assert summary == {
        "samples": 5,
        "p50Ms": 30.0,
        "p95Ms": 48.0,
        "resultsPerSecond": 33.333,
    }
