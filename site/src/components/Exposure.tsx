import { Warning } from "@phosphor-icons/react";
import { Reveal } from "../lib/reveal";

const ROUTES = [
  {
    title: "Built-in Let's Encrypt",
    body: "Point a domain at the machine, open 80 and 443, and the hub obtains and renews a real certificate itself.",
    code: "overseer serve --tls-domain overseer.example.com --tls-email you@example.com",
  },
  {
    title: "Tailscale",
    body: "Put the hub and your phone on the same tailnet and browse to its tailnet address. No open ports, no domain.",
    code: null,
  },
  {
    title: "A TLS reverse proxy",
    body: "Caddy, nginx, or Traefik in front of the single hub port, if you already run one.",
    code: null,
  },
];

export function Exposure() {
  return (
    <section className="border-t border-line-soft py-24 lg:py-32">
      <div className="mx-auto max-w-[1240px] px-5 lg:px-8">
        <Reveal>
          <div className="rounded-panel border border-beacon/30 bg-[linear-gradient(140deg,rgba(255,178,36,0.08),transparent_60%)] p-6 lg:p-8">
            <div className="flex items-start gap-3.5">
              <Warning
                size={22}
                weight="regular"
                className="mt-0.5 shrink-0 text-beacon"
              />
              <div>
                <h2 className="text-[1.6rem] leading-[1.15] font-semibold tracking-tight sm:text-[1.9rem]">
                  Read this before you put it on the internet.
                </h2>
                <p className="mt-4 max-w-[70ch] text-[15.5px] leading-relaxed text-fg-muted">
                  Overseer binds to <code className="font-mono text-fg">0.0.0.0:4200</code>{" "}
                  over plain HTTP, which is right for a trusted LAN and wrong for a
                  public address. The MCP endpoint is effectively a remote shell:
                  anyone holding a valid API token can run commands and write files
                  on every joined device. Treat that token like an SSH key, keep the
                  endpoint behind TLS, and rotate it in Settings if it leaks.
                </p>
              </div>
            </div>
          </div>
        </Reveal>

        <Reveal delay={0.08}>
          <div className="mt-6 divide-y divide-line overflow-hidden rounded-panel border border-line bg-ink-900">
            {ROUTES.map((r) => (
              <div
                key={r.title}
                className="grid grid-cols-1 gap-4 p-6 sm:grid-cols-12 sm:items-baseline sm:gap-8"
              >
                <h3 className="text-[15px] font-semibold tracking-tight sm:col-span-3">
                  {r.title}
                </h3>
                <div className="sm:col-span-9">
                  <p className="text-[14.5px] leading-relaxed text-fg-muted">
                    {r.body}
                  </p>
                  {r.code && (
                    <div className="mt-3 overflow-x-auto rounded-control border border-line bg-ink-950/60 px-4 py-3">
                      <code className="font-mono text-[12px] whitespace-pre text-fg-muted">
                        {r.code}
                      </code>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  );
}
