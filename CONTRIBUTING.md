# Contributing to OpenContext

OpenContext turns video into evidence-linked context for text-only AI. The
repository is an implementation preview, not a stable release. Contributions
are welcome when they keep the documented behavior and tests aligned.

## Ten-minute setup

Prerequisites:

- Node.js 20+ (24 recommended) and npm 10+
- Python 3.13+
- FFmpeg available on `PATH`
- Git

Clone and install:

```bash
git clone https://github.com/kylosonic/opencontext.git
cd opencontext
npm install
```

Set up the worker:

```bash
cd workers/processor
python -m venv .venv
.venv/Scripts/python -m pip install -e ".[dev,local]"   # Windows
# macOS/Linux: .venv/bin/python -m pip install -e ".[dev,local]"
cd ../..
```

Create a local environment:

```bash
# macOS/Linux
cp .env.example .env
cp .env.example apps/web/.env.local

# Windows PowerShell
Copy-Item .env.example .env
Copy-Item .env.example apps/web/.env.local
```

Set these values in both files for passwordless local sign-in:

```dotenv
AUTH_SECRET=local-dev-secret-change-me
WORKER_API_TOKEN=local-worker-token
DEV_AUTH_ENABLED=true
STORAGE_PROVIDER=local
TRANSCRIPTION_PROVIDER=faster_whisper
VISION_PROVIDER=fixture
TEXT_PROVIDER=template
```

Start the web app and worker in separate terminals:

```bash
# terminal 1
npm run dev

# terminal 2
cd workers/processor
.venv/Scripts/python -m oc_worker.main   # macOS/Linux: .venv/bin/python
```

Generate and upload the synthetic fixture:

```bash
npm run fixture
```

Open <http://localhost:3000/auth/signin>, choose **Continue as local user**, and
upload `.artifacts/opencontext-fixture.mp4`. The fixture vision provider is
intentionally deterministic and does not claim to perform real computer vision.
Use `VISION_PROVIDER=ollama` or an OpenAI-compatible provider for real visual
analysis.

### Docker alternative

```bash
npm run fixture
docker compose up --build
```

The Compose stack starts the web app, worker, and PostgreSQL with local-only
sign-in. The worker uses Faster Whisper with the `tiny.en` model.

## Architecture

```text
Browser
  ├─ POST /api/uploads → upload intent
  ├─ PUT to S3 presigned URL (or local upload sink)
  └─ POST /api/uploads/[id]/complete → queued Job

Python worker
  ├─ claim job over token-authenticated HTTP
  ├─ FFmpeg audio/frame extraction
  ├─ transcription + vision/OCR providers
  ├─ deterministic aggregation
  └─ evidence-linked Markdown + JSON
```

| Path | Responsibility |
| --- | --- |
| `apps/web` | Next.js UI, auth, jobs API, uploads, worker API, storage adapters |
| `packages/schemas` | Shared Zod contracts and publishable npm package |
| `packages/config` | Environment access and provider configuration |
| `workers/processor` | Python worker, standalone `opencontext` CLI, providers, export builders |
| `docs` | Behavior contracts, ADRs, deployment, security review, issue drafts |

The database-backed queue uses leases rather than an external queue. PostgreSQL
is used by the Compose stack and production; SQLite keeps native tests fast.
Worker stage payloads are validated against the same contracts in both
TypeScript and Python.

## Checks

Run these before every commit:

```bash
# repository root
npm run lint
npm run typecheck
npm test
npm run build

# worker
cd workers/processor
.venv/Scripts/python -m ruff check src tests
.venv/Scripts/python -m pytest
```

`npm test` includes the cross-language contract test and a generated-video
end-to-end test when Python and FFmpeg are available. The test creates its own
video; no media binary is committed.

Useful focused commands:

```bash
cd apps/web
npx vitest run src/server/__tests__/worker-e2e.test.ts
npx vitest run src/server/__tests__/worker-contract.test.ts

cd workers/processor
.venv/Scripts/python -m pytest tests/test_pipeline.py -q
```

## Change guidelines

- Keep commits focused and use Conventional Commit messages.
- Add a test for every behavior change.
- Never commit credentials or real `.env` files.
- Update the relevant behavior contract or ADR when a public contract changes.
- Keep fixture output labeled as fixture output; do not present it as model
  quality evidence.
- Prefer the shared storage, schema, and provider interfaces over route-specific
  implementations.

## Pull requests

Include:

1. the user-visible or contract-level change;
2. tests run and their results;
3. anything not run and why;
4. screenshots for UI changes;
5. manual follow-up steps, if any.

Use the pull request template in `.github/pull_request_template.md`.

## Security

Do not open a public issue for a vulnerability. Follow
[SECURITY.md](SECURITY.md). Before changing upload, auth, storage, worker, or
FFmpeg code, read [docs/security-review.md](docs/security-review.md).

## Good first issues

Scoped issue drafts are in [docs/issues](docs/issues). They are proposals for
maintainers to file and refine; they are not claims that the work is complete.
