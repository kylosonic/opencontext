# Demo mode

Status: SPECIFIED — NOT IMPLEMENTED

Demo mode exists so the public deployment always demonstrates the product — with or without AI credentials configured.

## B1 — Entry

- **Actor:** any visitor, signed in or not
- **Trigger:** clicks "Run Demo Analysis" on the landing page
- **Visible state:** a demo job page opens; the stage checklist animates over a few seconds
- **Expected outcome:** the demo always completes and lands on a pre-authored, deterministic sample result
- **Failure outcome:** the demo must work even when the real processing pipeline is unavailable — it never depends on AI credentials

## B2 — Honesty rules

- The demo uses **pre-authored sample data**. It never processes a user's uploaded video, and it never presents mock data as the result of a real job.
- A persistent **"Demo Analysis"** badge appears on every surface: job header, tabs, and any context exported from the demo.
- Demo jobs never appear in any user's job list.
- **Acceptance:** run the demo → badge visible throughout; the job list does not contain it; a real user upload is never routed through demo data

## B3 — Demo context output

- The demo result page offers the same tabs and Copy/Download actions as a real job, so visitors can experience the deliverable end to end.
- **Acceptance:** demo → Copy Context → the pasted text contains a "Demo Analysis" marker in its header
