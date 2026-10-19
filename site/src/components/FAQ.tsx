import type { ReactNode } from "react";
import { Plus } from "@phosphor-icons/react";
import { Reveal } from "../lib/reveal";

const QA: { q: string; a: ReactNode }[] = [
  {
    q: "What exactly is Overseer?",
    a: "A self-hosted control plane for coding agents. You run one hub, join your other machines to it, and then start, watch and steer agent sessions, shells and remote desktops on any of them from a browser.",
  },
  {
    q: "Does my code or my API key go through your servers?",
    a: "No. There are no Overseer servers. The hub runs on your machine, and each agent uses the CLI login already on the machine it runs on. Overseer never stores provider tokens.",
  },
  {
    q: "Which agents does it support?",
    a: "Claude Code and Codex through their native machine protocols, plus Gemini CLI, OpenCode, Goose, Copilot CLI and Cursor Agent over the Agent Client Protocol. Any other ACP agent works too.",
  },
  {
    q: "Do I need to open ports or set up SSH?",
    a: "No. Each device opens one outbound WebSocket to the hub, so it works behind NAT and firewalls. To reach the hub itself from outside your network, use Tailscale Serve, the built-in Let's Encrypt support, or your own TLS proxy.",
  },
  {
    q: "What happens when I close the browser?",
    a: "Sessions keep running. Shells on macOS and Linux live in tmux, so you can reattach from another device. Windows terminals use ConPTY and are live, but not yet reattachable after a disconnect.",
  },
  {
    q: "Which platforms can run the hub and devices?",
    a: "macOS, Linux and Windows 10/11 or Server 2016+, on amd64 or arm64. Linux uses systemd, macOS uses launchd, and Windows uses a Scheduled Task.",
  },
  {
    q: "Can my team share one hub?",
    a: "Not yet. Overseer is single-user today. Multi-user support is on the roadmap.",
  },
  {
    q: "How is it updated?",
    a: "Installed hubs check for stable releases every six hours and update themselves by default, and device agents follow the hub's version. Every download is verified against its checksum, the previous version is kept for one-click rollback, and a version that keeps crashing after an update is rolled back automatically.",
  },
  {
    q: "What does it cost?",
    a: "Overseer is free and open source under the MIT license. Your agents use your existing subscriptions or API keys.",
  },
];

export function FAQ() {
  return (
    <section id="faq" aria-labelledby="faq-title" className="py-24 sm:py-32">
      <div className="container-page grid grid-cols-1 gap-12 lg:grid-cols-12 lg:gap-16">
        <Reveal className="lg:col-span-4">
          <p className="eyebrow">FAQ</p>
          <h2 id="faq-title" className="h-section mt-4">
            Questions, answered.
          </h2>
        </Reveal>
        <Reveal delay={0.06} className="lg:col-span-8">
          <div className="border-t border-line">
            {QA.map(({ q, a }) => (
              <details key={q} className="faq group border-b border-line">
                <summary className="flex items-center gap-4 rounded-md py-5 text-[16.5px] font-medium tracking-[-0.01em]">
                  <span className="flex-1">{q}</span>
                  <Plus
                    size={16}
                    aria-hidden="true"
                    className="faq-plus shrink-0 text-ink-3 transition-transform duration-200"
                  />
                </summary>
                <p className="-mt-1 max-w-[64ch] pb-6 text-[15px] leading-relaxed text-ink-3">
                  {a}
                </p>
              </details>
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  );
}
