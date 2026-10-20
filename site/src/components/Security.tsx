import {
  ArrowsClockwise,
  Code,
  Key,
  LockSimple,
  Monitor,
  Plugs,
} from "@phosphor-icons/react";
import type { Icon } from "@phosphor-icons/react";
import { Reveal } from "../lib/reveal";
import { REPO } from "../lib/site";

const ITEMS: { icon: Icon; title: string; body: string }[] = [
  {
    icon: Plugs,
    title: "No inbound ports",
    body: "Devices dial out over one WebSocket. Nothing new listens on your laptop, homelab or cloud VMs, and NAT stays as it is.",
  },
  {
    icon: Key,
    title: "Your subscriptions, your keys",
    body: "Agents use the CLI logins already on each machine. Credentials stay in each provider's own storage. Overseer never saves provider tokens.",
  },
  {
    icon: LockSimple,
    title: "Private remote access",
    body: "Setup can install Tailscale and configure Tailscale Serve, giving the hub a private HTTPS address on your tailnet. Built-in Let's Encrypt is there too.",
  },
  {
    icon: Monitor,
    title: "Desktop never exposed",
    body: "The remote desktop is tunnelled through the agent connection, so the machine's VNC server is never exposed to the network.",
  },
  {
    icon: ArrowsClockwise,
    title: "Verified updates, with rollback",
    body: "Releases are checked against their checksums before anything is replaced. The previous binary is kept, so rolling back is one click.",
  },
  {
    icon: Code,
    title: "Open source, one binary",
    body: "MIT licensed. Hub, device agent, CLI and MCP server are the same static binary, with the web UI and SQLite built in.",
  },
];

export function Security() {
  return (
    <section
      id="security"
      aria-labelledby="security-title"
      className="py-24 sm:py-32"
    >
      <div className="container-page">
        <div className="grid grid-cols-1 gap-12 lg:grid-cols-12 lg:gap-16">
          <Reveal className="lg:col-span-4">
            <p className="eyebrow">Security and self-hosting</p>
            <h2 id="security-title" className="h-section mt-4">
              Your machines. Your keys. Your network.
            </h2>
            <p className="lede mt-5">
              There is no Overseer cloud. The hub runs on hardware you own, and
              your code never leaves your machines unless an agent you chose
              sends it to the provider you already use.
            </p>
            <a
              href={REPO}
              target="_blank"
              rel="noreferrer"
              className="mt-6 inline-flex items-center gap-1.5 text-[15px] font-medium text-accent hover:underline"
            >
              Read the source →
            </a>
          </Reveal>

          <Reveal delay={0.06} className="lg:col-span-8">
            <ul className="grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-2">
              {ITEMS.map(({ icon: I, title, body }) => (
                <li key={title} className="bg-page p-6 sm:p-7">
                  <I size={20} className="text-ink-2" aria-hidden="true" />
                  <h3 className="mt-4 text-[16px] font-semibold tracking-[-0.015em]">
                    {title}
                  </h3>
                  <p className="mt-1.5 text-[14.5px] leading-relaxed text-ink-3">
                    {body}
                  </p>
                </li>
              ))}
            </ul>
            <p className="mt-5 text-[13.5px] leading-relaxed text-ink-3">
              A note on remote MCP: it can run commands and write files on your
              devices. It refuses requests without an API token and should only
              be exposed over HTTPS. Treat that token like an SSH key.
            </p>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
