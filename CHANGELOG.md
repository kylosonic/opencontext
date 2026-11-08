# Changelog

All notable changes are documented here. The project follows
[Semantic Versioning](https://semver.org/).

## Unreleased

- Credential-free local pipeline mode with explicitly labeled fixture providers.
- Generated-video end-to-end coverage and cross-language contract validation.
- Docker Compose stack for web, worker, and PostgreSQL.
- Standalone `opencontext analyze` CLI.
- Publishable `opencontext-video` Python package and `@opencontext/schemas` npm package.
- Patched reachable npm dependency advisories and documented the remaining
  development-tool audit findings.
- Verified a real Faster Whisper transcription locally and pinned PyAV below
  19 for compatibility with Faster Whisper 1.2.1.
- Added active-upload cancellation and temporary-object cleanup.
- Added collision-safe directory/batch CLI analysis and JSON summaries.
- Added `opencontext doctor` with bounded, secret-safe provider diagnostics.
- Added optional database-backed rate limiting with fail-open/fail-closed modes.
- Added keyboard and screen-reader coverage for result tabs, timelines, and
  evidence controls.
- Added a PostgreSQL migration baseline, deploy command, and CI drift check.
- Added real S3-compatible storage integration coverage.
- Added independent Tesseract OCR with fixture and vision-compatible modes.

## 0.1.0 - 2026-11-03

- Initial OpenContext MVP with authenticated jobs, local/S3 storage, a
  database-backed queue, a Python media worker, evidence-linked context, and
  Markdown/JSON exports.
