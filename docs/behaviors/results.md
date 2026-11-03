# Results viewer

Status: IMPLEMENTED IN WORKING TREE — NOT RELEASE VERIFIED

## B1 — Five tabs

- **Tabs:** Transcript, Visual Analysis, Timeline, OCR, Agent Context
- **Default selection:** Agent Context — the primary output developers copy into their agent
- **Acceptance:** open a completed job → Agent Context tab is active; each other tab is one click away

## B2 — Video player & timeline

- **Actor:** owner (or demo visitor)
- **Trigger:** opens a job that has reached at least the extraction stage
- **Visible state:** a video player with the source video; a timeline listing timestamped entries
- **Expected outcome:** clicking a timeline entry seeks the player to that timestamp
- **Edge cases:** source media expired by retention → the player area shows an explanatory placeholder; the timeline still works
- **Acceptance:** open a job with timeline entries → click an entry at 01:24 → the player seeks to 01:24

## B3 — Job header

- Every job page shows: display name, status, detail level, created time, retention note, and (for demo) the persistent "Demo Analysis" badge.

## B4 — Empty states

No stage may render a blank tab:

- **Transcript:** no audio track → "No audio track detected — transcription was skipped" (not an error)
- **OCR:** no visible text → "No visible text was detected in this video"
- **Visual Analysis:** no observations yet → "Analyzing…" while active; a specific message if the stage failed
- **Timeline:** no entries → explanatory message
- **Job list:** no jobs → empty state with an "Analyze your first video" action

**Acceptance:** open a completed job from a silent video → Transcript tab shows the no-audio notice and OCR tab shows the no-text notice; no tab is blank.

## B5 — Demo badge

- Jobs opened from demo mode display a persistent "Demo Analysis" badge on the job page and in every tab header. See `demo.md`.

## B6 — Evidence-linked context

- Atomic transcript, visual, OCR, interaction, state-transition, and implementation claims carry a stable evidence ID, source timestamp, and certainty label in Markdown and the structured JSON ledger.
- Evidence references and timeline ranges are selectable from the context view. When source playback is available, selection seeks the video and brings it into view; when it is unavailable, the selected source time remains visible.
- Completed results include an Evidence review tab. Job owners can confirm or flag a claim, add a note or suggested correction, and clear a review. The original claim is retained, and the review is persisted in Markdown and JSON exports. Demo evidence is read-only.
- Interaction claims are marked `INFERRED` even when the surrounding frame is `OBSERVED`.
- **Acceptance:** select an `INFERRED` marker in a completed job → the source player seeks to its timestamp; the JSON evidence ledger contains the same ID, claim, timestamp, certainty, and collection index.
