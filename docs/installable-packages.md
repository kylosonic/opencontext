# Installable Packages

The source tree is release-ready for two packages, but neither has been
published yet. Do not assume the registry names are available until the first
release succeeds.

## Python CLI

Build and install from the repository:

```bash
python -m build workers/processor
python -m pip install workers/processor/dist/opencontext_video-0.1.0-py3-none-any.whl
opencontext analyze video.mp4 --out context.md --json context.json
```

The same command works with `--offline`, which labels its deterministic fixture
transcription and vision output instead of claiming real inference.

## npm schemas

Build and inspect the package locally:

```bash
npm run build --workspace @opencontext/schemas
npm pack --workspace @opencontext/schemas --dry-run
```

The tarball includes compiled ESM JavaScript, declarations, source maps, the
README, and the MIT license.
