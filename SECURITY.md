# Security Policy

## Supported versions

| Version | Supported |
| --- | --- |
| `0.1.x` | Supported |
| `main` | Active development |

Security fixes land on `main` and are included in the next `0.1.x` release.
The hosted deployment at
[opencontext-swart.vercel.app](https://opencontext-swart.vercel.app) is a
working preview, not a production SLA.

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

## Out of scope

- No bug bounty program is offered at this time
- Do not test live infrastructure, overload provider quotas, upload sensitive
  media, or attempt destructive traffic without written authorization.

## Security best practices for contributors

- Never commit secrets; use `.env.example` as the template and keep real values
  out of the repository.
- Report supply-chain or dependency findings through the same private channels.
