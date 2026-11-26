# Agent Integration

OpenContext exposes its evidence-linked context through a local stdio MCP
server. The server is designed for coding agents that can read files but cannot
inspect video or images directly.

## GitHub Actions

The repository root is also a composite GitHub Action. It installs an exact
`opencontext-video` release, analyzes a repository-local media file or
directory, writes Markdown and JSON context, and generates an implementation
brief for the next coding step.

```yaml
- uses: actions/checkout@v7
- uses: kylosonic/opencontext@v0.1.3
  id: context
  with:
    media: .artifacts/walkthrough.mp4
    repository: .
    task: Implement the settings flow shown in the walkthrough.
    output-dir: .artifacts/opencontext
    detail-level: HIGH
    offline: "true"

- uses: actions/upload-artifact@v7
  with:
    name: opencontext-context
    path: .artifacts/opencontext/
```

The action exposes `markdown`, `json`, and `brief` output paths. Offline mode is
the default and makes no remote model calls. Set `offline: "false"` only when
the job already has the desired provider environment; the action never embeds
or requests model credentials. `install-local: "true"` adds the optional local
speech-recognition dependencies.

The action is smoke-tested on pull requests by analyzing a committed reference
image, validating the evidence ledger, and replaying the implementation brief.

## Install

```bash
python -m pip install "workers/processor[agent]"
```

For local speech recognition, install both extras:

```bash
python -m pip install "workers/processor[agent,local]"
```

## Configure an MCP client

```json
{
  "mcpServers": {
    "opencontext": {
      "command": "opencontext-mcp",
      "args": []
    }
  }
}
```

Provider settings use the same environment variables as the worker. Use
`offline: true` for deterministic fixture output when validating installation
plumbing only.

## Tools

### `analyze_media`

Analyzes a local video or image and returns a repository-aware implementation
brief.
Inputs:

- `media_path`
- `repository_path` (optional)
- `task` (optional)
- `detail_level`: `LOW`, `MEDIUM`, or `HIGH`
- `offline`: boolean

`analyze_video` and `analyze_image` are explicit compatibility entry points
with the same options.

These three tools perform analysis; they do not only read a completed result.
They run FFmpeg extraction, the local pipeline, and the configured providers.
Remote providers remain disabled unless the server is started with
`--allow-remote` and the caller passes `offline: false`. The Phase 3
result-server gate required the existing MCP server to be read-only, so no
second server was introduced.

### `implementation_brief`

Reads an existing OpenContext JSON result and emits a brief without rerunning
media extraction.

### `context_evidence`

Returns a bounded evidence ledger for verification or follow-up questions.

## CI replay

Commit an OpenContext JSON result as a repository artifact, then validate and
replay it without the original video or model providers:

```bash
opencontext replay captured-context.json \
  --repo . \
  --task "Implement the recorded settings flow." \
  --out implementation-brief.md \
  --report replay-report.json
```

Replay fails with a nonzero exit code when evidence IDs are duplicated or out
of sequence, source indexes dangle, evidence text no longer matches its source
collection, timestamps exceed the recording, or timeline/transcript bounds are
invalid. `replay-report.json` records the validation result, collection counts,
and SHA-256 digests of the canonical context and rendered brief.

The repository runs this check against
`docs/evaluation/opencode-go-measured-context.json` on every CI build. The same
step works without FFmpeg, provider credentials, or network access.

## Trust boundary

The MCP server runs locally and reads only paths supplied by the MCP client. It
does not upload repository contents. Repository detection examines file names,
extensions, and common manifest metadata; it does not execute repository code.
Inferred and uncertain claims remain explicitly marked as hypotheses.

`analyze_media` and its compatibility aliases can send the supplied media to a
configured remote provider only under the explicit two-level opt-in described
above. Use `offline: true` for deterministic local fixture output, or use the
read-only `implementation_brief` and `context_evidence` tools with a captured
OpenContext JSON result.
