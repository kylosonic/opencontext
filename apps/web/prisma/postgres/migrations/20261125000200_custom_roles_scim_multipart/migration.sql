-- AlterTable
ALTER TABLE "UploadIntent" ADD COLUMN     "chunkSizeBytes" INTEGER,
ADD COLUMN     "multipartUploadId" TEXT,
ADD COLUMN     "totalParts" INTEGER,
ADD COLUMN     "uploadedPartsJson" TEXT;

-- AlterTable
ALTER TABLE "WorkspaceMember" ADD COLUMN     "customRoleId" TEXT;

-- AlterTable
ALTER TABLE "WorkspaceInvite" ADD COLUMN     "customRoleId" TEXT;

-- CreateTable
CREATE TABLE "WorkspaceCustomRole" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "permissions" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkspaceCustomRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceScimToken" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkspaceScimToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkspaceCustomRole_workspaceId_idx" ON "WorkspaceCustomRole"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceCustomRole_workspaceId_name_key" ON "WorkspaceCustomRole"("workspaceId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceScimToken_tokenHash_key" ON "WorkspaceScimToken"("tokenHash");

-- CreateIndex
CREATE INDEX "WorkspaceScimToken_workspaceId_revokedAt_idx" ON "WorkspaceScimToken"("workspaceId", "revokedAt");

-- CreateIndex
CREATE INDEX "WorkspaceMember_customRoleId_idx" ON "WorkspaceMember"("customRoleId");

-- CreateIndex
CREATE INDEX "WorkspaceInvite_customRoleId_idx" ON "WorkspaceInvite"("customRoleId");

-- AddForeignKey
ALTER TABLE "WorkspaceCustomRole" ADD CONSTRAINT "WorkspaceCustomRole_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceMember" ADD CONSTRAINT "WorkspaceMember_customRoleId_fkey" FOREIGN KEY ("customRoleId") REFERENCES "WorkspaceCustomRole"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceInvite" ADD CONSTRAINT "WorkspaceInvite_customRoleId_fkey" FOREIGN KEY ("customRoleId") REFERENCES "WorkspaceCustomRole"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceScimToken" ADD CONSTRAINT "WorkspaceScimToken_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceScimToken" ADD CONSTRAINT "WorkspaceScimToken_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

