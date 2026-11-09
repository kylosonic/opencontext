"""Developer-context builder tests (markdown + JSON payload).

Covers deterministic baseline rendering, detail-level propagation, the
"no vision/transcript outputs" placeholders, and the text-provider
refinement fallback path.
"""

import json
import re

from oc_worker.context import build_context, dump_json, format_timestamp, template_markdown
from oc_worker.models import OCRObservation, Segment, VisualObservation
from oc_worker.providers.text.base import anchored_lines

_ISO_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+00:00$")


class _FakeTextProvider:
    name = "fake-text"

    def __init__(self, markdown: str | None = None, error: Exception | None = None) -> None:
        self._markdown = markdown
        self._error = error

    def refine(self, payload: dict, baseline_markdown: str) -> str:
        if self._error is not None:
            raise self._error
        return self._markdown if self._markdown is not None else baseline_markdown


class _AnchorPreservingTextProvider:
    name = "fake-text-preserving-anchors"

    def refine(self, payload: dict, baseline_markdown: str) -> str:
        del payload
        return "REFINED OUTPUT\n\n" + "\n".join(anchored_lines(baseline_markdown))


def _segment(text: str, start: float = 0.0, end: float = 1.0) -> Segment:
    return Segment(start=start, end=end, text=text)


def _observation(timestamp_sec: float = 0.0) -> VisualObservation:
    return VisualObservation(
        timestampSec=timestamp_sec,
        sceneTitle="Dashboard",
        visualDescription="grid of charts",
        uiElements=["Export button"],
        visibleText=["Export"],
        interactions=["The user clicks Export"],
        layoutDescription="single column",
        designObservations={"spacing": "consistent spacing"},
        importantChanges=["Saved state appears"],
        provider="fake-vision",
    )


def _canonical_timeline_rows() -> list[dict]:
    """Canonical scene rows (the AGGREGATING payload shape)."""
    return [
        {
            "start": 0.0,
            "end": 65.0,
            "title": "Dashboard",
            "summary": "grid of charts; changes: Saved state appears",
        }
    ]


def test_format_timestamp() -> None:
    assert format_timestamp(0) == "00:00"
    assert format_timestamp(65) == "01:05"
    assert format_timestamp(3599.9) == "59:59"
    assert format_timestamp(-5) == "00:00"
    assert format_timestamp(61.9) == "01:01"


def _build(**overrides):
    defaults = dict(
        source_name="demo.mp4",
        duration_sec=65.0,
        detail_level="MEDIUM",
        segments=[_segment("Hello world", 0.0, 2.0), _segment("Goodbye", 4.0, 5.0)],
        observations=[_observation(0.0)],
        ocr=[OCRObservation(timestampSec=0.0, text="Export", confidence=0.95)],
        timeline=_canonical_timeline_rows(),
    )
    defaults.update(overrides)
    return build_context(**defaults)


def test_json_payload_structure() -> None:
    _, payload = _build()
    assert payload["formatVersion"] == 2
    assert payload["source"] == {
        "name": "demo.mp4",
        "durationSec": 65.0,
        "detailLevel": "MEDIUM",
    }
    assert _ISO_RE.match(payload["generatedAt"])
    assert payload["transcript"] == [
        {"start": 0.0, "end": 2.0, "text": "Hello world"},
        {"start": 4.0, "end": 5.0, "text": "Goodbye"},
    ]
    # timeline is a pass-through of the canonical scene rows
    assert payload["timeline"] == _canonical_timeline_rows()


def test_json_payload_collects_observations_and_ocr() -> None:
    _, payload = _build()
    assert payload["uiHierarchy"] == ["Export button"]
    assert payload["interactions"] == ["The user clicks Export"]
    assert payload["visibleText"] == [
        "Export",
        {"text": "Export", "confidence": 0.95, "timestampSec": 0.0},
    ]
    assert payload["stateTransitions"] == [
        {"timestampSec": 0.0, "change": "Saved state appears"}
    ]
    assert payload["implementationObservations"] == [
        {"timestampSec": 0.0, "note": "spacing: consistent spacing"}
    ]


def test_json_payload_implementation_notes_keep_sorted_key_order() -> None:
    observation = VisualObservation(
        timestampSec=5.0,
        designObservations={
            "typography": "Large bold numerals",
            "layout": "Rounded cards",
        },
    )
    _, payload = _build(observations=[observation], ocr=[], timeline=[])
    assert payload["implementationObservations"] == [
        {"timestampSec": 5.0, "note": "layout: Rounded cards"},
        {"timestampSec": 5.0, "note": "typography: Large bold numerals"},
    ]


def test_detail_level_propagates_to_payload_source() -> None:
    for level in ("LOW", "MEDIUM", "HIGH"):
        _, payload = _build(detail_level=level)
        assert payload["source"]["detailLevel"] == level


def test_low_detail_still_produces_full_json_payload() -> None:
    _, payload = _build(detail_level="LOW")
    assert payload["source"]["detailLevel"] == "LOW"
    assert payload["transcript"]  # transcript is not filtered by detail level
    assert payload["timeline"]


def test_markdown_header_and_sections() -> None:
    markdown, _ = _build()
    assert markdown.startswith("# Developer Context: demo.mp4")
    assert "- **Source:** demo.mp4" in markdown
    assert "- **Duration:** 01:05" in markdown
    assert "- **Detail level:** MEDIUM" in markdown
    for section in (
        "## Timeline",
        "## Transcript",
        "## UI Hierarchy",
        "## Navigation",
        "## Interactions",
        "## Visible Text",
        "## State Transitions",
        "## Implementation Observations",
    ):
        assert section in markdown


def test_markdown_timeline_lines() -> None:
    markdown, _ = _build()
    # canonical scene row renders as a continuous range: [start-end] title — summary
    assert (
        "- `[00:00-01:05]` **Dashboard** — grid of charts; changes: Saved state appears"
        in markdown
    )


def test_markdown_timeline_renders_multiple_scene_ranges() -> None:
    _, payload = _build(
        timeline=[
            {"start": 0.0, "end": 4.0, "title": "Launch", "summary": "splash"},
            {"start": 4.0, "end": 65.0, "summary": "untitled scene (inferred)"},
        ]
    )
    markdown = template_markdown(payload)
    timeline_section = markdown.split("## Timeline", 1)[1].split("## Transcript", 1)[0]
    assert "- `[00:00-00:04]` **Launch** — splash" in timeline_section
    # no title -> **Scene**
    assert "- `[00:04-01:05]` **Scene** — untitled scene (inferred)" in timeline_section


def test_markdown_timeline_no_summary_still_renders_title() -> None:
    _, payload = _build(timeline=[{"start": 0.0, "end": 65.0, "title": "Silent"}])
    markdown = template_markdown(payload)
    assert "- `[00:00-01:05]` **Silent**" in markdown
    assert "— " not in markdown.split("## Timeline", 1)[1].split("## Transcript", 1)[0]


def test_markdown_timeline_has_no_transcript_or_ocr_rows() -> None:
    markdown, _ = _build()
    timeline_section = markdown.split("## Timeline", 1)[1].split("## Transcript", 1)[0]
    # transcript text stays in its own section below
    assert "Hello world" not in timeline_section
    # OCR text stays in the Visible Text section; no per-kind timeline markers
    assert "[observed]" not in timeline_section
    assert "Text: Export" not in timeline_section

def test_markdown_transcript_lines() -> None:
    markdown, _ = _build()
    assert "- `[00:00-00:02]` Hello world" in markdown
    assert "- `[00:04-00:05]` Goodbye" in markdown


def test_markdown_navigation_shows_placeholder_for_canonical_sentences() -> None:
    observation = VisualObservation(
        timestampSec=1.0,
        interactions=[
            "The user clicks Export",
            "The user navigates to /settings",
            "The user types into search",
        ],
    )
    markdown, _ = _build(observations=[observation], ocr=[], timeline=[])
    # Canonical sentence strings carry no action verbs: navigation is empty,
    # but no data is dropped — every sentence renders under Interactions.
    navigation_section = markdown.split("## Navigation", 1)[1].split("## Interactions", 1)[0]
    assert navigation_section.strip() == "_No navigation observed._"
    interactions_section = markdown.split("## Interactions", 1)[1].split("## Visible Text", 1)[0]
    assert "- The user clicks Export" in interactions_section
    assert "- The user navigates to /settings" in interactions_section
    assert "- The user types into search" in interactions_section


def test_markdown_legacy_dict_interactions_still_render_and_filter() -> None:
    """Legacy {action,target} payload entries keep their old rendering."""
    _, payload = _build()
    payload["interactions"] = [
        {"action": "click", "target": "Export", "certainty": "INFERRED"},
        {"action": "navigate", "target": "/settings", "certainty": "INFERRED"},
        {"action": "type", "target": "search", "certainty": "INFERRED"},
    ]
    markdown = template_markdown(payload)
    navigation_section = markdown.split("## Navigation", 1)[1].split("## Interactions", 1)[0]
    assert "- click → Export" in navigation_section
    assert "- navigate → /settings" in navigation_section
    assert "type" not in navigation_section
    interactions_section = markdown.split("## Interactions", 1)[1].split("## Visible Text", 1)[0]
    assert "- click on Export (inferred)" in interactions_section
    assert "- type on search (inferred)" in interactions_section


def test_markdown_canonical_collection_sections_render_strings() -> None:
    markdown, _ = _build()
    # UI Hierarchy: string element verbatim
    ui_section = markdown.split("## UI Hierarchy", 1)[1].split("## Navigation", 1)[0]
    assert "- Export button" in ui_section
    # Visible Text: the observation string plus the OCR row (both present)
    visible_section = markdown.split("## Visible Text", 1)[1].split("## State Transitions", 1)[0]
    assert visible_section.count("- Export") == 2
    # State Transitions: canonical change strings render verbatim
    assert "- `[00:00]` Saved state appears" in markdown
    # Implementation Observations: "key: value" notes render verbatim
    assert "- `[00:00]` spacing: consistent spacing" in markdown


def test_markdown_renders_legacy_dict_entries_robustly() -> None:
    """template_markdown must not crash on older dict-shaped payloads."""
    _, payload = _build()
    payload["uiHierarchy"] = [{"type": "button", "label": "Export", "role": "primary"}]
    payload["visibleText"] = [{"text": "Export", "confidence": 0.9}]
    payload["stateTransitions"] = [{"timestampSec": 1.0, "change": {"from": "a", "to": "b"}}]
    payload["implementationObservations"] = [
        {"timestampSec": 1.0, "note": {"spacing": "even"}}
    ]
    markdown = template_markdown(payload)
    ui_section = markdown.split("## UI Hierarchy", 1)[1].split("## Navigation", 1)[0]
    assert "- Export (primary)" in ui_section
    assert "- Export" in markdown
    assert "- `[00:01]` {\"from\": \"a\", \"to\": \"b\"}" in markdown
    assert "- `[00:01]` {\"spacing\": \"even\"}" in markdown


def test_empty_inputs_produce_placeholder_sections() -> None:
    """Fallback behavior when vision/transcription produced nothing."""
    markdown, payload = _build(
        segments=[],
        observations=[],
        ocr=[],
        timeline=[],
        audio_present=False,
    )
    assert payload["transcript"] == []
    assert payload["timeline"] == []
    for placeholder in (
        "_No timeline entries._",
        "_No audio track detected — transcription was skipped._",
        "_No UI elements observed._",
        "_No navigation observed._",
        "_No interactions observed._",
        "_No visible text was detected._",
        "_No state transitions observed._",
        "_No implementation observations._",
    ):
        assert placeholder in markdown


def test_audio_without_speech_says_no_speech_not_no_track() -> None:
    markdown, payload = _build(
        segments=[],
        observations=[],
        ocr=[],
        timeline=[],
        audio_present=True,
    )

    assert payload["audioPresent"] is True
    assert "_Audio track contained no speech._" in markdown
    assert "No audio track detected" not in markdown


def test_no_text_provider_returns_template_baseline() -> None:
    markdown, _ = _build(text_provider=None)
    assert markdown.startswith("# Developer Context: demo.mp4")


def test_text_provider_refinement_is_used_when_evidence_lines_are_preserved() -> None:
    markdown, payload = _build(text_provider=_AnchorPreservingTextProvider())
    baseline = template_markdown(payload)
    assert markdown.startswith("REFINED OUTPUT")
    assert anchored_lines(markdown) == anchored_lines(baseline)


def test_text_provider_cannot_rewrite_evidence_linked_claims() -> None:
    provider = _FakeTextProvider(markdown="REFINED OUTPUT")
    markdown, payload = _build(text_provider=provider)
    assert markdown == template_markdown(payload)


def test_text_provider_failure_falls_back_to_template() -> None:
    provider = _FakeTextProvider(error=RuntimeError("provider exploded"))
    markdown, payload = _build(text_provider=provider)
    assert markdown.startswith("# Developer Context: demo.mp4")
    assert markdown == template_markdown(payload)


def test_dump_json_is_deterministic_and_round_trips() -> None:
    _, payload = _build()
    rendered = dump_json(payload)
    assert rendered == json.dumps(payload, ensure_ascii=False, sort_keys=True)
    assert json.loads(rendered) == payload


def test_build_context_duration_zero_renders_placeholder() -> None:
    markdown, _ = _build(duration_sec=0.0, segments=[], observations=[], ocr=[], timeline=[])
    assert "- **Duration:** 00:00" in markdown
