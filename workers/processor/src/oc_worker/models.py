"""Typed models shared across the worker.

Mirrors the Prisma / `packages/schemas` contract documented in
`docs/planning/technical-blueprint.md` §1-2. Inbound parsing is
deliberately lenient (extra fields allowed) so the worker tolerates
additive API changes without redeploying.
"""

from __future__ import annotations

from enum import StrEnum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator

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
    start: float
    end: float
    text: str


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

    timestampSec: float
    certainty: Certainty = Certainty.OBSERVED
    sceneTitle: str | None = None
    visualDescription: str | None = None
    uiElements: list[str] = Field(default_factory=list)
    visibleText: list[str] = Field(default_factory=list)
    interactions: list[str] = Field(default_factory=list)
    layoutDescription: str | None = None
    designObservations: dict[str, str] = Field(default_factory=dict)
    importantChanges: list[str] = Field(default_factory=list)
    provider: str | None = None

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
    timestampSec: float
    text: str
    confidence: float | None = None
    provider: str | None = None


class StageState(BaseModel):
    model_config = ConfigDict(extra="allow")
    stage: str
    status: str = StageStatus.NOT_STARTED.value
    attempt: int = 0


class Job(BaseModel):
    model_config = ConfigDict(extra="allow")
    id: str
    displayName: str | None = None
    status: str | None = None
    detailLevel: DetailLevel = DetailLevel.MEDIUM
    progress: int = 0
    stageStates: list[StageState] = Field(default_factory=list)
    durationSec: float | None = None
    width: int | None = None
    height: int | None = None
    audioPresent: bool | None = None
    frameCount: int | None = None


class SourceInfo(BaseModel):
    model_config = ConfigDict(extra="allow")
    uri: str
    provider: str | None = None
    sizeBytes: int | None = None
    filename: str | None = None
