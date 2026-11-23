-- Remove duplicate artifact rows before enforcing deterministic key ownership.
DELETE FROM "Media"
WHERE "id" NOT IN (
  SELECT MIN("id") FROM "Media" GROUP BY "jobId", "key"
);

CREATE UNIQUE INDEX "Media_jobId_key_key" ON "Media"("jobId", "key");
CREATE INDEX "Account_userId_idx" ON "Account"("userId");
CREATE INDEX "Session_userId_idx" ON "Session"("userId");
CREATE INDEX "VerificationToken_expires_idx" ON "VerificationToken"("expires");
CREATE INDEX "Job_completedAt_idx" ON "Job"("completedAt");
CREATE INDEX "Job_createdAt_idx" ON "Job"("createdAt");
CREATE INDEX "Job_updatedAt_idx" ON "Job"("updatedAt");
CREATE INDEX "Job_leaseUntil_idx" ON "Job"("leaseUntil");
CREATE INDEX "UploadIntent_expiresAt_idx" ON "UploadIntent"("expiresAt");
CREATE INDEX "TranscriptSegment_jobId_start_idx" ON "TranscriptSegment"("jobId", "start");
