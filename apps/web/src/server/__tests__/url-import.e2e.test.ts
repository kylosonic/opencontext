import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db/prisma";
import { importRemoteUrl } from "@/server/imports/remote";
import { storage } from "@/server/storage";
import { createUser, resetDatabase, resetStorage } from "./helpers";

const enabled = process.env.OPENCONTEXT_URL_IMPORT_E2E === "1";

describe.skipIf(!enabled)("URL import network acceptance", () => {
  beforeEach(async () => {
    await resetDatabase();
    await resetStorage();
  });

  it("downloads public media through SSRF guards and creates a validated job", async () => {
    const user = await createUser();
    const result = await importRemoteUrl({
      userId: user.id,
      url: "https://interactive-examples.mdn.mozilla.net/media/cc0-images/grapefruit-slice-332-332.jpg",
      detailLevel: "MEDIUM",
    });
    const job = await prisma.job.findUniqueOrThrow({ where: { id: result.jobId } });
    expect(job.status).toBe("QUEUED");
    expect(job.sourceExt).toBe("jpg");
    expect(job.sourceKey).toMatch(/^jobs\/.+\/source\.jpg$/);
    const bytes = await storage.get(job.sourceKey!);
    expect(bytes?.byteLength).toBe(job.sourceSize);
    expect(job.sourceSize).toBeGreaterThan(1_000);
  }, 120_000);
});
