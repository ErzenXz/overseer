import { useState } from "react";
import { AppleLogo, Check, Copy, LinuxLogo, WindowsLogo } from "@phosphor-icons/react";
import { Reveal } from "../lib/reveal";

type Platform = {
  id: string;
  label: string;
  icon: typeof LinuxLogo;
  shell: string;
  command: string;
  note: string;
};

const PLATFORMS: Platform[] = [
  {
    id: "linux",
    label: "Linux",
    icon: LinuxLogo,
    shell: "sh",
    command:
      "curl -fsSL https://liveagent-lime.vercel.app/install.sh | sh",
    note: "Installs a systemd unit. The recommended home for an always-on hub.",
  },
  {
    id: "macos",
    label: "macOS",
    icon: AppleLogo,
    shell: "sh",
    command:
      "curl -fsSL https://liveagent-lime.vercel.app/install-macos.sh | sh",
    note: "Runs in your signed-in session and starts again at login. Intel or Apple Silicon.",
  },
  {
    id: "windows",
    label: "Windows",
    icon: WindowsLogo,
    shell: "powershell",
    command:
      "irm https://liveagent-lime.vercel.app/install.ps1 | iex",
    note: "Windows 10/11 or Server 2016+, x64 or ARM64. Terminals use native ConPTY.",
  },
];

const BEATS = [
  {
    title: "Install the hub",
    body: "One machine runs the hub. It serves the web UI, the API, and the join script on port 4200.",
  },
  {
    title: "Join a device",
    body: "The UI hands you a one-line command. Paste it anywhere. The device appears within seconds.",
  },
  {
    title: "Launch an agent",
    body: "Pick Claude Code, Codex, or a plain shell, choose a working directory, and watch it run.",
  },
];

function CommandBlock({ platform }: { platform: Platform }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(platform.command);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="overflow-hidden rounded-panel border border-line bg-ink-900">
      <div className="flex items-center justify-between gap-4 border-b border-line px-4 py-2.5">
        <span className="font-mono text-[11.5px] tracking-wide text-fg-dim">
          {platform.shell}
        </span>
        <button
          type="button"
          onClick={copy}
          className="flex items-center gap-1.5 rounded-control px-2 py-1 font-mono text-[11.5px] text-fg-muted transition-colors hover:bg-ink-850 hover:text-fg active:scale-[0.98]"
        >
          {copied ? (
            <>
              <Check size={13} weight="bold" className="text-beacon" />
              copied
            </>
          ) : (
            <>
              <Copy size={13} weight="regular" />
              copy
            </>
          )}
        </button>
      </div>
      <div className="overflow-x-auto px-4 py-4 sm:px-5 sm:py-5">
        <code className="font-mono text-[12.5px] leading-relaxed whitespace-pre text-fg sm:text-[13.5px]">
          <span className="mr-2 text-beacon select-none">$</span>
          {platform.command}
        </code>
      </div>
    </div>
  );
}

export function Install() {
  const [active, setActive] = useState(PLATFORMS[0]);

  return (
    <section id="install" className="border-t border-line-soft py-24 lg:py-32">
      <div className="mx-auto max-w-[1240px] px-5 lg:px-8">
        <Reveal className="max-w-[46ch]">
          <h2 className="text-[2rem] leading-[1.1] font-semibold tracking-tight text-balance sm:text-[2.4rem]">
            One paste per device. No SSH keys, no port forwarding.
          </h2>
          <p className="mt-5 text-[16px] leading-relaxed text-fg-muted">
            Devices dial out to the hub over a single WebSocket, so NAT and
            firewalls stay exactly as they are.
          </p>
        </Reveal>

        <Reveal delay={0.08} className="mt-10">
          <div
            role="tablist"
            aria-label="Hub install command by operating system"
            className="mb-3 flex flex-wrap gap-1.5"
          >
            {PLATFORMS.map((p) => {
              const Icon = p.icon;
              const on = p.id === active.id;
              return (
                <button
                  key={p.id}
                  role="tab"
                  aria-selected={on}
                  onClick={() => setActive(p)}
                  className={`flex items-center gap-2 rounded-control border px-3.5 py-2 text-[13.5px] transition-colors duration-150 active:scale-[0.98] ${
                    on
                      ? "border-line bg-ink-850 text-fg"
                      : "border-transparent text-fg-muted hover:bg-ink-900 hover:text-fg"
                  }`}
                >
                  <Icon size={16} weight="regular" />
                  {p.label}
                </button>
              );
            })}
          </div>

          <CommandBlock platform={active} />
          <p className="mt-3 text-[13.5px] text-fg-dim">{active.note}</p>
        </Reveal>

        <Reveal delay={0.14}>
          <ol className="mt-16 grid grid-cols-1 gap-px overflow-hidden rounded-panel border border-line bg-line sm:grid-cols-3">
            {BEATS.map((b, i) => (
              <li key={b.title} className="bg-ink-900 px-6 py-7">
                <div className="flex items-baseline gap-3">
                  <span className="font-mono text-[12px] text-beacon">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <h3 className="text-[15.5px] font-semibold tracking-tight">
                    {b.title}
                  </h3>
                </div>
                <p className="mt-2.5 text-[14px] leading-relaxed text-fg-muted">
                  {b.body}
                </p>
              </li>
            ))}
          </ol>
        </Reveal>
      </div>
    </section>
  );
}
