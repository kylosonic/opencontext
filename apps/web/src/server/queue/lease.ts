import { LEASE_MS } from "./claimJob";

/** A mutation lost its conditional lease fence to another worker. */
export class LeaseLostError extends Error {
  readonly code = "LEASE_LOST";

  constructor(jobId: string) {
    super(`Job ${jobId} is no longer leased by this worker`);
    this.name = "LeaseLostError";
  }
}

export function activeLease(workerId: string, now: Date) {
  return {
    claimedBy: workerId,
    leaseUntil: { gt: now },
  };
}

export function renewedLease(now: Date): Date {
  return new Date(now.getTime() + LEASE_MS);
}
