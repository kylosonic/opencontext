# Measure OpenCode Go hearing with published speech

## Problem

OpenContext's vision scoring used a video with no audio. The product promise
also requires measurable speech-to-text behavior from text-only-model
integrations.

## Scope

- Add an audio-capable OpenAI-compatible chat transcription provider.
- Use stable, attributed speech with a known transcript.
- Wrap the audio in a video that exercises the normal worker pipeline.
- Publish raw context, WER/CER score, source hash, and limitations.

## Acceptance

- [x] The provider sends WAV audio through OpenCode Go chat completions.
- [x] The source recording and ground truth are committed with attribution.
- [x] A real hosted run publishes transcript context and score.
- [x] The evaluation distinguishes hearing from the fixture vision output.

## Files

- `workers/processor/src/oc_worker/providers/transcription/openai_audio.py`
- `workers/processor/tests/test_opencode_audio_smoke.py`
- `scripts/generate-hearing-evaluation-video.mjs`
- `docs/evaluation/open-speech-hearing-dataset.json`
- `docs/evaluation/opencode-go-hearing-measured.md`
