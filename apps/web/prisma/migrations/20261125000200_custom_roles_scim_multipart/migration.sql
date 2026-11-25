-- AlterTable
ALTER TABLE "UploadIntent" ADD COLUMN "chunkSizeBytes" INTEGER;
ALTER TABLE "UploadIntent" ADD COLUMN "multipartUploadId" TEXT;
ALTER TABLE "UploadIntent" ADD COLUMN "totalParts" INTEGER;
ALTER TABLE "UploadIntent" ADD COLUMN "uploadedPartsJson" TEXT;

-- CreateTable
CREATE TABLE "WorkspaceCustomRole" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "permissions" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WorkspaceCustomRole_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WorkspaceScimToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "lastUsedAt" DATETIME,
    "revokedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WorkspaceScimToken_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WorkspaceScimToken_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_WorkspaceMember" (
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'MEMBER',
    "customRoleId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("workspaceId", "userId"),
    CONSTRAINT "WorkspaceMember_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WorkspaceMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WorkspaceMember_customRoleId_fkey" FOREIGN KEY ("customRoleId") REFERENCES "WorkspaceCustomRole" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_WorkspaceMember" ("createdAt", "role", "userId", "workspaceId") SELECT "createdAt", "role", "userId", "workspaceId" FROM "WorkspaceMember";
DROP TABLE "WorkspaceMember";
ALTER TABLE "new_WorkspaceMember" RENAME TO "WorkspaceMember";
CREATE INDEX "WorkspaceMember_userId_idx" ON "WorkspaceMember"("userId");
CREATE INDEX "WorkspaceMember_customRoleId_idx" ON "WorkspaceMember"("customRoleId");
CREATE TABLE "new_WorkspaceInvite" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'MEMBER',
    "customRoleId" TEXT,
    "tokenHash" TEXT NOT NULL,
    "invitedById" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "acceptedAt" DATETIME,
    "revokedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WorkspaceInvite_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WorkspaceInvite_customRoleId_fkey" FOREIGN KEY ("customRoleId") REFERENCES "WorkspaceCustomRole" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "WorkspaceInvite_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_WorkspaceInvite" ("acceptedAt", "createdAt", "email", "expiresAt", "id", "invitedById", "revokedAt", "role", "tokenHash", "workspaceId") SELECT "acceptedAt", "createdAt", "email", "expiresAt", "id", "invitedById", "revokedAt", "role", "tokenHash", "workspaceId" FROM "WorkspaceInvite";
DROP TABLE "WorkspaceInvite";
ALTER TABLE "new_WorkspaceInvite" RENAME TO "WorkspaceInvite";
CREATE UNIQUE INDEX "WorkspaceInvite_tokenHash_key" ON "WorkspaceInvite"("tokenHash");
CREATE INDEX "WorkspaceInvite_workspaceId_revokedAt_acceptedAt_idx" ON "WorkspaceInvite"("workspaceId", "revokedAt", "acceptedAt");
CREATE INDEX "WorkspaceInvite_email_idx" ON "WorkspaceInvite"("email");
CREATE INDEX "WorkspaceInvite_expiresAt_idx" ON "WorkspaceInvite"("expiresAt");
CREATE INDEX "WorkspaceInvite_customRoleId_idx" ON "WorkspaceInvite"("customRoleId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "WorkspaceCustomRole_workspaceId_idx" ON "WorkspaceCustomRole"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceCustomRole_workspaceId_name_key" ON "WorkspaceCustomRole"("workspaceId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceScimToken_tokenHash_key" ON "WorkspaceScimToken"("tokenHash");

-- CreateIndex
CREATE INDEX "WorkspaceScimToken_workspaceId_revokedAt_idx" ON "WorkspaceScimToken"("workspaceId", "revokedAt");

