# Security Policy

## Supported versions

| Version | Supported |
| --- | --- |
| `main` (unreleased MVP) | Active development |

No stable releases exist yet. The MVP is under active development; security
fixes land on `main` and are included in the first release.

## Reporting a vulnerability

Please **do not** open a public issue for security vulnerabilities.

Report vulnerabilities privately:

Use a private GitHub Security Advisory on this repository.

Include:

- Affected component(s) and version(s)
- Steps to reproduce
- Impact and severity assessment

## What to expect

- Acknowledgment within 5 business days
- A coordinated disclosure timeline (default 90 days)
- Credit in the release notes unless you prefer anonymity

## Out of scope (for now)

- No bug bounty program is offered at this time
- The public site is a preview without a complete processing backend. Do not
  test live infrastructure without written authorization.

## Security best practices for contributors

- Never commit secrets; use `.env.example` as the template and keep real values
  out of the repository.
- Report supply-chain or dependency findings through the same private channels.
