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

## npm schemas

```bash
npm install @kylosonic/opencontext-schemas@0.1.2
```

The tarball includes compiled ESM JavaScript, declarations, source maps, the
README, and the MIT license.
