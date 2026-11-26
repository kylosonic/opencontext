import type { Metadata } from "next";
import { CodeBlock } from "@/components/code-block";
import { DocsShell } from "@/components/docs-shell";

export const metadata: Metadata = {
  title: "Agent integration — OpenContext Docs",
  description:
    "Connect coding agents to local media analysis and evidence-linked implementation briefs via the opencontext-mcp stdio server.",
};

export default function AgentsPage() {
  return (
    <DocsShell
      kicker="Local integration"
      title="Agent integration"
      description="Give a coding agent bounded access to local media analysis and evidence-linked implementation briefs through MCP."
    >
      <div className="space-y-10 text-sm leading-relaxed text-ink-muted">
        <section aria-labelledby="install-title">
          <h2 id="install-title" className="text-xl font-semibold text-ink">
            Install the MCP server
          </h2>
          <div className="mt-4">
            <CodeBlock
              wrap
              label="Install with the agent extra"
              code={`python -m pip install "opencontext-video[agent]==0.1.2"`}
            />
          </div>
          <p className="mt-4">
            Add the <code>local</code> extra as well for on-device speech recognition.
          </p>
        </section>

        <section aria-labelledby="configure-title">
          <h2 id="configure-title" className="text-xl font-semibold text-ink">
            Configure the client
          </h2>
          <p className="mt-3">Configure your MCP-capable client to launch the local stdio server.</p>
          <div className="mt-4">
            <CodeBlock
              label="MCP client configuration"
              code={`{
  "mcpServers": {
    "opencontext": {
      "command": "opencontext-mcp",
      "args": []
    }
  }
}`}
            />
          </div>
        </section>

        <section aria-labelledby="tools-title">
          <h2 id="tools-title" className="text-xl font-semibold text-ink">
            Tools
          </h2>
          <div className="mt-4 divide-y divide-line border-y border-line">
            {[
              ["analyze_media", "Analyze local video or image media and return a repository-aware brief."],
              ["analyze_video", "Explicit video-only compatibility entry point."],
              ["analyze_image", "Explicit image-only compatibility entry point."],
              ["implementation_brief", "Build a brief from an existing OpenContext JSON result."],
              ["context_evidence", "Look up a bounded evidence ledger for verification."],
            ].map(([tool, purpose]) => (
              <div key={tool} className="grid gap-1 py-3 sm:grid-cols-[12rem_minmax(0,1fr)] sm:gap-4">
                <code className="break-all text-xs text-ink">{tool}</code>
                <p>{purpose}</p>
              </div>
            ))}
          </div>
          <p className="mt-4">
            The server reads only paths supplied by the client and does not upload repository contents. Repository detection examines file names, extensions, and manifest metadata; it does not execute project code.
          </p>
        </section>
      </div>
    </DocsShell>
  );
}
