"use client";

import { useEffect, useRef, useState } from "react";
import type { useRouter } from "next/navigation";
import type { JobDetail } from "@kylosonic/opencontext-schemas";
import { isActiveStatus, POLL_INTERVAL_MS } from "@/server/jobs/jobViews";
import { fetchJobDetail, isSignInError } from "./api-client";

interface UseJobLiveUpdatesOptions {
  initialDetail: JobDetail;
  router: ReturnType<typeof useRouter>;
}

/**
 * Keep an active job synchronized via Server-Sent Events with a transparent
 * 3-second polling fallback, elapsed timer, and terminal refresh recovery.
 */
export function useJobLiveUpdates({
  initialDetail,
  router,
}: UseJobLiveUpdatesOptions) {
  const pollEpochRef = useRef(0);
  const [job, setJob] = useState<JobDetail>(initialDetail);
  const [preparing, setPreparing] = useState(false);
  const [signedOut, setSignedOut] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [liveConnected, setLiveConnected] = useState(false);
  const [now, setNow] = useState<number | null>(() => Date.now());

  const active = isActiveStatus(job.status);

  // A fresh elapsed clock while the job is active (render stays pure;
  // Date.now() only runs inside the interval callback).
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [active]);

  // A server refresh can occasionally lose a navigation. Retry after a
  // bounded delay without tying the timer to the polling effect cleanup.
  useEffect(() => {
    if (!preparing) return;
    const timer = window.setTimeout(() => {
      setPreparing(false);
      router.refresh();
    }, POLL_INTERVAL_MS * 4);
    return () => window.clearTimeout(timer);
  }, [preparing, router]);

  // Prefer server-sent state changes while the job is active. The regular
  // three-second poll remains a transparent fallback for proxies or platforms
  // that terminate long-lived streams.
  useEffect(() => {
    if (!active || preparing || signedOut || typeof EventSource === "undefined") {
      return;
    }
    const epoch = pollEpochRef.current;
    const source = new EventSource(`/api/jobs/${encodeURIComponent(job.id)}/events`);
    let closed = false;
    const finish = () => {
      closed = true;
      source.close();
      setLiveConnected(false);
    };
    const accept = (event: MessageEvent<string>) => {
      if (closed || epoch !== pollEpochRef.current) return;
      try {
        const next = JSON.parse(event.data) as JobDetail;
        setJob(next);
        setReconnecting(false);
        if (next.status === "COMPLETED" || next.status === "PARTIAL") {
          setPreparing(true);
          router.refresh();
          finish();
        } else if (next.status === "FAILED") {
          finish();
        }
      } catch {
        finish();
      }
    };
    source.addEventListener("open", () => {
      if (!closed && epoch === pollEpochRef.current) {
        setLiveConnected(true);
        setReconnecting(false);
      }
    });
    source.addEventListener("job", accept as EventListener);
    source.addEventListener("deleted", finish);
    source.addEventListener("access-revoked", () => {
      setSignedOut(true);
      finish();
    });
    source.addEventListener("error", finish);
    return finish;
  }, [active, job.id, preparing, router, signedOut]);

  // Poll every 3s while the job is active (jobs.md B3).
  useEffect(() => {
    if (!active || preparing || signedOut || liveConnected) return;
    let stopped = false;
    let inFlight = false;
    const tick = async () => {
      if (stopped || inFlight) return;
      inFlight = true;
      const epoch = pollEpochRef.current;
      try {
        const next = await fetchJobDetail(job.id);
        if (stopped || epoch !== pollEpochRef.current) return;
        setJob(next);
        setReconnecting(false);
        if (next.status === "COMPLETED" || next.status === "PARTIAL") {
          // Terminal transition reached mid-poll: re-render the server
          // page so the composed result payload arrives as fresh props
          // (the parent remounts this island via its key).
          setPreparing(true);
          router.refresh();
        }
      } catch (error) {
        if (stopped || epoch !== pollEpochRef.current) return;
        if (isSignInError(error)) {
          setSignedOut(true);
          return;
        }
        // B3: connection problems never change the displayed state.
        setReconnecting(true);
      } finally {
        inFlight = false;
      }
    };
    void tick();
    const timer = window.setInterval(() => void tick(), POLL_INTERVAL_MS);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [active, liveConnected, preparing, signedOut, job.id, router]);

  return {
    job,
    setJob,
    active,
    preparing,
    setPreparing,
    signedOut,
    reconnecting,
    now,
    pollEpochRef,
  };
}
