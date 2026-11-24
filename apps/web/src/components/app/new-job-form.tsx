"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cx } from "@/components/ui/cx";
import { UPLOAD_ACCEPT_ATTR } from "@/lib/media-formats";
import {
  cancelPendingUploads,
  DETAIL_LEVELS,
  putFileWithProgress,
  uploadError,
  UploadRequestError,
  type DetailLevelId,
  type WorkspaceOption,
} from "./upload-transfer";
import {
  checkFileBeforeUpload,
  formatFileSize,
  MAX_IMAGE_COUNT,
  MAX_IMAGE_SIZE_LABEL,
  MAX_AUDIO_SIZE_LABEL,
  MAX_DURATION_LABEL,
  MAX_PDF_SIZE_LABEL,
  MAX_SIZE_LABEL,
} from "./upload-rules";

type Phase = "idle" | "ready" | "uploading" | "finalizing" | "created" | "error";

interface UploadError {
  code: string;
  message: string;
}

const ALLOWED_ACCEPT = UPLOAD_ACCEPT_ATTR;

/**
 * New-job upload form (upload.md B1-B6 + analysis-modes.md B2).
 * - Client-side pre-flight with instant named rejections; the server's
 *   4xx envelope is displayed verbatim when it disagrees.
 * - Creates a short-lived upload intent, transfers directly to the target
 *   URL, then asks the server to verify and finalize the object.
 * - One transfer at a time; a failed transfer never creates a job.
 */
export function NewJobForm({ workspaces = [] }: { workspaces?: WorkspaceOption[] }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const abortTransferRef = useRef<(() => void) | null>(null);
  const activeUploadIdsRef = useRef<string[]>([]);
  const attemptRef = useRef(0);
  const navigationTimerRef = useRef<number | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [detailLevel, setDetailLevel] = useState<DetailLevelId>("MEDIUM");
  const [workspaceId, setWorkspaceId] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<UploadError | null>(null);
  const [busyNotice, setBusyNotice] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [createdId, setCreatedId] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      attemptRef.current += 1;
      abortTransferRef.current?.();
      if (navigationTimerRef.current !== null) {
        window.clearTimeout(navigationTimerRef.current);
      }
      const pendingIds = activeUploadIdsRef.current;
      activeUploadIdsRef.current = [];
      void cancelPendingUploads(pendingIds);
    };
  }, []);

  const uploading = phase === "uploading" || phase === "finalizing";
  const transferring = phase === "uploading";

  /** Refuse new files mid-transfer (upload.md B4). */
  function refuseWhileBusy(): boolean {
    if (!uploading) return false;
    setBusyNotice("One upload is already in progress - wait for it to finish before choosing another file.");
    return true;
  }

  function acceptFiles(candidates: File[]): void {
    if (candidates.length === 0 || refuseWhileBusy()) return;
    const checks = candidates.map((candidate) =>
      checkFileBeforeUpload(candidate.name, candidate.size),
    );
    const invalid = checks.find((check) => !check.ok);
    if (invalid?.ok === false) {
      setFiles([]);
      setPhase("idle");
      setError({ code: "CLIENT_VALIDATION", message: invalid.message });
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    const valid = checks.filter(
      (check): check is Extract<typeof check, { ok: true }> => check.ok,
    );
    if (valid.length > MAX_IMAGE_COUNT) {
      setFiles([]);
      setPhase("idle");
      setError({
        code: "CLIENT_VALIDATION",
        message: `Choose up to ${MAX_IMAGE_COUNT} images per analysis`,
      });
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    if (valid.length > 1 && valid.some((check) => check.kind !== "image")) {
      setFiles([]);
      setPhase("idle");
      setError({
        code: "CLIENT_VALIDATION",
        message:
          "Multiple-file jobs accept images only. Upload a video, audio file, or PDF by itself.",
      });
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    setError(null);
    setBusyNotice(null);
    setProgress(0);
    setFiles(candidates);
    setPhase("ready");
  }

  async function startUpload(retry = false): Promise<void> {
    if (files.length === 0 || (!retry && phase !== "ready") || uploading) return;
    const attempt = ++attemptRef.current;
    setError(null);
    setPhase("uploading");
    setProgress(0);

    try {
      const uploadIds: string[] = [];
      for (const [index, selected] of files.entries()) {
        const intentResponse = await fetch("/api/uploads", {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            filename: selected.name,
            sizeBytes: selected.size,
            mime: selected.type || undefined,
            detailLevel,
            workspaceId: workspaceId || undefined,
          }),
        });
        if (!intentResponse.ok) throw await uploadError(intentResponse);
        const target = (await intentResponse.json()) as {
          uploadId: string;
          url: string;
          headers: Record<string, string>;
        };
        if (attempt !== attemptRef.current) {
          await fetch(`/api/uploads/${encodeURIComponent(target.uploadId)}`, {
            method: "DELETE",
          }).catch(() => undefined);
          return;
        }
        uploadIds.push(target.uploadId);
        activeUploadIdsRef.current = [...uploadIds];

        const transfer = putFileWithProgress(target, selected, (fileProgress) => {
          setProgress(
            Math.round(((index + fileProgress / 100) / files.length) * 95),
          );
        });
        abortTransferRef.current = transfer.abort;
        await transfer.promise;
        if (attempt !== attemptRef.current) return;
        abortTransferRef.current = null;
      }

      setProgress(95);
      setPhase("finalizing");

      const completeResponse =
        uploadIds.length > 1
          ? await fetch("/api/uploads/batch/complete", {
              method: "POST",
              headers: {
                Accept: "application/json",
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                uploadIds,
                detailLevel,
                workspaceId: workspaceId || undefined,
              }),
            })
          : await fetch(
              `/api/uploads/${encodeURIComponent(uploadIds[0])}/complete`,
              {
                method: "POST",
                headers: { Accept: "application/json" },
              },
            );
      if (!completeResponse.ok) throw await uploadError(completeResponse);
      const summary = (await completeResponse.json()) as { id?: string };
      if (!summary.id) throw new Error("The job response did not contain an id");

      activeUploadIdsRef.current = [];
      setCreatedId(summary.id);
      setPhase("created");
      navigationTimerRef.current = window.setTimeout(() => {
        router.push(`/app/jobs/${encodeURIComponent(summary.id ?? "")}`);
      }, 450);
    } catch (caught) {
      if (attempt !== attemptRef.current) return;
      const pendingIds = activeUploadIdsRef.current;
      activeUploadIdsRef.current = [];
      await cancelPendingUploads(pendingIds);
      const envelope =
        caught instanceof UploadRequestError
          ? { code: caught.code, message: caught.message }
          : {
              code: "NETWORK",
              message:
                "The upload did not complete - no job was created. Check your connection and try again.",
            };
      setError(envelope);
      setPhase("error");
    } finally {
      if (attempt === attemptRef.current) {
        abortTransferRef.current = null;
      }
    }
  }

  function resetForm(): void {
    activeUploadIdsRef.current = [];
    setFiles([]);
    setPhase("idle");
    setProgress(0);
    setError(null);
    setBusyNotice(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function cancelUploadTransfer(): Promise<void> {
    if (phase !== "uploading") return;
    attemptRef.current += 1;
    abortTransferRef.current?.();
    abortTransferRef.current = null;
    const uploadIds = activeUploadIdsRef.current;
    resetForm();
    await cancelPendingUploads(uploadIds);
  }

  function onDrop(event: React.DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    setDragging(false);
    acceptFiles(Array.from(event.dataTransfer.files ?? []));
  }

  const file = files[0] ?? null;
  const fileChecks = files.map((selected) =>
    checkFileBeforeUpload(selected.name, selected.size),
  );
  const selectionValid =
    fileChecks.length > 0 && fileChecks.every((check) => check.ok);
  const pickedKind = selectionValid && fileChecks[0].ok ? fileChecks[0].kind : null;

  return (
    <div className="space-y-6">
      {/* Limits statement (upload.md B2: shown before upload). */}
      <p className="flex flex-wrap items-center gap-2 text-xs text-ink-faint">
        <span className="label-mono">Accepted formats</span>
        <span className="rounded-md border border-line bg-panel-muted px-2 py-1 font-mono">
          Video, audio, images, PDF
        </span>
        <span className="rounded-md border border-line bg-panel-muted px-2 py-1 font-mono">
          video ≤ {MAX_SIZE_LABEL}
        </span>
        <span className="rounded-md border border-line bg-panel-muted px-2 py-1 font-mono">
          image ≤ {MAX_IMAGE_SIZE_LABEL}
        </span>
        <span className="rounded-md border border-line bg-panel-muted px-2 py-1 font-mono">
          audio ≤ {MAX_AUDIO_SIZE_LABEL}
        </span>
        <span className="rounded-md border border-line bg-panel-muted px-2 py-1 font-mono">
          PDF ≤ {MAX_PDF_SIZE_LABEL} (30 pages)
        </span>
        <span className="rounded-md border border-line bg-panel-muted px-2 py-1 font-mono">
          video/audio ≤ {MAX_DURATION_LABEL}
        </span>
      </p>

      <input
        ref={inputRef}
        id="new-job-file"
        type="file"
        accept={ALLOWED_ACCEPT}
        multiple
        className="sr-only"
        disabled={uploading}
        onChange={(event) =>
          acceptFiles(Array.from(event.target.files ?? []))
        }
      />

      {/* Dropzone / selected-file surface */}
      <div
        role="button"
        tabIndex={uploading ? -1 : 0}
        aria-disabled={uploading}
        aria-label={
          file
            ? files.length === 1
              ? `Selected ${file.name}. Choose a different file.`
              : `Selected ${files.length} images. Choose different files.`
            : "Choose a video, audio, image, or PDF file"
        }
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
        {files.length > 0 ? (
          <div className="flex flex-col items-center gap-2">
            {files.length === 1 && file ? (
              <>
                <span className="max-w-full truncate text-base font-semibold text-ink">
                  {file.name}
                </span>
                <span className="flex flex-wrap items-center justify-center gap-2 text-xs text-ink-muted">
                  <Badge tone="neutral" mono>
                    {fileChecks[0]?.ok
                      ? fileChecks[0].extension.toUpperCase()
                      : "?"}
                  </Badge>
                  <span className="font-mono">{formatFileSize(file.size)}</span>
                  <span className="text-ink-faint">
                    choose a different file or drop one here
                  </span>
                </span>
              </>
            ) : (
              <>
                <span className="text-base font-semibold text-ink">
                  {files.length} images selected
                </span>
                <span className="flex max-w-full flex-wrap justify-center gap-2 text-xs text-ink-muted">
                  {files.map((selected, index) => (
                    <span
                      key={`${selected.name}-${index}`}
                      className="max-w-48 truncate rounded border border-line bg-panel-muted px-2 py-1"
                    >
                      {index + 1}. {selected.name}
                    </span>
                  ))}
                </span>
                <span className="text-xs text-ink-faint">
                  Choose different images or drop new ones here
                </span>
              </>
            )}
          </div>
        ) : (
          <>
            <p className="text-sm font-medium text-ink">
              Drag and drop a video, audio file, PDF, or up to {MAX_IMAGE_COUNT} images, or{" "}
              <span className="text-accent underline underline-offset-2">browse</span>
            </p>
            <p className="mt-2 text-xs text-ink-faint">
              Choose one video, audio file, or PDF, or up to {MAX_IMAGE_COUNT} ordered
              images. Names render as plain text and are never executed.
            </p>
          </>
        )}
      </div>

      {busyNotice && (
        <p role="status" aria-live="polite" className="text-sm text-ink-muted">
          {busyNotice}
        </p>
      )}

      {error && error.code !== "UNAUTHORIZED" && (
        <div
          role="alert"
          className="rounded-lg border border-err-bg bg-err-bg/60 px-4 py-3 text-sm text-err"
        >
          <p className="font-medium">{error.message}</p>
          <p className="mt-1 text-xs opacity-80">
            No job was created — you can try again.
          </p>
        </div>
      )}

      {phase === "created" && createdId && (
        <div
          role="status"
          aria-live="polite"
          className="rounded-lg border border-ok-bg bg-ok-bg/60 px-4 py-3 text-sm text-ok"
        >
          <p className="font-medium">Job created — opening its page…</p>
        </div>
      )}

      {files.length > 0 && selectionValid && (
        <>
          {workspaces.length > 0 && (
            <label className="block max-w-md">
              <span className="label-mono mb-2 block">Destination</span>
              <select
                value={workspaceId}
                onChange={(event) => setWorkspaceId(event.target.value)}
                disabled={uploading}
                className="w-full rounded-md border border-line bg-panel px-3 py-2 text-sm text-ink focus:border-accent"
              >
                <option value="">Personal (only you)</option>
                {workspaces.map((workspace) => (
                  <option key={workspace.id} value={workspace.id}>
                    {workspace.name} · {workspace.role.toLowerCase()}
                  </option>
                ))}
              </select>
              <span className="mt-1 block text-xs text-ink-faint">
                Team jobs are visible to every member. Team admins can add members
                and manage jobs.
              </span>
            </label>
          )}
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
                    "block cursor-pointer rounded-lg border p-4 transition-colors focus-within:ring-2 focus-within:ring-focus",
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
                    disabled={uploading}
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
              onClick={() => void startUpload()}
              disabled={phase !== "ready"}
              className="min-w-40"
            >
              {transferring
                ? "Uploading…"
                : phase === "finalizing"
                  ? "Creating job…"
                  : files.length > 1
                    ? `Analyze ${files.length} images`
                    : pickedKind === "image"
                      ? "Analyze image"
                      : pickedKind === "pdf"
                        ? "Analyze PDF"
                        : pickedKind === "audio"
                          ? "Analyze audio"
                    : "Analyze video"}
            </Button>
            <Button
              variant="ghost"
              size="md"
              onClick={resetForm}
              disabled={uploading}
            >
              {files.length > 1 ? "Remove files" : "Remove file"}
            </Button>
            {phase === "error" && (
              <Button variant="secondary" size="md" onClick={() => void startUpload(true)}>
                Try upload again
              </Button>
            )}
          </div>
        </>
      )}

      {uploading && (
        <Card aria-busy="true">
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-ink-muted">
              <span className="font-medium">
                {files.length > 1
                  ? `Uploading ${files.length} images`
                  : `Uploading ${file?.name ?? "media"}`}
              </span>
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
            <p role="status" className="text-xs leading-relaxed text-ink-faint">
              {phase === "finalizing"
                ? "Received — creating your job…"
                : "Uploading to OpenContext. Large files can take a while; keep this tab open."}
            </p>
            {transferring && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void cancelUploadTransfer()}
              >
                Cancel upload
              </Button>
            )}
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
