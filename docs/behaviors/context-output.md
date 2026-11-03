# Context output — copy & download

Status: IMPLEMENTED IN WORKING TREE — NOT YET RELEASE VERIFIED

The context document is the product's deliverable: one document, three access paths (copy, Markdown download, JSON download).

## B1 — The document

- **Structure:**
  1. Header — source name, duration, generated date, detail level
  2. Chronological aggregated context — timeline blocks merging transcript, visual observations, OCR, and interactions
  3. Developer context section — application structure, UI hierarchy, navigation, user interactions, visible text, component relationships, state transitions, design patterns, and implementation-relevant observations
- **Evidence references:** Every atomic transcript, visual, OCR, interaction, state-transition, and implementation claim carries a stable evidence ID, source timestamp, and certainty label in Markdown and a matching structured JSON evidence record. Aggregated timeline entries retain clickable source-time ranges. Interaction claims remain marked `INFERRED` even when the surrounding frame is observed.
- **Honesty rules:** observed vs inferred vs uncertain are always distinguished; functionality is never invented; adjacent duplicate observations are merged; timestamps are preserved
- **Refinement safety:** optional text-model refinement must preserve evidence-linked claim lines and timeline rows exactly. If it changes or drops one, the deterministic template is used.
- **Acceptance:** compare the document against the source video — everything stated as observed is actually visible, and uncertain statements are marked

## B2 — Copy Context

- **Actor:** owner (or demo visitor)
- **Trigger:** clicks "Copy Context"
- **Visible state:** the button briefly shows "Copied ✓"
- **Expected outcome:** the full context Markdown is on the clipboard
- **Failure outcome:** clipboard unavailable → a modal opens with the text pre-selected in a text area and instructions to copy manually; the text is never silently lost
- **Acceptance:** click Copy Context → paste into any editor → the complete document appears

## B3 — Download Markdown

- **Trigger:** clicks "Download Markdown"
- **Expected outcome:** downloads a file named `opencontext-<jobid>.md` containing the full document
- **Acceptance:** the downloaded file opens in any Markdown viewer and matches the copied text
- **Evidence acceptance:** each evidence marker maps to one JSON evidence record containing its claim, timestamp, certainty, kind, and source collection index; evidence markers in the results viewer seek to that timestamp in the source video.

## B4 — Download JSON

- **Trigger:** clicks "Download JSON"
- **Expected outcome:** downloads the full structured result as JSON — timestamps, transcript segments, observations, OCR, metadata — for future integrations
- **Acceptance:** the JSON parses and contains timestamped transcript and observation records
