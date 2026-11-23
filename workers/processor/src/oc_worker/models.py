"""Typed models shared across the worker.

Mirrors the Prisma / `packages/schemas` contract documented in
`docs/planning/technical-blueprint.md` §1-2. Inbound parsing is
deliberately lenient (extra fields allowed) so the worker tolerates
additive API changes without redeploying.
"""

from __future__ import annotations

import math
from enum import StrEnum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

# Candidate keys used to salvage a string out of legacy dict-shaped
# provider items (uiElements {type,label,role?}, visibleText
# {text,confidence?}, interactions {action,target?,result?}, ...).
_STRING_ITEM_KEYS = ("label", "text", "name", "title", "action", "value")


def _string_items(value: Any) -> list[str]:
    """Normalize a provider list item into canonical strings.

    Canonical items are plain strings (kept verbatim, order preserved).
    Legacy dict items contribute the first string value found under the
    keys ``label``, ``text``, ``name``, ``title``, ``action``, ``value``;
    dicts without any string value and non-string scalars are dropped.
    Non-list input (provider noise) normalizes to an empty list.
    """
    if not isinstance(value, list):
        return []
    items: list[str] = []
    for item in value:
        if isinstance(item, str):
            items.append(item)
        elif isinstance(item, dict):
            for key in _STRING_ITEM_KEYS:
                candidate = item.get(key)
                if isinstance(candidate, str):
                    items.append(candidate)
                    break
    return items


class StageName(StrEnum):
    EXTRACTING = "EXTRACTING"
    TRANSCRIBING = "TRANSCRIBING"
    ANALYZING = "ANALYZING"
    AGGREGATING = "AGGREGATING"
    GENERATING_CONTEXT = "GENERATING_CONTEXT"


class StageStatus(StrEnum):
    NOT_STARTED = "NOT_STARTED"
    RUNNING = "RUNNING"
    SUCCEEDED = "SUCCEEDED"
    FAILED = "FAILED"
    SKIPPED = "SKIPPED"


class StageOutcome(StrEnum):
    SUCCEEDED = "SUCCEEDED"
    FAILED = "FAILED"
    SKIPPED = "SKIPPED"


class FailureKind(StrEnum):
    NONE = "NONE"
    TRANSIENT = "TRANSIENT"
    PERMANENT = "PERMANENT"


class Certainty(StrEnum):
    OBSERVED = "OBSERVED"
    INFERRED = "INFERRED"
    UNCERTAIN = "UNCERTAIN"


class DetailLevel(StrEnum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"


class Segment(BaseModel):
    start: float = Field(ge=0)
    end: float = Field(ge=0)
    text: str = Field(min_length=1, max_length=20_000)

    @field_validator("start", "end")
    @classmethod
    def finite_timestamp(cls, value: float) -> float:
        if not math.isfinite(value):
            raise ValueError("timestamp must be finite")
        return value

    @model_validator(mode="after")
    def ordered_bounds(self) -> Segment:
        if self.end < self.start:
            raise ValueError("segment end must be greater than or equal to start")
        return self


def clamp_segments_to_duration(
    segments: list[Segment], duration_sec: float | None
) -> list[Segment]:
    """Clamp speech segments to the probed source duration.

    Speech models can report a final segment that ends past the end of the
    audio: Faster Whisper pads the last decoding window, so a five-second
    clip can end at 7.0s. Evidence built from those bounds fails the replay
    contract ("Transcript end exceeds source duration"), and the results
    view would seek past the video, so every segment is clamped into
    ``[0, duration]`` with ``end >= start``. A missing or non-positive
    duration leaves the segments unchanged.
    """
    if duration_sec is None or float(duration_sec) <= 0:
        return list(segments)
    limit = float(duration_sec)
    clamped: list[Segment] = []
    for segment in segments:
        start = min(max(0.0, float(segment.start)), limit)
        end = min(max(start, float(segment.end)), limit)
        clamped.append(segment.model_copy(update={"start": start, "end": end}))
    return clamped


class VisualObservation(BaseModel):
    """One frame-level visual observation.

    Canonical field shapes (TS contract `packages/schemas/src/observation.ts`
    plus `apps/web/src/components/results/types.ts`; sample payload
    `apps/web/src/server/demo/demo-result.json`):

    - uiElements / visibleText / interactions / importantChanges: list[str]
    - designObservations: dict[str, str] — JSON record of key → plain-string
      pairs, e.g. {"layout": "Rounded cards"}

    Vision providers sometimes return legacy dict shapes (uiElements as
    {type,label,role?}, visibleText as {text,confidence?}, interactions as
    {action,target?,result?}, designObservations as an array). The
    ``mode="before"`` validators below normalize that noise so
    ``model_dump()`` always emits the canonical shapes above.
    """

    timestampSec: float = Field(ge=0)
    frameId: str | None = Field(default=None, max_length=256)
    sourceIndex: int | None = Field(default=None, ge=0, le=30)
    certainty: Certainty = Certainty.OBSERVED
    sceneTitle: str | None = Field(default=None, max_length=2_000)
    visualDescription: str | None = Field(default=None, max_length=20_000)
    uiElements: list[str] = Field(default_factory=list, max_length=500)
    visibleText: list[str] = Field(default_factory=list, max_length=1_000)
    interactions: list[str] = Field(default_factory=list, max_length=500)
    layoutDescription: str | None = Field(default=None, max_length=20_000)
    designObservations: dict[str, str] = Field(default_factory=dict)
    importantChanges: list[str] = Field(default_factory=list, max_length=500)
    provider: str | None = Field(default=None, max_length=128)
    model: str | None = Field(default=None, max_length=256)

    @field_validator("timestampSec")
    @classmethod
    def finite_timestamp(cls, value: float) -> float:
        if not math.isfinite(value):
            raise ValueError("timestamp must be finite")
        return value

    @field_validator("uiElements", "visibleText", "interactions", "importantChanges")
    @classmethod
    def bounded_string_items(cls, value: list[str]) -> list[str]:
        if any(len(item) > 20_000 for item in value):
            raise ValueError("observation text item is too long")
        return value

    @field_validator(
        "uiElements", "visibleText", "interactions", "importantChanges", mode="before"
    )
    @classmethod
    def normalize_string_list(cls, value: Any) -> list[str]:
        """Coerce mixed str/dict provider lists to canonical string lists."""
        return _string_items(value)

    @field_validator("designObservations", mode="before")
    @classmethod
    def normalize_design_observations(cls, value: Any) -> dict[str, str]:
        """Coerce provider noise to a canonical ``dict[str, str]`` record.

        - dict input: keep only string-valued entries (drop the rest).
        - list input: merge string-valued dict entries by key; plain strings
          become synthetic keys "note-1", "note-2", ... in order.
        - anything else (or missing): empty record.
        """
        if isinstance(value, dict):
            return {
                key: entry
                for key, entry in value.items()
                if isinstance(key, str) and isinstance(entry, str)
            }
        if isinstance(value, list):
            normalized: dict[str, str] = {}
            note_index = 0
            for item in value:
                if isinstance(item, dict):
                    for key, entry in item.items():
                        if isinstance(key, str) and isinstance(entry, str):
                            normalized[key] = entry
                elif isinstance(item, str):
                    note_index += 1
                    key = f"note-{note_index}"
                    while key in normalized:  # avoid collisions with dict keys
                        note_index += 1
                        key = f"note-{note_index}"
                    normalized[key] = item
            return normalized
        return {}


class OCRObservation(BaseModel):
    timestampSec: float = Field(ge=0)
    sourceIndex: int | None = Field(default=None, ge=0, le=30)
    frameId: str | None = Field(default=None, max_length=256)
    text: str = Field(min_length=1, max_length=20_000)
    confidence: float | None = Field(default=None, ge=0, le=1)
    provider: str | None = Field(default=None, max_length=128)

    @field_validator("timestampSec", "confidence")
    @classmethod
    def finite_numbers(cls, value: float | None) -> float | None:
        if value is not None and not math.isfinite(value):
            raise ValueError("number must be finite")
        return value


class StageState(BaseModel):
    model_config = ConfigDict(extra="allow")
    stage: str = Field(min_length=1, max_length=64)
    status: str = Field(default=StageStatus.NOT_STARTED.value, max_length=32)
    attempt: int = Field(default=0, ge=0)


class Job(BaseModel):
    model_config = ConfigDict(extra="allow")
    id: str = Field(min_length=1, max_length=256)
    displayName: str | None = Field(default=None, max_length=255)
    status: str | None = Field(default=None, max_length=32)
    detailLevel: DetailLevel = DetailLevel.MEDIUM
    progress: int = Field(default=0, ge=0, le=100)
    stageStates: list[StageState] = Field(default_factory=list)
    durationSec: float | None = Field(default=None, ge=0, le=86_400)
    width: int | None = Field(default=None, ge=0, le=100_000)
    height: int | None = Field(default=None, ge=0, le=100_000)
    audioPresent: bool | None = None
    frameCount: int | None = Field(default=None, ge=0, le=100_000)


class SourceInfo(BaseModel):
    model_config = ConfigDict(extra="allow")
    uri: str = Field(min_length=1, max_length=8_192)
    provider: str | None = Field(default=None, max_length=32)
    sizeBytes: int | None = Field(default=None, ge=0)
    filename: str | None = Field(default=None, max_length=255)
