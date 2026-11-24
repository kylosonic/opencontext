# Held-out media evaluation

Last workflow review: 2026-11-24

The original measured evidence used one synthetic UI flow and one clean Harvard
sentence recording. The held-out workflow expands coverage without committing
third-party media to the repository.

## Datasets

[`heldout-datasets.json`](heldout-datasets.json) pins deterministic row
selection from two CC BY 4.0 datasets:

- **AMI Meeting Corpus, SDM test split:** 32 far-field conversational meeting
  utterances. The downloader concatenates clips into one audio-only recording
  and joins their reference transcripts. This exercises conversational,
  multi-speaker, room-microphone speech rather than studio read speech.
- **Screen2Words, test split:** 16 real Android application screenshots and five
  crowd-authored summaries per screen. Ground-truth OCR candidates come from
  the semantic hierarchy; visual keywords are conservative normalized caption
  terms. This is a proxy for OpenContext's free-form visual context, not a
  direct caption-equivalence benchmark.

The full attributes, citation, dataset ID, split, total-row count, selected
stride, and selected count live in the JSON specification. Media is downloaded
to `.artifacts/heldout-evaluation/`, which is ignored by Git.

## Reproduce

```bash
npm run evaluation:heldout:download
HELDOUT_TRANSCRIPTION_PROVIDER=faster_whisper \
HELDOUT_TRANSCRIPTION_MODEL=tiny.en \
HELDOUT_VISION_PROVIDER=openai_compatible \
HELDOUT_VISION_MODEL=<image-capable-model> \
HELDOUT_OCR_PROVIDER=vision \
npm run evaluation:heldout:run
```

The runner writes per-item context, truth, and score JSON plus an aggregate
`summary.json`. Any provider credential remains in the worker environment and
is never copied into outputs. The datasets-server requests retry `429`/`5xx`
responses with bounded backoff.

For a credential-free plumbing baseline, leave the environment unset. The
summary is explicitly labeled `fixture-baseline`; it must not be presented as
model quality. Mixing one real provider with fixture output is labeled `mixed`.

## Metrics and limits

- Audio uses word error rate and character error rate over the joined
  reference transcript.
- Screen OCR uses normalized set precision, recall, and F1 against text nodes
  exposed by the dataset hierarchy. Hidden glyphs, icon-only controls, and
  accessibility labels can be absent from the reference.
- Visual recall checks whether normalized caption terms occur in
  OpenContext's visual findings, hierarchy, or timeline. Exact-term recall
  understates semantically equivalent descriptions.
- The 32 AMI segments are concatenated for a bounded smoke corpus, not sampled
  statistically. They do not establish WER across a complete meeting or all
  microphones.
- The 16 screenshots are a larger real-world visual smoke set, not a
  representative random sample of mobile applications.

Before using these results as a release quality claim, publish the exact model
IDs, provider endpoint, run date, aggregate and per-item scores, failures, and
the limitations above. Do not compare fixture rows with measured rows.
