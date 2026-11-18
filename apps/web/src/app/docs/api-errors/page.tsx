import type { Metadata } from "next";
import { ERROR_CATALOG, ERROR_CODES } from "@kylosonic/opencontext-schemas";
import { DocsShell } from "@/components/docs-shell";

export const metadata: Metadata = {
  title: "API errors - OpenContext docs",
  description: "Public error codes, HTTP statuses, and meanings for the OpenContext API.",
};

export default function ApiErrorsPage() {
  return (
    <DocsShell
      kicker="API reference"
      title="Error catalog"
      description="Public API failures use one envelope and a stable code. Worker stage failures may also include an optional stage name."
    >
      <div className="text-sm leading-relaxed text-ink-muted">
        <p className="border-l-2 border-line-strong pl-4">
          Statuses and meanings are generated from the same shared contract used by the web app and Python worker.
        </p>
        <div className="mt-6 overflow-x-auto rounded-lg border border-line">
          <table className="w-full min-w-[40rem] border-collapse text-sm">
            <thead>
              <tr className="border-b border-line-strong text-left">
                <th scope="col" className="px-3 py-2 font-mono text-xs text-ink-faint">Code</th>
                <th scope="col" className="px-3 py-2 font-mono text-xs text-ink-faint">HTTP</th>
                <th scope="col" className="px-3 py-2 font-mono text-xs text-ink-faint">Meaning</th>
              </tr>
            </thead>
            <tbody>
              {ERROR_CODES.map((code) => {
                const entry = ERROR_CATALOG[code];
                return (
                  <tr key={code} className="border-b border-line align-top last:border-0">
                    <th scope="row" className="px-3 py-3 font-mono text-[0.8rem] text-ink">{code}</th>
                    <td className="px-3 py-3 font-mono text-ink-muted">{entry.status}</td>
                    <td className="px-3 py-3 text-ink-muted">{entry.description}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </DocsShell>
  );
}
