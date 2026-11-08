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

## Trust boundary

The MCP server runs locally and reads only paths supplied by the MCP client. It
does not upload repository contents. Repository detection examines file names,
extensions, and common manifest metadata; it does not execute repository code.
Inferred and uncertain claims remain explicitly marked as hypotheses.
