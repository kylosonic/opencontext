# Smoke-test the packaged CLI in its container

## Problem

CI builds and tests the repository, but it does not prove that the dependency
installed in the worker image can run the standalone CLI on a real generated
video with its bundled FFmpeg.

## Scope

- Build the worker image in a dedicated CI job.
- Run `opencontext --version` inside the image.
- Mount a tiny generated video and analyze it with `--offline`.
- Assert that Markdown and JSON outputs contain evidence.

## Acceptance

- [x] The test builds `docker/worker.Dockerfile` from a clean checkout.
- [x] The container runs without host FFmpeg or Tesseract.
- [x] Offline analysis creates non-empty Markdown and valid JSON.
- [x] CI prints container logs when the smoke test fails.

## Files

- `.github/workflows/ci.yml`
- `docker/worker.Dockerfile`
- `scripts/` for fixture generation if needed

## Verify

```bash
docker build -f docker/worker.Dockerfile -t opencontext-worker:test .
docker run --rm opencontext-worker:test opencontext --version
```
