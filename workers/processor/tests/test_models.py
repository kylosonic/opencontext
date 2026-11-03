"""Enum + pydantic model contract tests.

Enums are StrEnum: values must serialize to plain strings ("EXTRACTING",
"MEDIUM", "TRANSIENT") everywhere the worker emits JSON — never
"StageName.EXTRACTING".
"""

import json

import pytest
from pydantic import ValidationError

from oc_worker.models import (
    Certainty,
    DetailLevel,
    FailureKind,
    Job,
    Segment,
    StageName,
    StageStatus,
    VisualObservation,
)


def test_stage_name_value_is_plain_string() -> None:
    assert StageName.EXTRACTING.value == "EXTRACTING"
    assert StageName.GENERATING_CONTEXT.value == "GENERATING_CONTEXT"
    assert str(StageName.EXTRACTING) == "EXTRACTING"
    assert "StageName." not in str(StageName.EXTRACTING)


def test_detail_level_value_is_plain_string() -> None:
    assert DetailLevel.LOW.value == "LOW"
    assert DetailLevel.MEDIUM.value == "MEDIUM"
    assert DetailLevel.HIGH.value == "HIGH"
    assert json.dumps(DetailLevel.HIGH.value) == '"HIGH"'


def test_failure_kind_and_status_values_are_plain_strings() -> None:
    assert FailureKind.TRANSIENT.value == "TRANSIENT"
    assert FailureKind.PERMANENT.value == "PERMANENT"
    assert FailureKind.NONE.value == "NONE"
    assert StageStatus.SUCCEEDED.value == "SUCCEEDED"


def test_enums_construct_from_value_string() -> None:
    assert DetailLevel("MEDIUM") is DetailLevel.MEDIUM
    assert StageName("TRANSCRIBING") is StageName.TRANSCRIBING
    assert FailureKind("PERMANENT") is FailureKind.PERMANENT
    assert Certainty("INFERRED") is Certainty.INFERRED


def test_enums_reject_unknown_values() -> None:
    with pytest.raises(ValueError):
        DetailLevel("EXTREME")
    with pytest.raises(ValueError):
        StageName("COMPRESSING")


def test_stage_name_iterates_in_declaration_order() -> None:
    assert [s.value for s in StageName] == [
        "EXTRACTING",
        "TRANSCRIBING",
        "ANALYZING",
        "AGGREGATING",
        "GENERATING_CONTEXT",
    ]


def test_job_detail_level_default_serializes_plain() -> None:
    job = Job(id="job-1")
    dumped = job.model_dump()
    assert dumped["detailLevel"] == "MEDIUM"
    assert "MEDIUM" in job.model_dump_json()


def test_job_parses_detail_level_string_and_serializes_it_back() -> None:
    job = Job(id="job-1", detailLevel="HIGH")
    assert job.detailLevel is DetailLevel.HIGH
    assert job.model_dump()["detailLevel"] == "HIGH"


def test_job_serializes_enum_as_plain_string_in_json_payload() -> None:
    payload = {"id": "job-1", "detailLevel": DetailLevel.LOW}
    rendered = json.dumps(payload, default=lambda value: value.value)
    assert json.loads(rendered)["detailLevel"] == "LOW"


def test_observation_certainty_default_and_override() -> None:
    obs = VisualObservation(timestampSec=1.5)
    assert obs.certainty is Certainty.OBSERVED
    assert obs.model_dump()["certainty"] == "OBSERVED"
    obs2 = VisualObservation(timestampSec=2.0, certainty="UNCERTAIN")
    assert obs2.certainty is Certainty.UNCERTAIN
    assert obs2.model_dump()["certainty"] == "UNCERTAIN"


def test_job_accepts_lenient_extra_fields_and_stage_states() -> None:
    job = Job.model_validate(
        {
            "id": "job-1",
            "displayName": "Demo",
            "unknownFutureField": {"nested": True},
            "stageStates": [
                {"stage": "EXTRACTING", "status": "RUNNING", "attempt": 2, "extra": 1}
            ],
        }
    )
    assert job.stageStates[0].stage == "EXTRACTING"
    assert job.stageStates[0].status == "RUNNING"
    assert job.stageStates[0].attempt == 2
    assert job.model_extra == {"unknownFutureField": {"nested": True}}


def test_job_rejects_unknown_detail_level_on_validation() -> None:
    with pytest.raises(ValidationError):
        Job.model_validate({"id": "job-1", "detailLevel": "EXTREME"})


def test_segment_model_dump_is_plain_json() -> None:
    segment = Segment(start=0.5, end=2.25, text="Hello")
    assert segment.model_dump() == {"start": 0.5, "end": 2.25, "text": "Hello"}
    assert json.loads(segment.model_dump_json()) == {
        "start": 0.5,
        "end": 2.25,
        "text": "Hello",
    }


# ---------------------------------------------------------------------------
# VisualObservation canonical field shapes (packages/schemas observation.ts,
# apps/web demo-result.json): uiElements/visibleText/interactions/
# importantChanges are list[str], designObservations is dict[str, str].
# ---------------------------------------------------------------------------


def test_observation_collection_defaults_are_empty_canonical_shapes() -> None:
    obs = VisualObservation(timestampSec=1.0)
    dumped = obs.model_dump()
    assert dumped["uiElements"] == []
    assert dumped["visibleText"] == []
    assert dumped["interactions"] == []
    assert dumped["importantChanges"] == []
    assert dumped["designObservations"] == {}


def test_observation_accepts_canonical_string_collections() -> None:
    obs = VisualObservation(
        timestampSec=1.0,
        uiElements=["Save button", "Cancel button"],
        visibleText=["Save"],
        interactions=["The user clicks Save"],
        designObservations={"layout": "Rounded cards", "typography": "Large bold numerals"},
        importantChanges=["Button becomes enabled"],
    )
    dumped = obs.model_dump()
    assert dumped["uiElements"] == ["Save button", "Cancel button"]
    assert dumped["visibleText"] == ["Save"]
    assert dumped["interactions"] == ["The user clicks Save"]
    assert dumped["designObservations"] == {
        "layout": "Rounded cards",
        "typography": "Large bold numerals",
    }
    assert dumped["importantChanges"] == ["Button becomes enabled"]
    assert json.loads(obs.model_dump_json())["designObservations"] == {
        "layout": "Rounded cards",
        "typography": "Large bold numerals",
    }


def test_observation_coerces_dict_items_to_strings_in_order() -> None:
    obs = VisualObservation(
        timestampSec=1.0,
        uiElements=[{"type": "button", "label": "Save"}, "Plain element"],
        visibleText=[{"text": "Sign in", "confidence": 0.9}],
        interactions=[{"action": "click", "target": "Sign in"}],
    )
    assert obs.uiElements == ["Save", "Plain element"]
    assert obs.visibleText == ["Sign in"]
    assert obs.interactions == ["click"]


def test_observation_string_extraction_prefers_first_string_key() -> None:
    # dict items contribute the first string value among
    # label/text/name/title/action/value, in that key order
    obs = VisualObservation(
        timestampSec=1.0,
        uiElements=[
            {"title": "Tooltip", "label": "Save"},
            {"type": "img"},  # no string-valued candidate key -> skipped
            {"label": 5, "text": "fallback wins"},
            {"name": "Field"},
        ],
    )
    assert obs.uiElements == ["Save", "fallback wins", "Field"]


def test_observation_drops_non_string_scalars_and_junk() -> None:
    obs = VisualObservation(
        timestampSec=1.0,
        uiElements=["kept", 42, None, True, ["nested"], {"label": "From dict"}],
        importantChanges=[{"text": "title changed"}, {"from": "a", "to": "b"}, 7, None],
        visibleText="not-a-list",  # provider noise -> []
    )
    assert obs.uiElements == ["kept", "From dict"]
    # {"from"/"to"} carry no candidate key -> skipped, scalars dropped
    assert obs.importantChanges == ["title changed"]
    assert obs.visibleText == []


def test_observation_design_observations_dict_keeps_string_values_only() -> None:
    obs = VisualObservation(
        timestampSec=1.0,
        designObservations={
            "layout": "Rounded cards",
            "spacing": 16,  # dropped: not a string
            "color": {"hex": "#fff"},  # dropped: not a string
            "nested": ["a"],  # dropped: not a string
        },
    )
    assert obs.designObservations == {"layout": "Rounded cards"}


def test_observation_design_observations_list_normalizes_to_record() -> None:
    obs = VisualObservation(
        timestampSec=1.0,
        designObservations=[
            {"layout": "Rounded cards"},
            "consistent spacing",
            {"text": "large numerals"},
            "serif headings",
            42,
            None,
        ],
    )
    assert obs.designObservations == {
        "layout": "Rounded cards",
        "text": "large numerals",
        "note-1": "consistent spacing",
        "note-2": "serif headings",
    }


def test_observation_design_observations_note_keys_skip_collisions() -> None:
    obs = VisualObservation(
        timestampSec=1.0,
        designObservations=[{"note-1": "explicit"}, "plain string"],
    )
    # the plain string cannot reuse the occupied "note-1" key
    assert obs.designObservations == {"note-1": "explicit", "note-2": "plain string"}


def test_observation_design_observations_junk_normalizes_to_empty_record() -> None:
    assert VisualObservation(timestampSec=1.0, designObservations="noise").designObservations == {}
    assert VisualObservation(timestampSec=1.0, designObservations=42).designObservations == {}
    assert VisualObservation(timestampSec=1.0, designObservations=None).designObservations == {}
