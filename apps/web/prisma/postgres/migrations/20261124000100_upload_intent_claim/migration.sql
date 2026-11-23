-- Atomically claim an upload intent while its object is being validated and
-- committed, preventing concurrent complete calls from creating duplicate jobs.
ALTER TABLE "UploadIntent" ADD COLUMN "claimedAt" TIMESTAMP(3);
