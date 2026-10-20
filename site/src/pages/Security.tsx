import { ArrowRight } from "@phosphor-icons/react";
import { mount, PageHeader } from "../components/Layout";
import { Shot } from "../components/Shot";
import { DOCS, REPO } from "../lib/site";
import { Reveal } from "../lib/reveal";

const SECTIONS: { label: string; items: [string, string][] }[] = [
  {
    label: "Your network",
    items: [
      ["No inbound ports", "Every machine opens one outbound WebSocket to your hub. Nothing new listens on your laptop, homelab or cloud boxes, and NAT stays as it is."],
      ["Private remote access", "Reach the hub over Tailscale, Cloudflare Tunnel or the built-in Let’s Encrypt HTTPS. Don’t put plain HTTP on the internet; the guide shows each option."],
      ["Desktop never exposed", "The remote desktop is tunnelled through the machine’s own connection, so its VNC server is never reachable from the network."],
      ["Private previews", "Each dev-server preview has its own address and asks your hub who you are first. It can only reach that machine’s localhost."],
    ],
  },
  {
    label: "Your accounts",
    items: [
      ["Your logins stay on your machines", "Agents use the CLI logins already on each computer. Credentials stay in each provider’s own storage; Overseer never sees or stores provider tokens."],
      ["Secrets are redacted at the source", "When Overseer lists an agent’s MCP servers, hooks or settings, environment values, headers and tokens are stripped on the machine before anything is sent."],
      ["Plan limits without your token", "Usage limits come from the CLIs’ own reporting. Overseer doesn’t read credential files or call provider APIs itself."],
    ],
  },
  {
    label: "What agents may do",
    items: [
      ["You choose the access", "Each session runs in the agent’s own mode, from read-only and plan to ask-before-edits, auto and full access."],
      ["Approve risky steps", "Commands that need permission wait in the thread: allow once, always allow, or reject."],
      ["Nothing installs code without asking", "Plugins from marketplaces show what they add, and if one needs to run a command, you see that exact command first."],
      ["Skills are never deleted", "Removing a skill moves it to a trash folder next to it."],
    ],
  },
  {
    label: "The software",
    items: [
      ["Verified updates, with rollback", "Every release is checked against its checksum before anything is replaced. The previous version is kept for one-click rollback, and one that keeps crashing rolls itself back."],
      ["Login and requests", "A one-time setup code stops anyone else on your network claiming a new hub. Rate-limited sign-in, and changes made with your session must come from the hub itself."],
      ["Open source, MIT", "The hub, the machine agent, the CLI and the MCP server are one static binary. Read every line, build it yourself."],
    ],
  },
];

function Security() {
  return (
    <>
      <PageHeader label="Security" title={<>Your machines. <span className="text-ink-4">Your keys. Your rules.</span></>}>
        Overseer runs entirely on computers you own. There is no Overseer cloud, no account with us, and nothing about your code leaves your network unless an agent you started sends it.
      </PageHeader>
      {SECTIONS.map((section) => (
        <div key={section.label}>
          <div className="rule" />
          <section className="frame" aria-label={section.label}>
            <div className="cells lg:grid-cols-[1fr_3fr]">
              <div className="cell"><p className="label">{section.label}</p></div>
              <div className={`cells sm:grid-cols-2`}>
                {section.items.map(([title, body]) => (
                  <Reveal key={title} className="cell">
                    <h3 className="text-[16px] font-semibold">{title}</h3>
                    <p className="mt-2 text-[14.5px] leading-relaxed text-ink-3">{body}</p>
                  </Reveal>
                ))}
              </div>
            </div>
          </section>
        </div>
      ))}
      <div className="rule" />
      <section className="frame" aria-labelledby="approve-title">
        <div className="cells lg:grid-cols-[1fr_1.4fr]">
          <Reveal className="cell flex flex-col justify-center">
            <p className="label">In practice</p>
            <h2 id="approve-title" className="h-feature mt-4">The agent asks. You decide.</h2>
            <p className="mt-4 text-[15px] leading-relaxed text-ink-3">A Claude Code session asking before it runs a test command. The same works from your phone.</p>
            <div className="mt-6 flex flex-wrap gap-2.5">
              <a href={`${DOCS}remote-access/`} className="btn btn-sm btn-outline">Remote access guide<ArrowRight size={14} /></a>
              <a href={`${REPO}/security`} target="_blank" rel="noreferrer" className="btn btn-sm btn-ghost">Report a vulnerability</a>
            </div>
          </Reveal>
          <div className="field p-4 sm:p-8"><Shot name="approval" alt="A session waiting for approval before running a command" /></div>
        </div>
      </section>
    </>
  );
}

mount("security", <Security />);
