# Releasing OpenContext

The repository has two publishable artifacts:

- Python distribution `opencontext-video`, including the `opencontext` CLI.
- npm package `@kylosonic/opencontext-schemas`.

Versions are currently `0.1.1` in both package manifests. A Git tag must be
`v0.1.1` (without extra text), and the release workflow verifies that the tag,
npm version, and Python version match before building.

## Protected publishing

`.github/workflows/release.yml` runs on `v*` tags. Publishing jobs use GitHub
Environments named `pypi` and `npm`. A pushed tag therefore builds and verifies
the release without publishing until an environment is approved manually.

- PyPI uses Trusted Publishing through GitHub OIDC; no PyPI token is stored.
- npm uses Trusted Publishing through GitHub OIDC; no npm publish token is
  stored.

The `0.1.1` artifacts are published. Their trusted publishers are configured as
follows:

1. In PyPI, the Trusted Publisher for `opencontext-video` uses
   owner `kylosonic`, repository `opencontext`, workflow `release.yml`, and
   environment `pypi`.
2. In npm package Settings, connect the trusted publisher
   `kylosonic/opencontext`, workflow `release.yml`, environment `npm`. Allow
   `npm publish` for direct releases; `npm dist-tag` remains disabled.
3. In repository Settings → Environments, add required reviewers to `pypi` and
   `npm`. This is the human approval gate for publishing.

The release jobs skip a package version that is already present in its
registry, so rerunning a tag remains safe and idempotent.

The temporary npm publish and GitHub Actions tokens used during the first
release have been revoked. A tokenless prerelease publish validated the npm
trusted publisher and generated npm provenance. Both stable package versions
install successfully, and `latest` points to `0.1.1`.

## Release checklist

1. Update `CHANGELOG.md` and both package versions.
2. Run the full local verification commands from `CONTRIBUTING.md`.
3. Commit and merge the release changes.
4. Create and push a matching tag, for example `git tag v0.1.1 && git push origin v0.1.1`.
5. Approve the `pypi` and `npm` environments after the verification job passes.
6. Confirm both package pages and install the published artifacts in a clean environment.
