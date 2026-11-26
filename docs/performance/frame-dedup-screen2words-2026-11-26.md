# Screen2Words frame de-duplication benchmark

Run date: 2026-11-26

This run extends the synthetic four-slide measurement to 16 real, licensed
Screen2Words app screenshots. The raw machine-readable result is in
[frame-dedup-screen2words-2026-11-26.json](frame-dedup-screen2words-2026-11-26.json).

## Result

The 16 screenshots were shown in order for three seconds each in a generated
48-second, 360×640, 5-fps video. Production extraction sampled at 1 fps with
hybrid scene detection. Both fixed and raw hybrid sampling emitted 48 candidate
frames. Conservative de-duplication retained 17 frames, avoiding 31 redundant
vision/OCR calls: a 64.58% reduction.

The 17th retained frame is timestamp `47` seconds. The other retained frames are
the 16 screenshot boundaries at `0, 3, …, 45` seconds. This retains one frame
for every real visual state and also preserves the final frame of the recording.

| Mode | Frames sent to vision | Extraction time | De-dup time |
| --- | ---: | ---: | ---: |
| Fixed, 1 fps | 48 | 2321.9 ms | n/a |
| Hybrid, raw | 48 | 1774.9 ms | n/a |
| Hybrid + de-dup | 17 | 1774.9 ms | 467.0 ms |

All 16 input states were represented in the raw and retained samples. No state
was lost. The largest RMS pixel difference for a removed adjacent frame was
0.1534, well below the configured 1.25 acceptance ceiling, and there were no
fingerprint errors.

## Dataset and method

- Dataset: `bevaya/RICO-Screen2Words`, 16 real test screenshots spanning distinct
  apps and screen states.
- License: CC-BY-4.0; attribution and item hashes are recorded in the JSON.
- The downloader validated each image hash before the benchmark loaded it.
- The benchmark calls the production `extract_frames` and
  `deduplicate_similar_frames` functions with the default scene and de-dup
  thresholds.
- The evidence gate fails if any state visible in raw sampling disappears after
  de-duplication.

These timings are one run on FFmpeg 9.0.2, Python 3.13.18, and Pillow 13.0.0.
Wall-clock values vary by host.

## Reproduction

From the repository root:

```bash
node scripts/download-heldout-evaluation-corpus.mjs .artifacts/heldout-frame-dedup
OPENCONTEXT_SKIP_DOTENV=1 \
  uv run --directory workers/processor \
  python ../../scripts/benchmark-frame-dedup-corpus.py \
  --corpus ../../.artifacts/heldout-frame-dedup \
  --out ../../docs/performance/frame-dedup-screen2words-2026-11-26.json \
  --require-no-loss
```

## Limits

- This is a curated sequence of still screenshots, not a timed recording with
  transitions, motion blur, notifications, or changing video content.
- Retained-state coverage does not measure OCR accuracy or hosted-model quality.
- Counts assume one vision and one OCR request per selected frame.
- This evidence supports the conservative defaults on a broader set of real app
  states, but it is not a statistically representative general benchmark.
