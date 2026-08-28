from __future__ import annotations

import argparse
import asyncio
import json
import statistics
import time
from pathlib import Path
from typing import Sequence

from .config import load_settings
from .inference import YoloCudaBackend, decode_frame


def summarize_latencies(latencies_seconds: Sequence[float]) -> dict[str, float | int]:
    if not latencies_seconds:
        raise ValueError("At least one latency sample is required.")
    ordered = sorted(latencies_seconds)
    p50 = statistics.median(ordered)
    p95 = _percentile(ordered, 0.95)
    mean = statistics.fmean(ordered)
    return {
        "samples": len(ordered),
        "p50Ms": round(p50 * 1_000, 3),
        "p95Ms": round(p95 * 1_000, 3),
        "resultsPerSecond": round(1 / mean, 3),
    }


async def run_benchmark(
    image_path: Path, *, iterations: int, warmup: int
) -> dict[str, object]:
    settings = load_settings()
    frame = image_path.read_bytes()
    mime = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp"}.get(
        image_path.suffix.lower()
    )
    if mime is None:
        raise ValueError("Benchmark image must be JPEG or WebP.")
    tensor, transform = decode_frame(
        frame,
        declared_mime=mime,
        max_frame_bytes=settings.max_frame_bytes,
        max_width=settings.max_width,
        max_height=settings.max_height,
    )
    backend = YoloCudaBackend.load(
        settings.model_path,
        warmup_runs=warmup,
    )
    latencies: list[float] = []
    hand_counts: list[int] = []
    for _ in range(iterations):
        started = time.perf_counter()
        hands = backend.infer(tensor, transform)
        latencies.append(time.perf_counter() - started)
        hand_counts.append(len(hands))
    return {
        "provider": "CUDAExecutionProvider",
        "device": backend.device,
        "modelRevision": "2abb91a7030e1aa5231ec900ccb2c07ab3f03460",
        **summarize_latencies(latencies),
        "minimumHands": min(hand_counts),
        "maximumHands": max(hand_counts),
    }


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Benchmark pinned CommandCanvas YOLO hand-pose inference on native CUDA."
    )
    parser.add_argument("--image", type=Path, required=True)
    parser.add_argument("--iterations", type=int, default=200)
    parser.add_argument("--warmup", type=int, default=10)
    arguments = parser.parse_args()
    if arguments.iterations < 1 or arguments.warmup < 1:
        parser.error("iterations and warmup must be positive")
    result = asyncio.run(
        run_benchmark(
            arguments.image,
            iterations=arguments.iterations,
            warmup=arguments.warmup,
        )
    )
    print(json.dumps(result, indent=2, sort_keys=True))


def _percentile(ordered: Sequence[float], fraction: float) -> float:
    position = (len(ordered) - 1) * fraction
    lower = int(position)
    upper = min(lower + 1, len(ordered) - 1)
    weight = position - lower
    return ordered[lower] * (1 - weight) + ordered[upper] * weight


if __name__ == "__main__":
    main()
