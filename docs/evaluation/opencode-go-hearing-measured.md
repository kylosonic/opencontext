# OpenCode Go hearing measurement

This run measures speech recognition through OpenCode Go using an attributed
Open Speech Repository recording and the OpenContext worker's audio-chat
transcription provider.

## Result

- Date: 2026-11-09
- Endpoint: `https://opencode.ai/inference/go/openai/v1/chat/completions`
- Model: `mimo-v2.6-pro`
- Input: ten Harvard sentences, 33.623 seconds
- Transcript word error rate: **0.0123** (1.23%)
- Transcript character error rate: **0.0031** (0.31%)
- Alignment: one `It's` to `It is` word substitution
- Produced context: one observed transcript segment spanning the recording

Raw artifacts:

- [Model-derived context, Markdown](opencode-go-hearing-context.md)
- [Model-derived context, JSON](opencode-go-hearing-context.json)
- [Evaluation score](opencode-go-hearing-evaluation.json)
- [Ground truth manifest](open-speech-hearing-dataset.json)
- [Source audio](harvard-osr-us-10.wav)

## Method

The input is `OSR_us_000_0010_8k.wav` from the
[Open Speech Repository](https://www.voiptroubleshooter.com/open_speech/american.html).
The repository describes the material as freely usable and publishable when
the source is identified. The audio file has SHA-256
`a4bf9becd046d7aedb6d05b6e12347a6294a44f74d263089c636fb0a2b1e6561`.

The [hearing-video generator](../../scripts/generate-hearing-evaluation-video.mjs)
wraps the audio in a static video so the normal OpenContext worker pipeline can
process it. The generated video has both video and audio streams and SHA-256
`399196756a35259116652fdb6e1e5b12586454b0a8513ebc6c5113db86d8b8ef`.

The measured settings were:

```text
TRANSCRIPTION_PROVIDER=openai_audio
TRANSCRIPTION_MODEL=mimo-v2.6-pro
VISION_PROVIDER=fixture
OCR_PROVIDER=none
TEXT_PROVIDER=template
OPENAI_BASE_URL=https://opencode.ai/inference/go/openai/v1
OPENCODE_SESSION_ID=opencontext-hearing-measured-v1
```

The `openai_audio` provider sends the extracted WAV audio as an `input_audio`
part in a chat-completions request and disables model reasoning. The worker
analyzed the video at `LOW` detail. Vision used the deterministic fixture
provider and therefore contributes no model-quality claim to this run.

## Reproduction

```bash
npm run evaluation:hearing-video

export OPENCODE_API_KEY="<your key>"
export TRANSCRIPTION_PROVIDER=openai_audio
export TRANSCRIPTION_MODEL=mimo-v2.6-pro
export VISION_PROVIDER=fixture
export OCR_PROVIDER=none
export TEXT_PROVIDER=template
export OPENAI_BASE_URL=https://opencode.ai/inference/go/openai/v1
export OPENCODE_SESSION_ID=opencontext-hearing-measured-v1
export FIXTURE_SCENE_TITLE="Hearing evaluation fixture"
export FIXTURE_VISIBLE_TEXT=""

opencontext analyze .artifacts/opencontext-hearing-eval-v1.mp4 \
  --detail-level LOW \
  --out .artifacts/opencode-go-hearing-context.md \
  --json .artifacts/opencode-go-hearing-context.json

opencontext evaluate .artifacts/opencode-go-hearing-context.json \
  --truth docs/evaluation/open-speech-hearing-dataset.json \
  --model-name mimo-v2.6-pro \
  --model-version opencode-go-2026-11-09 \
  --measurement-kind measured \
  --out .artifacts/opencode-go-hearing-evaluation.json
```

## Interpretation limits

This is one clean, narrowband, English read-speech sample with ten known
sentences. It validates hosted audio input, request construction, response
parsing, transcript timestamps, evidence creation, and WER/CER scoring. It does
not establish general hearing quality.

Further work needs multiple speakers, accents, noisy and overlapping speech,
long recordings, code-switching, and domain words. The current provider sends
the full WAV in one chat request, so production use should select the local
Faster Whisper provider for long media or add bounded audio chunking.
