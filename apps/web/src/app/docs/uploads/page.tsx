import type { Metadata } from "next";
import Link from "next/link";
import { DocsShell } from "@/components/docs-shell";
import { Badge } from "@/components/ui/badge";

export const metadata: Metadata = {
  title: "Uploading media - OpenContext docs",
};

const INPUTS = [
  ["Video", "MP4, MOV, WebM, or MKV", "500 MB; 30 minutes"],
  ["Still image", "PNG, JPG, JPEG, or WebP", "25 MB; 40 megapixels"],
  [
    "Image set",
    "2 to 10 PNG, JPG, JPEG, or WebP files",
    "25 MB per image; 40 megapixels each",
  ],
  ["PDF", "PDF with up to 30 pages", "50 MB; 30 pages"],
] as const;

export default function UploadsPage() {
  return (
    <DocsShell
      kicker="Get started"
      title="Uploading media"
      description="Choose a video, an ordered image set, or a PDF. Files are checked before transfer and again before the job is queued."
      accessory={
        <Badge tone="success" mono>
          Upload flows verified
        </Badge>
      }
    >
      <div className="space-y-10 text-sm leading-relaxed text-ink-muted">
        <section aria-labelledby="accepted-title">
          <h2 id="accepted-title" className="text-xl font-semibold text-ink">
            Accepted inputs
          </h2>
          <div className="mt-4 overflow-x-auto rounded-lg border border-line">
            <table className="w-full min-w-[36rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-line-strong text-left">
                  <th scope="col" className="px-3 py-2 text-xs text-ink-faint">
                    Source
                  </th>
                  <th scope="col" className="px-3 py-2 text-xs text-ink-faint">
                    Formats
                  </th>
                  <th scope="col" className="px-3 py-2 text-xs text-ink-faint">
                    Limit
                  </th>
                </tr>
              </thead>
              <tbody>
                {INPUTS.map(([source, formats, limit]) => (
                  <tr
                    key={source}
                    className="border-b border-line align-top last:border-0"
                  >
                    <th
                      scope="row"
                      className="px-3 py-3 text-left font-medium text-ink"
                    >
                      {source}
                    </th>
                    <td className="px-3 py-3">{formats}</td>
                    <td className="px-3 py-3">{limit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-4">
            A video job runs speech transcription when an audio track is
            present. Images and PDFs skip transcription and use visual analysis,
            including text found in the source.
          </p>
        </section>

        <section aria-labelledby="imageset-title">
          <h2 id="imageset-title" className="text-xl font-semibold text-ink">
            Ordered image sets
          </h2>
          <p className="mt-3">
            Select two or more images together to compare different states of
            the same screen, design, or visual flow. Each image becomes a
            numbered source in the result, and the context identifies text and
            interface differences between the images. Remove a file before
            submitting if the order is wrong; the selected order is the
            processing order.
          </p>
          <p className="mt-3">
            A set is committed as one job. If any member fails validation, the
            set is rejected and no partial job is created. You can correct the
            selection and upload it again.
          </p>
        </section>

        <section aria-labelledby="transfer-title">
          <h2 id="transfer-title" className="text-xl font-semibold text-ink">
            Transfer and validation
          </h2>
          <ol className="mt-4 list-decimal space-y-3 pl-5">
            <li>
              The app checks the filename, format, and declared size before
              transfer.
            </li>
            <li>
              Large files upload directly to configured object storage, rather
              than passing through the page request.
            </li>
            <li>
              After transfer, the server verifies the stored object. Images also
              need a valid image signature and decodable dimensions; PDFs need a
              PDF signature.
            </li>
            <li>
              The verified object becomes a queued job. An upload intent is
              valid for 15 minutes.
            </li>
          </ol>
          <p className="mt-4">
            A failed or cancelled upload does not create a job. A video that is
            not decodable, or is longer than 30 minutes, is rejected when
            extraction begins and cannot be retried without uploading a
            corrected file.
          </p>
        </section>

        <section aria-labelledby="detail-title">
          <h2 id="detail-title" className="text-xl font-semibold text-ink">
            Detail level
          </h2>
          <p className="mt-3">
            Choose <strong className="text-ink">Low</strong>,{" "}
            <strong className="text-ink">Medium</strong>, or{" "}
            <strong className="text-ink">High</strong>. Medium is the default.
            Low keeps the core summary and major changes; Medium adds visual
            descriptions, UI elements, visible text, and interactions; High adds
            fine-grained detail and design observations.
          </p>
        </section>

        <p>
          Next, see how uploads move through the{" "}
          <Link href="/docs/jobs" className="text-accent hover:underline">
            job lifecycle
          </Link>
          .
        </p>
      </div>
    </DocsShell>
  );
}
