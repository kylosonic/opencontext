# Public API error catalog

All API failures use the same JSON envelope:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "A human-readable explanation.",
    "stage": "EXTRACTING"
  }
}
```

`stage` is optional and appears only when a worker stage is relevant. Internal
exceptions are never exposed as public codes.

| Code | HTTP | Meaning |
| --- | ---: | --- |
| `FILE_TOO_LARGE` | 413 | The upload exceeds the configured media size limit. |
| `FORMAT_UNSUPPORTED` | 400 | The media extension or detected format is not supported. |
| `VALIDATION_ERROR` | 400 | A request body, query, or path parameter is invalid. |
| `UNAUTHORIZED` | 401 | A user session is absent, expired, or invalid. |
| `FORBIDDEN` | 403 | The authenticated identity cannot access this resource. |
| `NOT_FOUND` | 404 | The requested resource does not exist or is not visible. |
| `RETRY_NOT_ALLOWED` | 409 | The job state does not permit another processing attempt. |
| `UPLOAD_EXPIRED` | 410 | The upload intent expired before the object was completed. |
| `UPLOAD_INCOMPLETE` | 409 | The uploaded object is missing or does not match its intent. |
| `RATE_LIMITED` | 429 | The caller exceeded the configured request rate. |
| `WORKER_UNAUTHORIZED` | 401 | The worker token or worker identity is invalid. |
| `INTERNAL` | 500 | The server encountered an unexpected internal failure. |

The shared TypeScript contract in `packages/schemas/src/errors.ts` is the source
of truth for these codes and statuses. `npm run test:contracts` fails when the
catalog, schema, or generated package drifts.
