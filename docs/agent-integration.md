# Agent Integration

OpenContext exposes its evidence-linked context through a local stdio MCP
server. The server is designed for coding agents that can read files but cannot
inspect video directly.

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

### `analyze_video`

Analyzes a local video and returns a repository-aware implementation brief.
Inputs:

- `video_path`
- `repository_path` (optional)
- `task` (optional)
- `detail_level`: `LOW`, `MEDIUM`, or `HIGH`
- `offline`: boolean

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
