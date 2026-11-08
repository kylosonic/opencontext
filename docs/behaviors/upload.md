# Upload

Status: IMPLEMENTED — DIRECT UPLOAD PATH TESTED

## B1 — Accepted files

- **Actor:** signed-in user
- **Trigger:** selects or drops a file on the new-job page
- **Visible state:** the form shows the file name, size, and format badge
- **Expected outcome:** MP4, MOV, WebM, and MKV files up to 500 MB are accepted; the upload proceeds
- **Failure outcome:** anything else is rejected immediately with a named reason ("This format is not supported — use MP4, MOV, WebM, or MKV" / "File is too large — the limit is 500 MB"); the dropzone stays usable; no job is created
- **Edge cases:** a file renamed to look like video but not video passes the form and must be caught at processing time (see `jobs.md` B6); files with no extension are rejected as unsupported
- **Transport:** the browser uploads to a presigned S3 URL in production or to a session-authenticated local-disk URL in development. The server verifies the stored object's size and MIME type before creating a job.
- **Acceptance:** drop a .txt → immediate rejection message; drop a 600 MB MP4 → size rejection; drop a valid 20 MB MP4 → accepted

## B2 — Duration limit

- **Actor:** signed-in user
- **Trigger:** uploads a video longer than 30 minutes
- **Visible state:** the form states the limits before upload ("MP4, MOV, WebM, MKV · up to 500 MB · up to 30 minutes")
- **Expected outcome:** the job is created and fails fast with "Video is longer than the 30-minute limit"; no analysis stages run; no retry offered (the file itself is the problem)
- **Edge cases:** the authoritative duration is measured from the file itself, not from container metadata
- **Acceptance:** upload a 45-minute video → job fails with the duration message and no stages have run

## B3 — Transfer interruption

- **Actor:** signed-in user during upload
- **Trigger:** network drops or the tab closes mid-transfer
- **Visible state:** the progress indicator stops; on return, a clear failure message
- **Expected outcome:** no job is created; partial data never enters processing; the user can select the file again and restart from zero
- **Edge cases:** browser crash — reopening the app shows no half job anywhere
- **Cleanup:** an abandoned upload intent expires after 15 minutes; its temporary object is removed by the retention sweep.
- **Acceptance:** start an upload, disable the network → upload shows failure, job list is empty, retrying the same file works

## B4 — One upload at a time

- **Actor:** signed-in user
- **Trigger:** attempts to add a second file while one upload is in progress
- **Visible state:** the second file is not accepted; the form communicates that one upload is active
- **Expected outcome:** exactly one transfer at a time; after a job is created, the form is free again
- **Acceptance:** start upload A, attempt to drop file B → B refused; after A creates a job, B is accepted

## B4a — Cancel an active upload

- **Actor:** signed-in user during transfer
- **Trigger:** selects **Cancel upload**
- **Expected outcome:** the browser aborts the transfer, the temporary object and intent are deleted, and no job is created
- **Visible state:** the form returns to its empty state immediately and accepts another file
- **Ownership:** another user cannot cancel the intent
- **Fallback:** if the browser loses the intent before it can issue cleanup, the 15-minute retention sweep removes the abandoned intent and object
- **Acceptance:** start a transfer, cancel it, then choose a second file → the second upload starts normally and the job list contains no entry for the canceled file

## B5 — Same file uploaded twice

- **Actor:** signed-in user
- **Trigger:** uploads the same video a second time
- **Expected outcome:** two independent jobs, each with its own ID, page, and results; the second upload is not treated as a duplicate
- **Acceptance:** upload the same file twice → job list contains two distinct jobs

## B6 — Job display name

- **Actor:** signed-in user
- **Trigger:** views the job list or a job page
- **Visible state:** the job is titled by its original filename
- **Expected outcome:** the filename is displayed as plain text only — never interpreted as a path or executed; unusual characters render safely
- **Edge cases:** names containing slashes, quotes, or HTML-like text must display harmlessly
- **Acceptance:** upload "banking demo (final).mp4" → the job appears with exactly that name
