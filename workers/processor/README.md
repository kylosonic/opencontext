# oc-worker

The OpenContext media processing worker. It will ingest uploaded video files
and run the media-to-context pipeline: extracting audio and frames, transcribing
speech, applying vision and OCR, aligning results on a shared timeline, and
producing aggregated developer context.

The pipeline itself arrives in a later slice. This package currently provides
the project skeleton, version metadata, and a smoke test.
