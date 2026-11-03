"""Aggregation tests: canonical scene-row timeline + frame selection.

The AGGREGATING timeline is a list of canonical scene rows
``{start, end, title?, summary}`` (packages/schemas TimelineEntrySchema,
apps/web demo-result.json) built from visual observations only:

- consecutive observations (timestamp-sorted) with the same sceneTitle
  form one row; untitled observations are single-observation rows
- start = first timestamp of the run, end = next run's start or the video
  duration for the last run (clamped end >= start; unknown/zero duration
  -> row ends at its own start)
- summary is deterministic (description, then changes, then the
  "(inferred)" marker for non-OBSERVED runs)

Detail-level frame filtering is an ANALYZING-stage concern: `frame_selected`
stride tests live here because the helper is defined in this module; the
pipeline tests prove the stride is applied before aggregation.
"""

from oc_worker.aggregation import (
    build_timeline,
    frame_selected,
    mark_interaction_certainty,
)
from oc_worker.models import (
    Certainty,
    DetailLevel,
    VisualObservation,
)


def _observation(
    timestamp_sec: float,
    scene_title: str | None = None,
    *,
    description: str | None = "a description",
    changes: list[str] | None = None,
    certainty: Certainty | str = Certainty.OBSERVED,
) -> VisualObservation:
    return VisualObservation(
        timestampSec=timestamp_sec,
        sceneTitle=scene_title,
        visualDescription=description,
        uiElements=["Save button"],
        visibleText=["Save"],
        interactions=["The user clicks Save"],
        layoutDescription="single column",
        designObservations={"spacing": "consistent spacing"},
        importantChanges=changes or [],
        certainty=certainty,
        provider="test",
    )


def test_frame_selected_stride_by_detail_level() -> None:
    assert frame_selected(0.0, "LOW")
    assert frame_selected(10.0, "LOW")
    assert frame_selected(20.0, "LOW")
    assert not frame_selected(5.0, "LOW")
    assert not frame_selected(15.0, "LOW")
    assert frame_selected(3.0, "MEDIUM")
    assert not frame_selected(4.0, "MEDIUM")
    assert frame_selected(6.0, DetailLevel.MEDIUM)
    assert not frame_selected(8.0, DetailLevel.MEDIUM)
    assert frame_selected(1.0, "HIGH")
    assert frame_selected(7.0, DetailLevel.HIGH)


def test_empty_observations_produce_empty_timeline() -> None:
    assert build_timeline([], 60.0) == []
    assert build_timeline([], None) == []


def test_canonical_row_shape_and_scene_continuity() -> None:
    observations = [
        _observation(0.0, "Launch"),
        _observation(4.0, "Dashboard"),
        _observation(8.0, "Dashboard"),
    ]
    rows = build_timeline(observations, 12.0)
    assert rows == [
        {"start": 0.0, "end": 4.0, "title": "Launch", "summary": "a description"},
        {
            "start": 4.0,
            "end": 12.0,
            "title": "Dashboard",
            "summary": "a description",
        },
    ]
    # keys are exactly start/end/title/summary; bounds are floats
    for row in rows:
        assert set(row) == {"start", "end", "title", "summary"}
        assert isinstance(row["start"], float)
        assert isinstance(row["end"], float)
        assert isinstance(row["summary"], str)
        assert isinstance(row["title"], str)
    # rows cover the video continuously, in ascending start order
    assert rows[0]["end"] == rows[1]["start"]
    assert rows[-1]["end"] == 12.0


def test_same_scene_consecutive_observations_merge_into_one_row() -> None:
    observations = [
        _observation(0.0, "Login"),
        _observation(2.0, "Login"),
        _observation(4.0, "Login"),
    ]
    rows = build_timeline(observations, 10.0)
    assert rows == [
        {"start": 0.0, "end": 10.0, "title": "Login", "summary": "a description"}
    ]


def test_same_scene_reappearing_later_is_a_new_row() -> None:
    observations = [
        _observation(0.0, "Home"),
        _observation(5.0, "Settings"),
        _observation(9.0, "Home"),
    ]
    rows = build_timeline(observations, 20.0)
    assert [row["title"] for row in rows] == ["Home", "Settings", "Home"]
    assert [row["start"] for row in rows] == [0.0, 5.0, 9.0]
    assert [row["end"] for row in rows] == [5.0, 9.0, 20.0]


def test_untitled_observations_form_single_rows_without_title_key() -> None:
    observations = [
        _observation(0.0, None, description="splash"),
        _observation(2.0, None, description="more splash"),
    ]
    rows = build_timeline(observations, 10.0)
    assert rows == [
        {"start": 0.0, "end": 2.0, "summary": "splash"},
        {"start": 2.0, "end": 10.0, "summary": "more splash"},
    ]
    for row in rows:
        assert set(row) == {"start", "end", "summary"}


def test_blank_scene_title_is_treated_as_untitled() -> None:
    observations = [_observation(0.0, "   ", description="blank title")]
    rows = build_timeline(observations, 10.0)
    assert rows == [{"start": 0.0, "end": 10.0, "summary": "blank title"}]


def test_titled_run_breaks_at_untitled_observation() -> None:
    observations = [
        _observation(0.0, "Dashboard"),
        _observation(2.0, None),
        _observation(4.0, "Dashboard"),
    ]
    rows = build_timeline(observations, 10.0)
    assert [row.get("title") for row in rows] == ["Dashboard", None, "Dashboard"]
    assert [row["start"] for row in rows] == [0.0, 2.0, 4.0]
    assert [row["end"] for row in rows] == [2.0, 4.0, 10.0]


def test_last_row_ends_at_video_duration() -> None:
    observations = [
        _observation(1.0, "A"),
        _observation(8.0, "B"),
    ]
    rows = build_timeline(observations, 30.0)
    assert rows[-1]["end"] == 30.0


def test_end_is_clamped_to_start_when_duration_is_shorter() -> None:
    observations = [_observation(100.0, "A")]
    rows = build_timeline(observations, 12.0)
    assert rows == [{"start": 100.0, "end": 100.0, "title": "A", "summary": "a description"}]


def test_last_row_ends_at_start_when_duration_unknown_or_zero() -> None:
    for duration in (None, 0, 0.0):
        rows = build_timeline([_observation(3.0, "A")], duration)
        assert rows[0]["end"] == 3.0
    rows = build_timeline(
        [_observation(0.0, "A"), _observation(3.0, "B")], None
    )
    # intermediate row still ends where the next row starts
    assert [row["end"] for row in rows] == [3.0, 3.0]


def test_observations_are_sorted_by_timestamp() -> None:
    observations = [
        _observation(9.0, "Late"),
        _observation(1.0, "Early"),
        _observation(5.0, "Middle"),
    ]
    rows = build_timeline(observations, 10.0)
    assert [row["title"] for row in rows] == ["Early", "Middle", "Late"]
    assert [row["start"] for row in rows] == [1.0, 5.0, 9.0]


def test_equal_timestamps_keep_input_order() -> None:
    observations = [
        _observation(1.0, "Second"),
        _observation(1.0, "First"),
        _observation(1.0, "First"),
    ]
    rows = build_timeline(observations, 10.0)
    # same-ts rows order matches the input order (stable)
    assert [row["title"] for row in rows] == ["Second", "First"]
    assert [row["start"] for row in rows] == [1.0, 1.0]
    # end clamps at >= start for a zero-length first row
    assert rows[0]["end"] == 1.0
    assert rows[1]["end"] == 10.0


def test_summary_joins_changes_across_group_members() -> None:
    observations = [
        _observation(0.0, "Form", changes=["title changed"]),
        _observation(2.0, "Form", changes=["button enabled", ""]),
    ]
    rows = build_timeline(observations, 10.0)
    assert rows[0]["summary"] == "a description; changes: title changed; button enabled"


def test_summary_changes_only_when_no_description() -> None:
    observations = [_observation(0.0, "Form", description=None, changes=["saved"])]
    rows = build_timeline(observations, 10.0)
    assert rows[0]["summary"] == "changes: saved"


def test_summary_uses_first_description_present_in_group() -> None:
    observations = [
        _observation(0.0, "Scene", description=None),
        _observation(2.0, "Scene", description="later description"),
    ]
    rows = build_timeline(observations, 10.0)
    assert rows[0]["summary"] == "later description"


def test_summary_empty_when_group_has_no_content() -> None:
    observations = [
        _observation(0.0, "Empty", description=None, changes=[]),
    ]
    rows = build_timeline(observations, 10.0)
    assert rows[0]["summary"] == ""


def test_summary_inferred_suffix_for_inferred_or_uncertain_members() -> None:
    observed = build_timeline(
        [_observation(0.0, "A", certainty=Certainty.OBSERVED)], 10.0
    )[0]
    assert observed["summary"] == "a description"
    for certainty in (Certainty.INFERRED, Certainty.UNCERTAIN):
        inferred = build_timeline(
            [_observation(0.0, "A", certainty=certainty)], 10.0
        )[0]
        assert inferred["summary"] == "a description (inferred)"
    # one non-OBSERVED member marks the whole run
    group = [
        _observation(0.0, "A", certainty=Certainty.OBSERVED),
        _observation(2.0, "A", certainty=Certainty.UNCERTAIN),
    ]
    assert build_timeline(group, 10.0)[0]["summary"] == "a description (inferred)"


def test_summary_inferred_marker_alone_when_no_content() -> None:
    rows = build_timeline(
        [_observation(0.0, "A", description=None, certainty=Certainty.INFERRED)],
        10.0,
    )
    assert rows[0]["summary"] == "(inferred)"


def test_summary_joins_no_trailing_separator() -> None:
    observations = [
        _observation(
            0.0,
            "Form",
            description="   form fills   ",
            changes=["saved  ", ""],
        ),
    ]
    rows = build_timeline(observations, 10.0)
    assert rows[0]["summary"] == "form fills; changes: saved"
    assert not rows[0]["summary"].endswith("; ")


def test_deterministic_same_inputs_same_output() -> None:
    observations = [
        _observation(3.0, "B", description=None, changes=["x"]),
        _observation(0.0, "A", certainty=Certainty.UNCERTAIN),
        _observation(3.0, "B", description="b desc"),
        _observation(6.0, None),
    ]
    first = build_timeline(observations, 20.0)
    second = build_timeline(list(reversed(observations)), 20.0)
    assert first == second
    # ... and the timeline never mentions transcript/ocr concepts
    assert all(set(row) <= {"start", "end", "title", "summary"} for row in first)


def test_mark_interaction_certainty_leaves_canonical_strings_untouched() -> None:
    observation = {"interactions": ["The user clicks Save", "The user types a query"]}
    result = mark_interaction_certainty(observation)
    assert result is observation
    assert result["interactions"] == ["The user clicks Save", "The user types a query"]


def test_mark_interaction_certainty_still_marks_legacy_dict_items() -> None:
    observation = {
        "interactions": [
            {"action": "click", "target": "Save"},
            {"action": "type", "certainty": "OBSERVED"},
        ]
    }
    result = mark_interaction_certainty(observation)
    assert result is observation
    assert result["interactions"][0]["certainty"] == "INFERRED"
    assert result["interactions"][1]["certainty"] == "INFERRED"


def test_mark_interaction_certainty_ignores_missing_interactions() -> None:
    observation = {"sceneTitle": "Empty"}
    assert mark_interaction_certainty(observation) == observation
    observation = {"interactions": "not-a-list"}
    assert mark_interaction_certainty(observation) == observation
