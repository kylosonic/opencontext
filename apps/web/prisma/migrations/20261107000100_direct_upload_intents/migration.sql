-- CreateTable
CREATE TABLE "UploadIntent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "tempKey" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "sourceExt" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "mime" TEXT NOT NULL,
    "detailLevel" TEXT NOT NULL DEFAULT 'MEDIUM',
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UploadIntent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "UploadIntent_tempKey_key" ON "UploadIntent"("tempKey");

-- CreateIndex
CREATE INDEX "UploadIntent_userId_expiresAt_idx" ON "UploadIntent"("userId", "expiresAt");
