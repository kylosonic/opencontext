/** Format seconds as a timestamp. `75` → "01:15", `3661` → "1:01:01". */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Format a [start–end] range. `(0, 8)` → "[00:00–00:08]". */
export function formatRange(start: number, end: number): string {
  return `[${formatClock(start)}–${formatClock(end)}]`;
}

/** Format an ISO timestamp as "Sep 1, 2026 · 09:58 UTC". */
export function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    hour12: false,
  });
}

/** Percentage label from a 0–1 confidence. `0.94` → "94%". */
export function formatConfidence(confidence: number): string {
  return `${Math.round(confidence * 100)}%`;
}
