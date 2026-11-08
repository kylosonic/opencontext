import type { Metadata } from "next";
import { ERROR_CATALOG, ERROR_CODES } from "@opencontext/schemas";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { Container } from "@/components/ui/container";
import { Section } from "@/components/ui/section";

export const metadata: Metadata = {
  title: "API errors — OpenContext",
  description: "Public error codes, HTTP statuses, and meanings for the OpenContext API.",
};

export default function ApiErrorsPage() {
  return (
    <>
      <SiteHeader />
      <main id="main">
        <Container className="pb-16 pt-14">
          <header className="max-w-3xl">
            <p className="label-mono mb-3">API reference</p>
            <h1 className="text-3xl font-bold tracking-tight text-ink sm:text-4xl">
              Error catalog
            </h1>
            <p className="mt-4 text-base leading-relaxed text-ink-muted">
              Public API failures use one envelope and a stable code. Worker
              stage failures may also include an optional stage name.
            </p>
          </header>
        </Container>

        <Section
          kicker="Contract"
          title="Stable error codes"
          description="Statuses and meanings are generated from the shared schema used by the web app and Python worker."
          flush
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[42rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-line-strong text-left">
                  <th scope="col" className="py-2 pr-4 font-mono text-xs uppercase tracking-wider text-ink-faint">Code</th>
                  <th scope="col" className="py-2 pr-4 font-mono text-xs uppercase tracking-wider text-ink-faint">HTTP</th>
                  <th scope="col" className="py-2 font-mono text-xs uppercase tracking-wider text-ink-faint">Meaning</th>
                </tr>
              </thead>
              <tbody>
                {ERROR_CODES.map((code) => {
                  const entry = ERROR_CATALOG[code];
                  return (
                    <tr key={code} className="border-b border-line align-top">
                      <th scope="row" className="py-3 pr-4 font-mono text-[0.8rem] text-ink">{code}</th>
                      <td className="py-3 pr-4 font-mono text-ink-muted">{entry.status}</td>
                      <td className="py-3 text-ink-muted">{entry.description}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Section>
      </main>
      <SiteFooter />
    </>
  );
}
