# Upload

Status: IMPLEMENTED — DIRECT UPLOAD PATH TESTED

## B1 — Accepted files

- **Actor:** signed-in user
- **Trigger:** selects or drops one video, one PDF, or up to 10 images on the new-job page
- **Visible state:** the form shows file names, sizes, order, and format badges
- **Expected outcome:** MP4, MOV, WebM, and MKV files up to 500 MB; one PDF up to 50 MB; or a PNG, JPG, JPEG, and WebP image set up to 25 MB per image, are accepted; the upload proceeds
- **Failure outcome:** anything else is rejected immediately with a named reason ("This format is not supported — use MP4, MOV, WebM, MKV, PNG, JPG, JPEG, WebP, or PDF" / "File is too large — the limit is 500 MB" / "Image is too large — the limit is 25 MB" / "PDF is too large — the limit is 50 MB"); the dropzone stays usable; no job is created
- **Edge cases:** a renamed or corrupt file passes the form and must be caught at processing time (see `jobs.md` B6); files with no extension are rejected as unsupported
- **Transport:** the browser uploads to a presigned S3 URL in production or to a session-authenticated local-disk URL in development. The server verifies the stored object's size and MIME type before creating a job. Images also require a matching PNG/JPEG/WebP signature and decodable dimensions up to 40 megapixels; PDFs require a PDF signature.
- **Acceptance:** drop a .txt → immediate rejection message; drop a 600 MB MP4 → size rejection; drop a valid 20 MB MP4 → accepted; select two valid PNGs → they create one ordered image-set job

## B2 — Duration limit

- **Actor:** signed-in user
- **Trigger:** uploads a video longer than 30 minutes
- **Visible state:** the form states the limits before upload: video up to 500 MB and 30 minutes; images up to 25 MB and 40 megapixels; PDF up to 50 MB and 30 pages
- **Expected outcome:** the job is created and fails fast with "Video is longer than the 30-minute limit"; no analysis stages run; no retry offered (the file itself is the problem)
- **Edge cases:** the authoritative duration is measured from the file itself, not from container metadata
- **Acceptance:** upload a 45-minute video → job fails with the duration message and no stages have run; a still image has no duration limit

## B3 — Transfer interruption

- **Actor:** signed-in user during upload
- **Trigger:** network drops or the tab closes mid-transfer
- **Visible state:** the progress indicator stops; on return, a clear failure message
- **Expected outcome:** no job is created; partial data never enters processing; successful temporary objects from an interrupted image set are deleted; the user can select the files again and restart from zero
- **Edge cases:** browser crash — reopening the app shows no half job anywhere
- **Cleanup:** an abandoned upload intent expires after 15 minutes; its temporary object is removed by the retention sweep.
- **Acceptance:** start an upload, disable the network → upload shows failure, job list is empty, retrying the same file works

## B4 — One upload at a time

- **Actor:** signed-in user
- **Trigger:** attempts to add or replace files while an upload is in progress
- **Visible state:** the new selection is not accepted; the form communicates that an upload is active
- **Expected outcome:** image-set members transfer sequentially, with one active transfer at a time; after the job is created, the form is free again
- **Acceptance:** start upload A, attempt to drop file B → B refused; after A creates a job, B is accepted

## B4a — Cancel an active upload

- **Actor:** signed-in user during transfer
- **Trigger:** selects **Cancel upload**
- **Expected outcome:** the browser aborts the active transfer, every completed temporary image object and intent in the selection is deleted, and no job is created
- **Visible state:** the form returns to its empty state immediately and accepts another file
- **Ownership:** another user cannot cancel the intent
- **Fallback:** if the browser loses the intent before it can issue cleanup, the 15-minute retention sweep removes the abandoned intent and object
- **Acceptance:** start a transfer, cancel it, then choose a second file → the second upload starts normally and the job list contains no entry for the canceled file

## B5 — Same file uploaded twice

- **Actor:** signed-in user
- **Trigger:** uploads the same video a second time
- **Expected outcome:** two independent jobs, each with its own ID, page, and results; the second upload is not treated as a duplicate
- **Acceptance:** upload the same file twice → job list contains two distinct jobs

## B5a — Ordered image sets and PDFs

- **Actor:** signed-in user
- **Trigger:** selects 2–10 images, or one PDF
- **Expected outcome:** image sets become one job with stable `image-NN` frame IDs and cross-image text/UI comparisons. PDFs render up to 30 ordered pages with stable `pdf-page-NN` frame IDs and embedded text captured as OCR evidence.
- **Failure outcome:** the batch is rejected if any image fails byte, MIME, decode, or size validation; no partial job is created. A PDF over 30 pages fails before analysis.
- **Acceptance:** upload two checkout states → the job contains both images, two observations, and cross-image findings; upload a two-page PDF → the result contains two page observations and a PDF preview.

## B5b — Upload rate budgets

- **Actor:** signed-in user
- **Expected outcome:** one maximum-size 10-image set uses 10 of 120 upload-intent slots per 10 minutes, leaving room for retries and multiple jobs. Upload completion allows 60 requests per minute, and cancellation allows 120 per minute.
- **Visible outcome:** success and failure responses include `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`, and `X-RateLimit-Backend`. A genuine quota rejection returns 429 with `Retry-After`; a limiter backend outage never masquerades as a client quota rejection.
- **Acceptance:** upload or retry multiple 10-image sets without reaching a one-set lockout; exhaust the documented budget with an isolated test identity and verify the 429 response exposes the reset time and quota headers.

## B6 — Job display name

- **Actor:** signed-in user
- **Trigger:** views the job list or a job page
- **Visible state:** the job is titled by its original filename
- **Expected outcome:** the filename is displayed as plain text only — never interpreted as a path or executed; unusual characters render safely
- **Edge cases:** names containing slashes, quotes, or HTML-like text must display harmlessly
- **Acceptance:** upload "banking demo (final).mp4" → the job appears with exactly that name
