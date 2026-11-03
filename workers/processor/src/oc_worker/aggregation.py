"""Pure, deterministic scene-row aggregation + frame selection helpers.

No I/O and no randomness: given the same inputs this always produces
the same timeline payload. Contract (matches packages/schemas
TimelineEntrySchema and apps/web demo-result.json):

- AGGREGATING/GENERATING_CONTEXT ``timeline`` is a list of canonical
  scene rows ``{start: number, end: number, title?: string, summary: string}``
  built from visual observations only (the web zod contract rejects any
  other entry shape).
- Each row is one consecutive run of observations (sorted by timestampSec)
  whose sceneTitle is equal; untitled observations are single-observation
  rows without a ``title`` key.
- start = first observation timestamp of the run; end = next run's start,
  or the video duration for the last run (clamped so end >= start; when the
  duration is unknown/zero the last run ends at its own start).
- summary is deterministic prose (description, then changes, then an
  "(inferred)" marker when any member was not OBSERVED).

Detail-level frame filtering is NOT applied here: ANALYZING already
stride-filters frames with ``frame_selected`` before observations reach
this module (pipeline.py).
"""

from __future__ import annotations

from typing import Any

from oc_worker.models import (
    Certainty,
    DetailLevel,
    VisualObservation,
)

_UNCERTAIN_CERTAINTIES = (Certainty.INFERRED, Certainty.UNCERTAIN)


def frame_selected(timestamp_sec: float, detail_level: DetailLevel | str) -> bool:
    """True when the frame at ``timestamp_sec`` is analyzed at this level.

    Detail-level semantics live in the ANALYZING stage: this decides which
    extracted frames the vision provider analyzes (LOW -> every 10th frame,
    MEDIUM -> every 3rd, HIGH -> every frame).
    """
    level = DetailLevel(detail_level)
    if level is DetailLevel.HIGH:
        return True
    stride = 10 if level is DetailLevel.LOW else 3
    return int(round(timestamp_sec)) % stride == 0


def _strip_title(scene_title: str | None) -> str | None:
    """Scene title trimmed; None when the observation is untitled."""
    if scene_title is None:
        return None
    title = scene_title.strip()
    return title or None


def _group_observations(
    observations: list[VisualObservation],
) -> list[list[VisualObservation]]:
    """Split timestamp-sorted observations into consecutive same-title runs.

    Stable: equal timestamps keep input order (Python's sort is stable).
    Untitled observations (None/blank sceneTitle) are their own
    single-observation groups and never merge with titled neighbours.
    """
    sorted_obs = sorted(observations, key=lambda obs: obs.timestampSec)
    groups: list[list[VisualObservation]] = []
    for obs in sorted_obs:
        title = _strip_title(obs.sceneTitle)
        if groups:
            current = groups[-1]
            current_title = _strip_title(current[-1].sceneTitle)
            if current_title is not None and title == current_title:
                current.append(obs)
                continue
        groups.append([obs])
    return groups


def _group_summary(group: list[VisualObservation]) -> str:
    """Deterministic prose summary for one scene row.

    - description: visualDescription of the group's first observation that
      has one (else no description part)
    - "; changes: <joined>" appended when any observation in the group has
      importantChanges (joined with "; ", empty items dropped)
    - " (inferred)" appended when any observation in the group had
      certainty INFERRED or UNCERTAIN (the marker alone when the group has
      no description and no changes)
    No trailing separators: empty parts are skipped.
    """
    description = ""
    changes: list[str] = []
    inferred = False
    for obs in group:
        if not description and obs.visualDescription and obs.visualDescription.strip():
            description = obs.visualDescription.strip()
        for change in obs.importantChanges:
            if change and change.strip():
                changes.append(change.strip())
        if obs.certainty in _UNCERTAIN_CERTAINTIES:
            inferred = True
    parts: list[str] = []
    if description:
        parts.append(description)
    if changes:
        parts.append(f"changes: {'; '.join(changes)}")
    summary = "; ".join(parts)
    if inferred:
        summary = f"{summary} (inferred)" if summary else "(inferred)"
    return summary


def build_timeline(
    observations: list[VisualObservation], duration_sec: float | None
) -> list[dict[str, Any]]:
    """Build the canonical scene-row timeline from visual observations.

    Observations are already frame-filtered by the ANALYZING stride, so no
    re-filtering happens here. Rows cover the video continuously: each row
    starts at its first observation and ends where the next row starts; the
    last row ends at ``duration_sec`` (unknown/zero duration -> its own
    start; always clamped so end >= start). Returns a list of dicts with
    exactly the keys start/end[/title]/summary and float bounds; same
    inputs always produce the same rows.
    """
    rows: list[dict[str, Any]] = []
    for group in _group_observations(observations):
        start = float(group[0].timestampSec)
        title = _strip_title(group[0].sceneTitle)
        row: dict[str, Any] = {"start": start}
        rows.append(row)
        row["end"] = start
        if title is not None:
            row["title"] = title
        row["summary"] = _group_summary(group)
    for index, row in enumerate(rows):
        if index + 1 < len(rows):
            row["end"] = max(row["start"], rows[index + 1]["start"])
            continue
        if duration_sec is not None and float(duration_sec) > 0:
            row["end"] = max(row["start"], float(duration_sec))
    return rows


def mark_interaction_certainty(observation: dict[str, Any]) -> dict[str, Any]:
    """Legacy tolerance: mark dict-shaped interactions as INFERRED.

    Canonical interactions are one-sentence strings and carry no per-item
    marker (observation-level ``certainty`` governs); they pass through
    untouched. Dict items a provider may still return (pre-validation)
    keep the historical INFERRED stamp.
    """
    for item in observation.get("interactions", []):
        if isinstance(item, dict):
            item["certainty"] = Certainty.INFERRED.value
    return observation
