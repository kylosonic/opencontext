# Analysis modes (context detail levels)

Status: SPECIFIED — NOT IMPLEMENTED

One selector exists on the new-job page: the context detail level. It controls how much context is generated — not which stages run. Transcription, vision, and OCR all run at every level.

## B1 — The three levels

- **LOW** — transcript + scene titles + major screen changes only. Smallest output, fewest analyses.
- **MEDIUM** (default) — everything in LOW plus per-scene visual descriptions, UI elements, visible text (OCR), and user interactions.
- **HIGH** — everything in MEDIUM plus fine-grained per-frame detail, design observations, and an exhaustive UI inventory.

## B2 — Selection

- **Actor:** signed-in user creating a job
- **Trigger:** reaches the mode step after choosing a file
- **Visible state:** three selectable cards, each with its name and the one-line description above; MEDIUM is pre-selected
- **Expected outcome:** the chosen level is saved with the job and drives the depth of the generated context
- **Acceptance:** create a job at HIGH → the result page shows "Detail: HIGH" and the output is measurably more detailed than MEDIUM for the same video

## B3 — Display on results

- The result page shows which level was used.

## B4 — Re-run at a different level

- **NOT in the MVP.** Changing the level requires creating a new job. Recorded in `pending-behaviors.md`.
