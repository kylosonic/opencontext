# Jobs — lifecycle, progress, failure, retry

Status: IMPLEMENTED — SEE docs/status.md FOR VERIFICATION SCOPE

A job is the user's unit of work: one uploaded video and everything produced from it.

## B1 — Job states

- **Visible states:** QUEUED → processing stages (Downloading, Extracting, Transcribing, Analyzing, Aggregating, Generating context) → one of COMPLETED, PARTIAL, FAILED
- **Expected outcome:** at every moment a job has exactly one state, and the UI always shows it
- **Edge cases:** a job must never appear stuck; because processing large videos is inherently slow, the UI may say so ("Large videos can take a while") rather than implying a hang
- **Acceptance:** at every stage of a real job's life, the job page and job list agree on the state

## B2 — Stage checklist & progress

- **Actor:** owner viewing an active job
- **Trigger:** opens the job page
- **Visible state:** the checklist — `✓ Video uploaded → ✓ Audio extracted → ✓ Transcript generated → ● Analyzing visual frames → ○ Aggregating context → ○ Generating developer context` — plus a percent and elapsed time
- **Expected outcome:** checklist and percent update automatically while the job is active, without a page reload
- **Acceptance:** create a job, open its page → checklist advances and percent increases while it processes

## B3 — Status polling & reconnect

- **Mechanism:** the page checks job status every 3 seconds while the job is active; polling stops at COMPLETED, PARTIAL, or FAILED. No other channel is required in the MVP.
- **Failure outcome:** if the page cannot reach the app, a non-blocking notice appears ("Reconnecting…"); the job's displayed status is never changed because of a connection problem
- **Acceptance:** open an active job, cut the network → reconnect notice appears and job status is unchanged; restore network → updates resume

## B4 — Partial failure

- **Actor:** owner
- **Trigger:** a stage fails after earlier stages succeeded (e.g., vision fails after transcription completed)
- **Visible state:** job shows PARTIAL with "2 of 4 stages succeeded — [stage] failed" and a specific reason; completed content (transcript, timeline) stays viewable
- **Expected outcome:** nothing is silently lost; the reason is stage-specific and actionable — never a bare "Something went wrong"
- **Acceptance:** simulate a vision failure on a job whose transcription succeeded → job shows PARTIAL, the transcript tab is still readable, the reason names the vision stage

## B5 — Retry failed stages

- **Actor:** owner of a PARTIAL job
- **Trigger:** chooses "Retry failed stages"
- **Visible state:** the job returns to an active state; the checklist shows only the failed stages running again
- **Expected outcome:** same job, same ID, same page URL; completed stages are reused and never re-run; if the retry succeeds the job reaches COMPLETED
- **Failure outcome:** if the retry fails again, the job returns to PARTIAL with the updated reason; retry remains available
- **Acceptance:** fail vision, click retry, vision succeeds → COMPLETED, and the transcript was not regenerated

## B6 — Total failure (invalid file)

- **Actor:** owner of a job created from a file that is not a real video (or exceeds the duration limit)
- **Trigger:** processing begins and the file is inspected
- **Visible state:** job shows FAILED with the specific reason ("This file is not a valid video" / "Video is longer than the 30-minute limit")
- **Expected outcome:** fails fast with minimal wasted processing; no retry offered — retrying the same file cannot help
- **Acceptance:** upload a renamed .txt → FAILED with the not-a-video reason and no retry button

## B7 — Automatic retries (invisible)

- Transient problems (timeouts, rate limits, provider busy) are retried automatically, a small number of times with a pause between attempts.
- **Visible state:** the user sees only normal stage progress; no error appears unless the automatic attempts are exhausted
- **Acceptance:** a stage that succeeds on the second automatic attempt never surfaces an error to the user

## B8 — Job list

- **Actor:** signed-in user
- **Trigger:** opens the jobs page
- **Visible state:** cards for the user's own jobs, newest first
- **Each card shows:** filename, status badge, current stage, progress bar, created time, and a one-line error summary for failed jobs
- **Edge cases:** zero jobs → empty state with an "Analyze your first video" action (see `results.md` B4)
- **Acceptance:** create three jobs → list shows three cards, newest first; fail one → its card shows the error summary

## B9 — Retention

- **Rule:** completed jobs keep their media and results for 14 days; jobs that never completed keep artifacts for 7 days; after that, they are removed
- **Visible state:** the job page states the retention window
- **Edge cases:** the user is not required to act; the removal is automatic and silent
- **Acceptance:** the retention window text appears on every job page

## B10 — Delete job

- **Actor:** owner
- **Trigger:** chooses "Delete job"
- **Visible state:** confirmation dialog naming the job and stating the action cannot be undone
- **Expected outcome:** after confirmation, the job and its stored media are removed; the job disappears from the list; its URL shows a "Job not found" message
- **Failure outcome:** choosing cancel leaves everything unchanged
- **Acceptance:** delete a job → confirm → job gone from the list, its link shows not-found
