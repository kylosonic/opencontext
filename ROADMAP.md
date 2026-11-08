# Roadmap

This roadmap lists work that is not complete. It is not a release promise.

## Now

- Add the verified local Compose upload flow to CI.
- Configure production GitHub OAuth, PostgreSQL, object storage, and a worker;
  run one deployed upload-to-export smoke test.
- Validate one real job with a local Ollama vision model.
- Upgrade the Prisma 6 toolchain to clear the remaining build-time npm
  advisories.
- Publish the first Python and npm packages through protected environments.

## Next

- Publish reproducible model-quality evaluation sets and methodology.
- Load-test the database-backed rate limiter across multiple web instances.
- Verify production S3 CORS and multipart uploads against the selected provider.
- Add retry classification and diagnostics coverage for every provider mode.

## Later

- Repository-aware implementation briefs.
- MCP/agent integrations.
- CI replay from captured video context.
- Hosted evaluation sets with published methodology and reproducible results.

## Non-goals

- Fabricated adoption, contributor, or quality metrics.
- Presenting fixture-provider output as real model quality.
- Publishing without a reviewed release tag and manual environment approval.
