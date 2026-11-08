# Roadmap

This roadmap lists work that is not complete. It is not a release promise.

## Now

- Configure production GitHub OAuth, PostgreSQL, object storage, and a worker;
  run one deployed upload-to-export smoke test.
- Validate one real job with a local Ollama vision model.
- Publish the first Python and npm packages through protected environments.

## Next

- Run and publish a measured real-model evaluation using the implemented
  reproducible harness and methodology.
- Load-test the database-backed rate limiter across multiple web instances.
- Verify production S3 CORS and multipart uploads against the selected provider.

## Later

- CI replay from captured video context.
- Hosted evaluation sets with published methodology and reproducible results.

## Non-goals

- Fabricated adoption, contributor, or quality metrics.
- Presenting fixture-provider output as real model quality.
- Publishing without a reviewed release tag and manual environment approval.
