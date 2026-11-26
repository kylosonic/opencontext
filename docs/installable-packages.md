# Installable Packages

The `0.1.2` versions of both packages are published. Install them directly from
their public registries.

## Python CLI

```bash
python -m pip install "opencontext-video[local]==0.1.2"
opencontext analyze video.mp4 --out context.md --json context.json
```

The same command works with `--offline`, which labels its deterministic fixture
transcription and vision output instead of claiming real inference.

Install the optional agent integration:

```bash
python -m pip install "opencontext-video[agent]==0.1.2"
opencontext-mcp
```

The MCP server exposes `analyze_media`, `analyze_video`, `analyze_image`,
`implementation_brief`, and `context_evidence`. See
[agent-integration.md](agent-integration.md).

## Ephemeral `uv` CLI

`uvx` can run an exact release without a persistent Python environment:

```bash
uvx --from "opencontext-video[local]==0.1.2" opencontext --version
uvx --from "opencontext-video[local]==0.1.2" opencontext analyze media.mp4 \
  --out context.md --json context.json
```

## GitHub Actions

Use the root composite action to analyze repository-local media and publish an
implementation brief:

```yaml
- uses: kylosonic/opencontext@v0.1.3
  with:
    media: .artifacts/walkthrough.mp4
    repository: .
    output-dir: .artifacts/opencontext
    offline: "true"
```

See [agent integration](agent-integration.md) for outputs, validation, and
remote-provider opt-in details.

## npm schemas

```bash
npm install @kylosonic/opencontext-schemas@0.1.2
```

The tarball includes compiled ESM JavaScript, declarations, source maps, the
README, and the MIT license.
