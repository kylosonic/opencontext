# Roadmap

This roadmap lists work that is not complete. It is not a release promise.

## Now

- Deploy the hosted container definition to a persistent worker host and
  record its live restart, immediate claiming, and alerting evidence.
- Apply the reviewed Vercel WAF policy and tune PostgreSQL pool limits from a
  representative sustained-traffic window.

## Next

- Connect the operations alert endpoint to a production notification receiver
  and record a real delivery after the persistent worker is live.
- Run the held-out Screen2Words corpus with an image-capable measured model and
  publish the per-item result.
- Commission an independent penetration test using the checked-in scope and
  retest checklist.
- Decide the billing provider, currency, tax, refund, and customer mapping;
  activate metered invoice collection on top of the existing usage ledger and
  `/app/usage` dashboard.

## Later

- Expand the bounded held-out corpus into a statistically reviewed benchmark
  covering more speakers, microphones, languages, devices, and degraded captures.

## Non-goals

- Fabricated adoption, contributor, or quality metrics.
- Presenting fixture-provider output as real model quality.
- Publishing without a reviewed release tag and manual environment approval.
