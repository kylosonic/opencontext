# OpenContext — Behavior Contracts

This directory is the product behavior authority for OpenContext. It defines **what the product must do from the user's perspective** — not how it is built. It contains no implementation detail (no frameworks, databases, queues, or provider names).

## How to read these files

Each behavior is written as a contract with fixed fields:

- **Actor** — who performs the action
- **Trigger** — what starts the behavior
- **Visible state** — what the user sees before, during, and after
- **Expected outcome** — the guaranteed result when everything works
- **Failure outcome** — what happens when it does not work, including exact user-visible messaging
- **Edge cases** — unusual but real situations the behavior must survive
- **Acceptance examples** — concrete, testable scenarios

## Status

All contracts in this directory have the status **SPECIFIED — NOT IMPLEMENTED**. A contract here is a commitment for the MVP, not a description of current reality. QA verifies implementation against these contracts, acceptance examples included.

## Index

| File | Covers |
|---|---|
| `identity.md` | Sign-in, sign-out, anonymous areas, job ownership, session expiry |
| `upload.md` | Accepted files, limits, validation, transfer failures, display names |
| `jobs.md` | Job states, progress, partial failure, retry, retention, deletion |
| `analysis-modes.md` | LOW / MEDIUM / HIGH context detail levels |
| `results.md` | Result page, tabs, video player, timeline, empty states |
| `context-output.md` | Copy Context, Markdown/JSON download, document structure |
| `demo.md` | Demo mode — entry, labeling, simulation rules |
| `landing.md` | Landing page and docs — content and honesty rules |
| `pending-behaviors.md` | Explicitly future behavior — NOT part of the MVP |

## Consolidated acceptance checklist

Every item below must be demonstrably true before the MVP is called done.

1. An anonymous visitor can read the landing page and docs and run the demo.
2. A signed-out user who clicks "Analyze a Video" is taken through GitHub sign-in and returned to the new-job page.
3. A job is visible only to the account that created it.
4. Accepted uploads: MP4, MOV, WebM, MKV, ≤ 500 MB, ≤ 30 minutes. Anything else is rejected with a named reason and creates no job.
5. An interrupted upload creates no job and shows a clear failure message.
6. A job created from a valid video moves through visible stages and ends in COMPLETED, PARTIAL, or FAILED — never a state that hides what happened.
7. A job whose vision stage fails after earlier stages succeeded shows PARTIAL, keeps its completed content viewable, and offers "Retry failed stages" on the same job.
8. A job created from an invalid file fails fast with a specific reason and offers no retry.
9. The stage checklist and progress update without a page reload while the job is active.
10. A network interruption while viewing a job shows a reconnect notice and never falsifies job status.
11. LOW, MEDIUM (default), and HIGH are selectable at job creation; the chosen level is displayed on the result page.
12. The result page has five tabs — Transcript, Visual Analysis, Timeline, OCR, Agent Context — with Agent Context selected by default.
13. Clicking a timeline entry seeks the video player to that timestamp.
14. A video with no audio track completes with a clear "no audio" notice and does not fail.
15. Copy Context copies the full context Markdown and shows success feedback; on clipboard failure the text is presented for manual copy and never silently lost.
16. Download Markdown and Download JSON both work.
17. The demo is reachable anonymously, always shows a persistent "Demo Analysis" badge, uses pre-authored data, and never appears in any user's job list.
18. Deleting a job removes it from the list after confirmation.
19. Retention limits (14 days completed, 7 days otherwise) are stated on the job page.
20. No landing-page claim describes an unimplemented feature.
