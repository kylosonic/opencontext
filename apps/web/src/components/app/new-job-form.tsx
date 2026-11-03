"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cx } from "@/components/ui/cx";
import {
  checkFileBeforeUpload,
  formatFileSize,
  MAX_DURATION_LABEL,
  MAX_SIZE_LABEL,
} from "./upload-rules";

/**
 * The three context detail levels (analysis-modes.md B1/B2). MEDIUM is
 * the default; the one-line descriptions come from the behavior doc.
 */
type DetailLevelId = "LOW" | "MEDIUM" | "HIGH";

interface DetailLevelOption {
  id: "LOW" | "MEDIUM" | "HIGH";
  name: string;
  description: string;
  default?: boolean;
}

const DETAIL_LEVELS: DetailLevelOption[] = [
  {
    id: "LOW",
    name: "Low",
    description:
      "Transcript, scene titles, and major screen changes only - the smallest output.",
  },
  {
    id: "MEDIUM",
    name: "Medium",
    description:
      "Everything in Low plus per-scene visual descriptions, UI elements, visible text (OCR), and user interactions.",
    default: true,
  },
  {
    id: "HIGH",
    name: "High",
    description:
      "Everything in Medium plus fine-grained per-frame detail, design observations, and an exhaustive UI inventory.",
  },
];

type Phase = "idle" | "ready" | "uploading" | "created" | "error";

interface UploadError {
  code: string;
  message: string;
}

const ALLOWED_ACCEPT = ".mp4,.mov,.webm,.mkv,video/mp4,video/quicktime,video/webm,video/x-matroska";

/**
 * New-job upload form (upload.md B1-B6 + analysis-modes.md B2).
 * - Client-side pre-flight with instant named rejections; the server's
 *   4xx envelope is displayed verbatim when it disagrees.
 * - One transfer at a time (B4); honest local progress (B3: a failed
 *   transfer never created a job, so restarting from zero is the story).
 * - On 201 the browser lands on the new job's detail page.
 */
export function NewJobForm() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [detailLevel, setDetailLevel] = useState<DetailLevelId>("MEDIUM");
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<UploadError | null>(null);
  const [busyNotice, setBusyNotice] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [createdId, setCreatedId] = useState<string | null>(null);

  const uploading = phase === "uploading";

  /** Refuse new files mid-transfer (upload.md B4). */
  function refuseWhileBusy(): boolean {
    if (!uploading) return false;
    setBusyNotice("One upload is already in progress - wait for it to finish before choosing another file.");
    return true;
  }

  function acceptFile(candidate: File | null): void {
    if (!candidate || refuseWhileBusy()) return;
    const check = checkFileBeforeUpload(candidate.name, candidate.size);
    if (!check.ok) {
      // Keep the previous selection; the dropzone stays usable (B1).
      setFile(null);
      setPhase("idle");
      setError({ code: "CLIENT_VALIDATION", message: check.message });
      return;
    }
    setError(null);
    setBusyNotice(null);
    setProgress(0);
    setFile(candidate);
    setPhase("ready");
  }

  function startUpload(): void {
    if (!file || phase !== "ready" || uploading) return;
    setError(null);
    setPhase("uploading");
    setProgress(0);

    const form = new FormData();
    form.set("file", file, file.name);
    form.set("detailLevel", detailLevel);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/jobs");

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        setProgress(Math.round((event.loaded / event.total) * 100));
      }
    };

    xhr.onload = () => {
      if (xhr.status === 201) {
        try {
          const summary = JSON.parse(xhr.responseText) as { id?: string };
          if (!summary.id) throw new Error("missing id");
          setCreatedId(summary.id);
          setPhase("created");
          // Short beat so the success state is visible before landing.
          window.setTimeout(() => {
            router.push(`/app/jobs/${encodeURIComponent(summary.id ?? "")}`);
          }, 450);
          return;
        } catch {
          setError({
            code: "INTERNAL",
            message: "The job was created but its page could not be opened - see your job list.",
          });
          setPhase("error");
          return;
        }
      }
      // Named server rejection (FILE_TOO_LARGE / FORMAT_UNSUPPORTED /
      // VALIDATION_ERROR / UNAUTHORIZED / INTERNAL) - show it verbatim.
      let envelope = { code: "INTERNAL", message: "Upload failed - please try again." };
      try {
        const parsed = JSON.parse(xhr.responseText) as { error?: { code?: string; message?: string } };
        envelope = {
          code: parsed.error?.code ?? envelope.code,
          message: parsed.error?.message ?? envelope.message,
        };
      } catch {
        // non-JSON failure body; keep the generic message
      }
      setError(envelope);
      setPhase("error");
    };

    xhr.onerror = () => {
      // Transfer interruption (upload.md B3): nothing was created.
      setError({
        code: "NETWORK",
        message:
          "The upload did not complete - no job was created. Check your connection and try again.",
      });
      setPhase("error");
    };

    xhr.onabort = () => {
      setError({
        code: "NETWORK",
        message: "The upload was stopped - no job was created.",
      });
      setPhase("error");
    };

    xhr.send(form);
  }

  function resetForm(): void {
    setFile(null);
    setPhase("idle");
    setProgress(0);
    setError(null);
    setBusyNotice(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  function onDrop(event: React.DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    setDragging(false);
    const dropped = event.dataTransfer.files?.[0] ?? null;
    acceptFile(dropped);
  }

  const fileCheck = file
    ? checkFileBeforeUpload(file.name, file.size)
    : null;
  const pickedExtension = fileCheck?.ok ? fileCheck.extension : null;

  return (
    <div className="space-y-6" aria-live="polite">
      {/* Limits statement (upload.md B2: shown before upload). */}
      <p className="flex flex-wrap items-center gap-2 text-xs text-ink-faint">
        <span className="label-mono">Accepted formats</span>
        <span className="rounded-md border border-line bg-panel-muted px-2 py-1 font-mono">
          MP4 · MOV · WebM · MKV
        </span>
        <span className="rounded-md border border-line bg-panel-muted px-2 py-1 font-mono">
          up to {MAX_SIZE_LABEL}
        </span>
        <span className="rounded-md border border-line bg-panel-muted px-2 py-1 font-mono">
          up to {MAX_DURATION_LABEL}
        </span>
      </p>

      <input
        ref={inputRef}
        id="new-job-file"
        type="file"
        accept={ALLOWED_ACCEPT}
        className="sr-only"
        disabled={uploading}
        onChange={(event) => acceptFile(event.target.files?.[0] ?? null)}
      />

      {/* Dropzone / selected-file surface */}
      <div
        role="button"
        tabIndex={uploading ? -1 : 0}
        aria-disabled={uploading}
        aria-label={file ? `Selected file: ${file.name}. Choose a different file.` : "Choose a video file (MP4, MOV, WebM, MKV)"}
        onClick={() => {
          if (!uploading) inputRef.current?.click();
        }}
        onKeyDown={(event) => {
          if (!uploading && (event.key === "Enter" || event.key === " ")) {
            event.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(event) => {
          event.preventDefault();
          if (!uploading) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cx(
          "flex w-full cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed px-6 py-10 text-center transition-colors",
          dragging ? "border-accent bg-accent/5" : "border-line bg-panel hover:bg-panel-muted",
          uploading && "pointer-events-none opacity-70",
        )}
      >
        {file ? (
          <div className="flex flex-col items-center gap-2">
            <span className="max-w-full truncate text-base font-semibold text-ink">
              {file.name}
            </span>
            <span className="flex flex-wrap items-center justify-center gap-2 text-xs text-ink-muted">
              <Badge tone="neutral" mono>{pickedExtension?.toUpperCase() ?? "?"}</Badge>
              <span className="font-mono">{formatFileSize(file.size)}</span>
              <span className="text-ink-faint">choose a different file or drop one here</span>
            </span>
          </div>
        ) : (
          <>
            <p className="text-sm font-medium text-ink">
              Drag and drop a video here, or{" "}
              <span className="text-accent underline underline-offset-2">browse</span>
            </p>
            <p className="mt-2 text-xs text-ink-faint">
              One file at a time. Names render as plain text and are never
              executed.
            </p>
          </>
        )}
      </div>

      {busyNotice && (
        <p role="status" className="text-sm text-ink-muted">
          {busyNotice}
        </p>
      )}

      {phase === "error" && error && error.code !== "UNAUTHORIZED" && (
        <div
          role="alert"
          className="rounded-lg border border-err-bg bg-err-bg/60 px-4 py-3 text-sm text-err"
        >
          <p className="font-medium">{error.message}</p>
          <p className="mt-1 text-xs opacity-80">
            No job was created - you can try again.
          </p>
        </div>
      )}

      {phase === "created" && createdId && (
        <div
          role="status"
          className="rounded-lg border border-ok-bg bg-ok-bg/60 px-4 py-3 text-sm text-ok"
        >
          <p className="font-medium">Job created - opening its page…</p>
        </div>
      )}

      {file && fileCheck?.ok && (
        <>
          {/* Detail level (analysis-modes.md B2: three selectable cards). */}
          <fieldset>
            <legend className="label-mono mb-3">
              Context detail level
            </legend>
            <div className="grid gap-3 sm:grid-cols-3">
              {DETAIL_LEVELS.map((level) => (
                <label
                  key={level.id}
                  className={cx(
                    "block cursor-pointer rounded-lg border p-4 transition-colors focus-within:ring-2 focus-within:ring-(--focus) focus-within:outline-none",
                    detailLevel === level.id
                      ? "border-accent bg-accent/5"
                      : "border-line bg-panel hover:bg-panel-muted",
                  )}
                >
                  <input
                    type="radio"
                    name="detailLevel"
                    value={level.id}
                    checked={detailLevel === level.id}
                    onChange={() => setDetailLevel(level.id)}
                    className="sr-only"
                  />
                  <span className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-ink">
                      {level.name}
                    </span>
                    {level.default && (
                      <Badge tone="neutral" mono>Default</Badge>
                    )}
                  </span>
                  <span className="mt-1.5 block text-xs leading-relaxed text-ink-muted">
                    {level.description}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              onClick={startUpload}
              disabled={phase !== "ready"}
              className="min-w-40"
            >
              {uploading ? "Uploading…" : "Analyze video"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={resetForm}
              disabled={uploading}
            >
              Remove file
            </Button>
            {phase === "error" && (
              <Button variant="secondary" size="sm" onClick={startUpload}>
                Try upload again
              </Button>
            )}
          </div>
        </>
      )}

      {uploading && (
        <Card>
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-ink-muted">
              <span className="font-medium">Uploading {file?.name}</span>
              <span className="font-mono">{progress}%</span>
            </div>
            <div
              role="progressbar"
              aria-valuenow={progress}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Upload progress"
              className="h-1.5 overflow-hidden rounded-full bg-panel-muted"
            >
              <div
                className="h-full rounded-full bg-accent transition-[width] duration-200"
                style={{ width: `${Math.max(0, Math.min(100, progress))}%` }}
              />
            </div>
            <p className="text-xs leading-relaxed text-ink-faint">
              {progress === 100
                ? "Received - creating your job…"
                : "Uploading to OpenContext. Large files can take a while; keep this tab open."}
            </p>
          </div>
        </Card>
      )}

      {error?.code === "UNAUTHORIZED" && (
        <Card className="border-err-bg">
          <p className="text-sm leading-relaxed text-ink">
            Your session expired while choosing this file.
          </p>
          <p className="mt-1 text-sm leading-relaxed text-ink-muted">
            The selected file survives the sign-in round-trip in this tab.
          </p>
          <ButtonLink
            href={`/auth/signin?callbackUrl=${encodeURIComponent("/app/new")}`}
            variant="secondary"
            size="sm"
            className="mt-3"
          >
            Sign in again
          </ButtonLink>
        </Card>
      )}
    </div>
  );
}
