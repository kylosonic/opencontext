# Roadmap

This roadmap lists work that is not complete. It is not a release promise.

## Now

- Validate one real job with Faster Whisper and a local Ollama vision model.
- Add S3/MinIO integration coverage for presigned upload and worker download.
- Run the Compose stack end to end in CI or a clean-machine check.
- Finish provider-specific PostgreSQL migration strategy.
- Upgrade the Prisma 6 toolchain to clear the remaining build-time npm
  advisories.
- Publish the first Python and npm packages through protected environments.

## Next

- Independent OCR provider interface and tests.
- Upload cancellation and stronger distributed rate limiting.
- Result-viewer accessibility and keyboard media controls.
- Batch CLI analysis and stable machine-readable progress output.
- Provider diagnostics and retry classification shared across Python providers.

## Later

- Repository-aware implementation briefs.
- MCP/agent integrations.
- CI replay from captured video context.
- Hosted evaluation sets with published methodology and reproducible results.

## Non-goals

- Fabricated adoption, contributor, or quality metrics.
- Presenting fixture-provider output as real model quality.
- Publishing without a reviewed release tag and manual environment approval.
