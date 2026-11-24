# Independent security assessment

An automated DAST scan is useful regression evidence, but it is not an
independent penetration test. Do not describe the scheduled OWASP ZAP baseline
as independent review.

## Repository preparation

The [Security DAST baseline workflow](../../.github/workflows/security-dast.yml)
runs weekly against the URL in the `OPENCONTEXT_DAST_TARGET` repository
variable. Point it at a staging deployment that has production-equivalent
headers, authentication, S3 policy, and rate limits, but contains synthetic
data only. Do not give the scanner credentials for a real user.

The checked-in threat boundaries are documented in
[`docs/security-review.md`](../security-review.md). The scanner complements the
existing unit, race, migration, rate-limit, and abuse-boundary tests.

## External engagement checklist

1. Select an assessor independent of the OpenContext maintainers and require a
   named lead tester, testing window, methodology, and retest option.
2. Provide an isolated staging tenant, synthetic media, test-only OAuth and S3
   credentials, explicit authorization, emergency contacts, and a stop button.
3. Include authentication and account linking, tenant boundaries, object
   storage authorization, URL import SSRF, upload parsing, worker API isolation,
   prompt injection, rate limiting, CSRF, session handling, and abuse of public
   share tokens in scope.
4. Exclude production customer data and destructive load against production.
5. Require a CVSS-scored report, reproduction steps, affected versions, and a
   retest for every fixed finding.
6. Publish only the assessment date, scope version, tester organization,
   severity totals, and retest result. Keep exploit details private until fixed.

## Acceptance evidence

An independent-review claim requires all of the following:

- a signed scope and authorization document;
- the assessor's final report and retest addendum;
- every Critical/High finding resolved or explicitly accepted by an owner;
- the tested commit and deployment URL recorded in `docs/status.md`;
- a statement separating automated DAST evidence from independent human review.
