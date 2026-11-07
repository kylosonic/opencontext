# @opencontext/schemas

Shared TypeScript and Zod contracts for OpenContext.

```bash
npm install @opencontext/schemas
```

```ts
import {
  AnalyzeDataSchema,
  ContextDataSchema,
  EvidenceRecordSchema,
  WorkerStageResultRequestSchema,
} from "@opencontext/schemas";

const request = WorkerStageResultRequestSchema.parse({
  stage: "ANALYZING",
  outcome: "SUCCEEDED",
  attempt: 1,
  data: {
    observations: [],
    ocr: [],
  },
});
```

The package covers:

- job statuses, stage names, progress, upload limits, and error codes;
- source, transcript, visual observation, OCR, and timeline shapes;
- evidence records with source links, certainty, timestamps, and reviews;
- worker API request schemas and generated context payloads.

The Python worker emits representative payloads from its pydantic models, and
the repository contract test validates them with these schemas. The package has
no runtime dependency beyond Zod.
