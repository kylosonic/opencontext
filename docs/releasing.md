# Releasing OpenContext

The repository has two publishable artifacts:

- Python distribution `opencontext-video`, including the `opencontext` CLI.
- npm package `@opencontext/schemas`.

Versions are currently `0.1.0` in both package manifests. A Git tag must be
`v0.1.0` (without extra text), and the release workflow verifies that the tag,
npm version, and Python version match before building.

## Protected publishing

`.github/workflows/release.yml` runs on `v*` tags. Publishing jobs use GitHub
Environments named `pypi` and `npm`. Configure both environments with required
reviewers in repository settings. A pushed tag therefore builds and verifies
the release without publishing until a reviewer approves the environment.

- PyPI uses Trusted Publishing through GitHub OIDC; no PyPI token is stored.
- npm requires an `NPM_TOKEN` repository secret and publishes with provenance.

## Release checklist

1. Update `CHANGELOG.md` and both package versions.
2. Run the full local verification commands from `CONTRIBUTING.md`.
3. Commit and merge the release changes.
4. Create and push a matching tag, for example `git tag v0.1.0 && git push origin v0.1.0`.
5. Approve the `pypi` and `npm` environments after the verification job passes.
6. Confirm both package pages and install the published artifacts in a clean environment.
