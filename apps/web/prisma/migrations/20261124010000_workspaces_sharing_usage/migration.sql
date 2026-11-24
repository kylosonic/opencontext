CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "WorkspaceMember" (
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'MEMBER',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("workspaceId", "userId"),
    CONSTRAINT "WorkspaceMember_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WorkspaceMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Job" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT,
    "displayName" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "detailLevel" TEXT NOT NULL DEFAULT 'MEDIUM',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "errorStage" TEXT,
    "failureKind" TEXT NOT NULL DEFAULT 'NONE',
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "stageStates" JSONB NOT NULL,
    "claimedBy" TEXT,
    "leaseUntil" DATETIME,
    "availableAt" DATETIME,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "sourceKey" TEXT,
    "sourceSize" INTEGER,
    "sourceExt" TEXT,
    "durationSec" REAL,
    "width" INTEGER,
    "height" INTEGER,
    "audioPresent" BOOLEAN,
    "frameCount" INTEGER,
    "assetCount" INTEGER,
    "pageCount" INTEGER,
    "timeline" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "completedAt" DATETIME,
    CONSTRAINT "Job_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Job_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Job" ("assetCount", "attempts", "audioPresent", "availableAt", "claimedBy", "completedAt", "createdAt", "detailLevel", "displayName", "durationSec", "error", "errorStage", "failureKind", "frameCount", "height", "id", "leaseUntil", "pageCount", "progress", "retryCount", "sourceExt", "sourceKey", "sourceSize", "stageStates", "status", "timeline", "updatedAt", "userId", "width") SELECT "assetCount", "attempts", "audioPresent", "availableAt", "claimedBy", "completedAt", "createdAt", "detailLevel", "displayName", "durationSec", "error", "errorStage", "failureKind", "frameCount", "height", "id", "leaseUntil", "pageCount", "progress", "retryCount", "sourceExt", "sourceKey", "sourceSize", "stageStates", "status", "timeline", "updatedAt", "userId", "width" FROM "Job";
DROP TABLE "Job";
ALTER TABLE "new_Job" RENAME TO "Job";
CREATE INDEX "Job_userId_createdAt_idx" ON "Job"("userId", "createdAt");
CREATE INDEX "Job_workspaceId_createdAt_idx" ON "Job"("workspaceId", "createdAt");
CREATE INDEX "Job_status_availableAt_idx" ON "Job"("status", "availableAt");
CREATE INDEX "Job_completedAt_idx" ON "Job"("completedAt");
CREATE INDEX "Job_createdAt_idx" ON "Job"("createdAt");
CREATE INDEX "Job_updatedAt_idx" ON "Job"("updatedAt");
CREATE INDEX "Job_leaseUntil_idx" ON "Job"("leaseUntil");

CREATE TABLE "new_UploadIntent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT,
    "tempKey" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "sourceExt" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "mime" TEXT NOT NULL,
    "detailLevel" TEXT NOT NULL DEFAULT 'MEDIUM',
    "expiresAt" DATETIME NOT NULL,
    "claimedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UploadIntent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "UploadIntent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_UploadIntent" ("claimedAt", "createdAt", "detailLevel", "expiresAt", "filename", "id", "mime", "sizeBytes", "sourceExt", "tempKey", "userId") SELECT "claimedAt", "createdAt", "detailLevel", "expiresAt", "filename", "id", "mime", "sizeBytes", "sourceExt", "tempKey", "userId" FROM "UploadIntent";
DROP TABLE "UploadIntent";
ALTER TABLE "new_UploadIntent" RENAME TO "UploadIntent";
CREATE UNIQUE INDEX "UploadIntent_tempKey_key" ON "UploadIntent"("tempKey");
CREATE INDEX "UploadIntent_userId_expiresAt_idx" ON "UploadIntent"("userId", "expiresAt");
CREATE INDEX "UploadIntent_workspaceId_expiresAt_idx" ON "UploadIntent"("workspaceId", "expiresAt");
CREATE INDEX "UploadIntent_expiresAt_idx" ON "UploadIntent"("expiresAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

CREATE TABLE "JobShare" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "revokedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "JobShare_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "JobShare_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "UsageRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventKey" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT,
    "jobId" TEXT,
    "kind" TEXT NOT NULL,
    "quantity" REAL NOT NULL DEFAULT 0,
    "unit" TEXT NOT NULL,
    "unitCostMicros" INTEGER NOT NULL DEFAULT 0,
    "totalCostMicros" INTEGER NOT NULL DEFAULT 0,
    "provider" TEXT,
    "model" TEXT,
    "metadata" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UsageRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "UsageRecord_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "UsageRecord_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "Workspace_createdAt_idx" ON "Workspace"("createdAt");
CREATE INDEX "WorkspaceMember_userId_idx" ON "WorkspaceMember"("userId");
CREATE UNIQUE INDEX "JobShare_tokenHash_key" ON "JobShare"("tokenHash");
CREATE INDEX "JobShare_jobId_revokedAt_idx" ON "JobShare"("jobId", "revokedAt");
CREATE INDEX "JobShare_expiresAt_idx" ON "JobShare"("expiresAt");
CREATE INDEX "UsageRecord_userId_createdAt_idx" ON "UsageRecord"("userId", "createdAt");
CREATE UNIQUE INDEX "UsageRecord_eventKey_key" ON "UsageRecord"("eventKey");
CREATE INDEX "UsageRecord_workspaceId_createdAt_idx" ON "UsageRecord"("workspaceId", "createdAt");
CREATE INDEX "UsageRecord_jobId_idx" ON "UsageRecord"("jobId");
