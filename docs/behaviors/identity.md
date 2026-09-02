# Identity & Access

Status: SPECIFIED — NOT IMPLEMENTED

OpenContext is a developer tool. Creating and viewing jobs requires a GitHub account. The public face of the product — landing page, docs, demo — is anonymous.

## B1 — Anonymous public areas

- **Actor:** any visitor, signed in or not
- **Trigger:** opens the landing page, the docs page, or the demo
- **Visible state:** full content of those pages; a "Sign in with GitHub" action is available but nothing is blocked
- **Expected outcome:** the visitor can read everything and run the demo without creating an account
- **Failure outcome:** n/a — being signed out is not a failure in these areas
- **Edge cases:** a signed-in user visiting these pages sees the same content plus their own account state (e.g., a link to their jobs)
- **Acceptance:** open the deployed landing page in a private window → hero, pipeline, docs, and demo all load and the demo runs

## B2 — Sign in

- **Actor:** visitor or signed-out user
- **Trigger:** chooses "Sign in with GitHub", or is redirected to sign-in when attempting a protected action
- **Visible state:** GitHub's authorization screen, then the app
- **Expected outcome:** a signed-in session; the app header shows the account identity; the user is returned to the page they were trying to reach (or the app home if sign-in was voluntary)
- **Failure outcome:** if authorization fails (e.g., provider unavailable), the user stays on the previous page and sees a clear message that sign-in did not complete; nothing half-created remains
- **Edge cases:** a GitHub account without visible email must not break sign-in
- **Acceptance:** from a signed-out state, open the app home → click "Analyze a Video" → complete GitHub consent → land back on the new-job page, signed in

## B3 — Canceled sign-in

- **Actor:** signed-out user mid-redirect
- **Trigger:** cancels authorization on GitHub's screen
- **Visible state:** return to the previous page
- **Expected outcome:** still signed out, with a visible one-line notice ("Sign-in was canceled — you can continue browsing, or try again"); no error page, no partial session
- **Failure outcome:** n/a
- **Edge cases:** the same action can be retried immediately
- **Acceptance:** start sign-in, cancel at GitHub → back on the previous page, signed out, notice shown, retry works

## B4 — Job ownership

- **Actor:** signed-in user
- **Trigger:** opens a job page
- **Visible state:** own jobs open normally
- **Expected outcome:** a user can only open jobs they created; the job list shows only their jobs
- **Failure outcome:** opening someone else's job link while signed in shows "You don't have access to this job" — never the job's content
- **Edge cases:** a signed-out visitor opening a job link is sent through sign-in first, then ownership is checked
- **Acceptance:** create a job as user A, sign in as user B, open A's job link → access message, no content

## B5 — Session expiry

- **Actor:** signed-in user whose session has expired
- **Trigger:** any action that requires the session (opening the app, creating a job)
- **Visible state:** sign-in prompt
- **Expected outcome:** after re-authenticating, the user is returned to what they were doing, with no job loss
- **Edge cases:** if the session expires while a file is selected on the new-job page, the selected file survives the sign-in round-trip within the same tab; if the tab is closed, the transfer simply never completed and no job exists
- **Acceptance:** verify the redirect-after-sign-in path preserves the intended destination

## B6 — Sign out

- **Actor:** signed-in user
- **Trigger:** chooses "Sign out"
- **Visible state:** return to the landing page
- **Expected outcome:** the session is cleared; job pages become inaccessible until the next sign-in; no data is lost
- **Acceptance:** sign out → job link now requires sign-in and then ownership check
