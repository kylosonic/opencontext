"""MCP stdio protocol smoke test."""

from __future__ import annotations

import asyncio
import json
import os
import sys
from pathlib import Path

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

from oc_worker.mcp_server import _settings_for_analysis, require_remote_permission


def _context(path: Path) -> None:
    path.write_text(
        json.dumps(
            {
                "source": {"name": "demo.mp4", "durationSec": 3},
                "timeline": [],
                "evidence": [
                    {
                        "id": 1,
                        "kind": "VISUAL",
                        "timestampSec": 0,
                        "certainty": "OBSERVED",
                        "text": "Save button",
                        "source": {"collection": "uiHierarchy", "index": 0},
                    }
                ],
            }
        ),
        encoding="utf-8",
    )


def test_mcp_requires_operator_opt_in_for_remote_analysis() -> None:
    require_remote_permission(True, False)
    require_remote_permission(False, True)
    try:
        require_remote_permission(False, False)
    except ValueError as exc:
        assert "--allow-remote" in str(exc)
    else:
        raise AssertionError("remote MCP analysis was allowed without opt-in")


def test_mcp_server_lists_and_calls_tools(tmp_path: Path) -> None:
    context_path = tmp_path / "context.json"
    _context(context_path)

    async def exercise() -> None:
        env = {
            **os.environ,
            "PYTHONPATH": str(Path(__file__).resolve().parents[1] / "src"),
            "OPENCONTEXT_SKIP_DOTENV": "1",
        }
        params = StdioServerParameters(
            command=sys.executable,
            args=[
                "-m",
                "oc_worker.mcp_server",
                "--workspace",
                str(tmp_path),
                "--workspace",
                str(Path(__file__).resolve().parents[3]),
            ],
            env=env,
        )
        async with stdio_client(params) as (read_stream, write_stream):
            async with ClientSession(read_stream, write_stream) as session:
                await session.initialize()
                tools = await session.list_tools()
                names = {tool.name for tool in tools.tools}
                assert names == {
                    "analyze_image",
                    "analyze_media",
                    "analyze_video",
                    "context_evidence",
                    "implementation_brief",
                }

                result = await session.call_tool(
                    "implementation_brief",
                    {
                        "context_path": str(context_path),
                        "repository_path": str(Path(__file__).resolve().parents[3]),
                    },
                )
                assert result.content
                text = "\n".join(
                    str(getattr(item, "text", "")) for item in result.content
                )
                assert "Implementation Brief: demo.mp4" in text
                assert "[E0001 · 00:00 · Observed]" in text

    asyncio.run(exercise())


def test_mcp_offline_settings_disable_demo_vision(monkeypatch) -> None:
    monkeypatch.setenv("OPENCONTEXT_DEMO_VISION", "real")
    monkeypatch.setenv("VISION_PROVIDER", "fixture")

    assert _settings_for_analysis(True).demo_vision is False
    assert _settings_for_analysis(False).demo_vision is True
