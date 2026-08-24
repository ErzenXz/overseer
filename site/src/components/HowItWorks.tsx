import { Browsers, HardDrives, Cloud, Laptop } from "@phosphor-icons/react";
import { Reveal } from "../lib/reveal";

function Node({
  icon: Icon,
  title,
  sub,
  accent = false,
}: {
  icon: typeof Browsers;
  title: string;
  sub: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`rounded-panel border px-5 py-4 text-center ${
        accent
          ? "border-beacon/35 bg-[linear-gradient(180deg,rgba(255,178,36,0.10),transparent)]"
          : "border-line bg-ink-900"
      }`}
    >
      <Icon
        size={20}
        weight="regular"
        className={`mx-auto ${accent ? "text-beacon" : "text-fg-muted"}`}
      />
      <div className="mt-2.5 text-[14.5px] font-semibold tracking-tight">
        {title}
      </div>
      <div className="mt-1 font-mono text-[11.5px] text-fg-dim">{sub}</div>
    </div>
  );
}

const AGENTS = [
  { icon: Laptop, title: "MacBook", sub: "launchd" },
  { icon: HardDrives, title: "Homelab", sub: "systemd" },
  { icon: Cloud, title: "Cloud VM", sub: "systemd" },
];

export function HowItWorks() {
  return (
    <section id="how" className="relative border-t border-line-soft py-24 lg:py-32">
      <div
        aria-hidden
        className="grid-field pointer-events-none absolute inset-0 opacity-40 [mask-image:radial-gradient(ellipse_60%_60%_at_50%_50%,black,transparent)]"
      />

      <div className="relative mx-auto max-w-[1240px] px-5 lg:px-8">
        <Reveal className="max-w-[46ch]">
          <h2 className="text-[2rem] leading-[1.1] font-semibold tracking-tight text-balance sm:text-[2.4rem]">
            One outbound WebSocket per device.
          </h2>
          <p className="mt-5 text-[16px] leading-relaxed text-fg-muted">
            Terminal streams, machine stats, file transfers, and control all
            share the same connection. Nothing dials in to your devices.
          </p>
        </Reveal>

        <Reveal delay={0.1}>
          <div className="mx-auto mt-16 max-w-[760px]">
            <div className="mx-auto max-w-[280px]">
              <Node
                icon={Browsers}
                title="Your browser"
                sub="desktop or phone"
              />
            </div>

            <div className="relative flex justify-center py-3">
              <div className="h-12 w-px bg-line" />
              <span className="absolute top-1/2 left-1/2 ml-3 -translate-y-1/2 font-mono text-[11px] whitespace-nowrap text-fg-dim">
                HTTPS + WebSocket
              </span>
            </div>

            <div className="mx-auto max-w-[280px]">
              <Node
                icon={HardDrives}
                title="Hub"
                sub="web UI, API, SQLite"
                accent
              />
            </div>

            <div className="relative flex justify-center py-3">
              <div className="h-12 w-px bg-line" />
              <span className="absolute top-1/2 left-1/2 ml-3 -translate-y-1/2 font-mono text-[11px] whitespace-nowrap text-fg-dim">
                one WebSocket, dialed out
              </span>
            </div>

            {/* Fan-out rail. Hidden below sm, where the nodes stack instead. */}
            <div className="mx-auto hidden h-px w-2/3 bg-line sm:block" />

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 sm:gap-5">
              {AGENTS.map((a) => (
                <div key={a.title}>
                  <div className="mx-auto hidden h-8 w-px bg-line sm:block" />
                  <div className="mx-auto flex h-6 w-px justify-center bg-line sm:hidden" />
                  <Node icon={a.icon} title={a.title} sub={a.sub} />
                </div>
              ))}
            </div>

            <p className="mt-8 text-center text-[13.5px] text-fg-dim">
              Each agent handles PTYs, tmux sessions, machine stats, and file
              access on its own box.
            </p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
