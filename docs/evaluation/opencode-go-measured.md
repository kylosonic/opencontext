# OpenCode Go measured evaluation

This is the first published measured run of the OpenContext vision pipeline.
It scores a real OpenCode Go model against versioned ground truth for one
controlled, synthetic screen recording.

## Result

- Date: 2026-11-09
- Endpoint: `https://opencode.ai/inference/go/openai/v1`
- Model: `glm-5.3-flash`
- Input: three two-second UI states, sampled at one frame per second
- Measurement: 4/4 OCR lines matched, OCR F1 **1.0**
- Visual recall: 7/7 keywords, **1.0**
- Output: 70 evidence records and a correctly split three-scene timeline

Raw artifacts:

- [Model-derived context, Markdown](opencode-go-measured-context.md)
- [Model-derived context, JSON](opencode-go-measured-context.json)
- [Evaluation score](opencode-go-measured-evaluation.json)
- [CC0 ground truth](managed-ui-dataset.json)

## Method

The [generator](../../scripts/generate-measured-evaluation-video.mjs) uses
FFmpeg color sources and `drawtext` filters to create six seconds at 960x540:

| Time | Background | Visible text |
| --- | --- | --- |
| 00:00-00:02 | Blue `#2563eb` | Welcome to Dashboard |
| 00:02-00:04 | White `#f8fafc` | Settings, Save Changes |
| 00:04-00:06 | Green `#15803d` | Saved Successfully |

The video has no audio. OpenContext was run at `HIGH` detail, which analyzed
all six one-second samples. Transcription was explicitly disabled and the
template text provider was used, so every score below describes visual or
vision-derived OCR output.

The measured configuration was:

```text
TRANSCRIPTION_PROVIDER=none
VISION_PROVIDER=openai_compatible
VISION_MODEL=glm-5.3-flash
OPENAI_BASE_URL=https://opencode.ai/inference/go/openai/v1
OPENCODE_SESSION_ID=opencontext-measured-ui-v1
OCR_PROVIDER=vision
TEXT_PROVIDER=template
```

OpenCode returned HTTP 200 for all six frame requests. The generated input
authored during this run had SHA-256
`9ae0ec88abfe779d583518511bbeb8263f9293ea930a55bd2f54e1cb136a7bf1`.

## Reproduction

From the repository root:

```bash
npm run evaluation:video

export OPENCODE_API_KEY="<your key>"
export TRANSCRIPTION_PROVIDER=none
export VISION_PROVIDER=openai_compatible
export VISION_MODEL=glm-5.3-flash
export OPENAI_BASE_URL=https://opencode.ai/inference/go/openai/v1
export OPENCODE_SESSION_ID=opencontext-measured-ui-v1
export OCR_PROVIDER=vision
export TEXT_PROVIDER=template

opencontext analyze .artifacts/opencontext-measured-eval-v1.mp4 \
  --detail-level HIGH \
  --out .artifacts/opencode-go-measured-context.md \
  --json .artifacts/opencode-go-measured-context.json

opencontext evaluate .artifacts/opencode-go-measured-context.json \
  --truth docs/evaluation/managed-ui-dataset.json \
  --model-name glm-5.3-flash \
  --model-version opencode-go-2026-11-09 \
  --measurement-kind measured \
  --out .artifacts/opencode-go-measured-evaluation.json
```

Provider output can vary between runs even with temperature zero. Preserve
the model identifier, date, input hash, settings, raw artifacts, and score
together when comparing runs.

## Interpretation limits

The perfect score is useful evidence that frames, hosted vision calls, JSON
normalization, evidence creation, timeline aggregation, and evaluation
scoring work together. It is not a broad vision benchmark.

The dataset contains one synthetic video, three simple states, large
high-contrast text, a single font, and no occluded, scrolling, animated, or
real application UI. The empty transcript reference produces WER and CER
values of zero only because both reference and hypothesis are empty; this
run does not measure hearing or speech recognition.

Do not use this result to claim general OpenContext accuracy. A broader
evaluation needs multiple real recordings, spoken audio ground truth, dense
and changing interfaces, varied capture quality, and per-item plus aggregate
reporting.
