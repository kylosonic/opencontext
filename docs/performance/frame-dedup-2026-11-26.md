# Hybrid frame de-duplication benchmark

Run date: 2026-11-26

This benchmark measures the Python post-sampling pass added for Phase 3. It
does not make a hosted-provider latency or model-quality claim. The raw output
is in [frame-dedup-2026-11-26.json](frame-dedup-2026-11-26.json).

## Result

The synthetic input was a 16-second, 640×360, 10-fps video containing four
four-second static slide states and a two-pixel moving marker. Fixed sampling
and raw hybrid sampling both selected 16 frames at one frame per second. The
conservative de-duplication pass retained five frames and 11 vision calls were
avoided, a 68.75% reduction relative to raw hybrid sampling.

| Mode | Frames sent to vision | Extraction time | De-dup time |
| --- | ---: | ---: | ---: |
| Fixed, 1 fps | 16 | 872.2 ms | n/a |
| Hybrid, raw | 16 | 618.0 ms | n/a |
| Hybrid + de-dup | 5 | 618.0 ms | 86.8 ms |

The retained timestamps were `0`, `4`, `8`, `12`, and `15` seconds. That
preserves every slide transition, the first frame, and the final frame. All
four synthetic slide labels were represented by a retained frame. The largest
RMS pixel difference for a removed adjacent frame was 0.4018, below the
configured 1.25 acceptance ceiling. There were no fingerprint failures.

These timings are a single local run on FFmpeg 9.0.2, Python 3.13.18, and
Pillow 13.0.0. Frame counts are deterministic; wall-clock times vary by host.

## Evidence check

- The test generated distinct login, dashboard, settings, and export slides.
- Every slide state present in the raw sample remained represented after
  de-duplication.
- All three scene boundaries and the final frame remained present.
- A removed frame was only discarded when both its 64-bit difference hash and
  its 64×64 RGB RMS were within the conservative defaults.

The report intentionally does not claim Tesseract retention because Tesseract
was not installed for this measurement. OCR and vision are invoked once per
retained frame, so the measured reduction in retained frames is the reduction
in provider calls for this input.

## Reproduction

From the repository root:

```bash
OPENCONTEXT_SKIP_DOTENV=1 \
  workers/processor/.venv/bin/python scripts/benchmark-frame-dedup.py \
  --out docs/performance/frame-dedup-2026-11-26.json
```

The script generates its media in a temporary directory, invokes the production
`extract_frames` and `deduplicate_similar_frames` functions, and records counts,
timestamps, elapsed time, thresholds, and evidence coverage. It adds no remote
provider calls or billable services.

## Limits

- This is a synthetic four-state slide workload, not a representative sample
  of all screen recordings or camera video.
- It assumes one vision and one OCR request per selected frame.
- It measures local FFmpeg extraction and fingerprint overhead, not network or
  provider latency.
- The thresholds still need validation against a larger real-world corpus
  before they are changed or treated as broadly optimal.

The follow-up run over 16 real Screen2Words screenshot states retained every
state while avoiding 31 of 48 candidate calls; see
[frame-dedup-screen2words-2026-11-26.md](frame-dedup-screen2words-2026-11-26.md).
