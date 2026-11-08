-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'DOWNLOADING', 'EXTRACTING', 'TRANSCRIBING', 'ANALYZING', 'AGGREGATING', 'GENERATING_CONTEXT', 'COMPLETED', 'PARTIAL', 'FAILED');

-- CreateEnum
CREATE TYPE "DetailLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "FailureKind" AS ENUM ('NONE', 'TRANSIENT', 'PERMANENT');

-- CreateEnum
CREATE TYPE "StageName" AS ENUM ('EXTRACTING', 'TRANSCRIBING', 'ANALYZING', 'AGGREGATING', 'GENERATING_CONTEXT');

-- CreateEnum
CREATE TYPE "StageStatus" AS ENUM ('NOT_STARTED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "MediaKind" AS ENUM ('SOURCE', 'AUDIO', 'FRAME');

-- CreateEnum
CREATE TYPE "Certainty" AS ENUM ('OBSERVED', 'INFERRED', 'UNCERTAIN');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "githubId" TEXT,
    "githubLogin" TEXT,
    "name" TEXT,
    "avatarUrl" TEXT,
    "email" TEXT,
    "emailVerified" TIMESTAMP(3),
    "image" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("provider","providerAccountId")
);

-- CreateTable
CREATE TABLE "Session" (
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("sessionToken")
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VerificationToken_pkey" PRIMARY KEY ("identifier","token")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "detailLevel" "DetailLevel" NOT NULL DEFAULT 'MEDIUM',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "errorStage" "StageName",
    "failureKind" "FailureKind" NOT NULL DEFAULT 'NONE',
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "stageStates" JSONB NOT NULL,
    "claimedBy" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "availableAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "sourceKey" TEXT,
    "sourceSize" INTEGER,
    "sourceExt" TEXT,
    "durationSec" DOUBLE PRECISION,
    "width" INTEGER,
    "height" INTEGER,
    "audioPresent" BOOLEAN,
    "frameCount" INTEGER,
    "timeline" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Media" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "kind" "MediaKind" NOT NULL,
    "key" TEXT NOT NULL,
    "mime" TEXT,
    "sizeBytes" INTEGER NOT NULL,
    "timestampSec" DOUBLE PRECISION,
    "width" INTEGER,
    "height" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UploadIntent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tempKey" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "sourceExt" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "mime" TEXT NOT NULL,
    "detailLevel" "DetailLevel" NOT NULL DEFAULT 'MEDIUM',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UploadIntent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TranscriptSegment" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "start" DOUBLE PRECISION NOT NULL,
    "end" DOUBLE PRECISION NOT NULL,
    "text" TEXT NOT NULL,
    "provider" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TranscriptSegment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VisualObservation" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "frameId" TEXT,
    "timestampSec" DOUBLE PRECISION NOT NULL,
    "certainty" "Certainty" NOT NULL DEFAULT 'OBSERVED',
    "sceneTitle" TEXT,
    "visualDescription" TEXT,
    "uiElements" JSONB NOT NULL,
    "visibleText" JSONB NOT NULL,
    "interactions" JSONB NOT NULL,
    "layoutDescription" TEXT,
    "designObservations" JSONB NOT NULL,
    "importantChanges" JSONB NOT NULL,
    "provider" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VisualObservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OCRObservation" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "frameId" TEXT,
    "timestampSec" DOUBLE PRECISION NOT NULL,
    "text" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION,
    "provider" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OCRObservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcessingResult" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "markdown" TEXT NOT NULL,
    "json" JSONB NOT NULL,
    "formatVersion" INTEGER NOT NULL DEFAULT 1,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProcessingResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateLimitBucket" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "resetAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateLimitBucket_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_githubId_key" ON "User"("githubId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_token_key" ON "VerificationToken"("token");

-- CreateIndex
CREATE INDEX "Job_userId_createdAt_idx" ON "Job"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Job_status_availableAt_idx" ON "Job"("status", "availableAt");

-- CreateIndex
CREATE INDEX "Media_jobId_kind_idx" ON "Media"("jobId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "UploadIntent_tempKey_key" ON "UploadIntent"("tempKey");

-- CreateIndex
CREATE INDEX "UploadIntent_userId_expiresAt_idx" ON "UploadIntent"("userId", "expiresAt");

-- CreateIndex
CREATE INDEX "TranscriptSegment_jobId_idx" ON "TranscriptSegment"("jobId");

-- CreateIndex
CREATE INDEX "VisualObservation_jobId_timestampSec_idx" ON "VisualObservation"("jobId", "timestampSec");

-- CreateIndex
CREATE INDEX "OCRObservation_jobId_timestampSec_idx" ON "OCRObservation"("jobId", "timestampSec");

-- CreateIndex
CREATE UNIQUE INDEX "ProcessingResult_jobId_key" ON "ProcessingResult"("jobId");

-- CreateIndex
CREATE INDEX "RateLimitBucket_resetAt_idx" ON "RateLimitBucket"("resetAt");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Media" ADD CONSTRAINT "Media_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UploadIntent" ADD CONSTRAINT "UploadIntent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TranscriptSegment" ADD CONSTRAINT "TranscriptSegment_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisualObservation" ADD CONSTRAINT "VisualObservation_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OCRObservation" ADD CONSTRAINT "OCRObservation_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcessingResult" ADD CONSTRAINT "ProcessingResult_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
