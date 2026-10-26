import { useState, type ReactNode } from "react";
import { ArrowRight, ArrowUpRight, Bell, Clock, Desktop, Robot, ShieldCheck, Stack } from "@phosphor-icons/react";
import { mount } from "../components/Layout";
import { HeroInstall } from "../components/InstallCommand";
import { Morph } from "../components/Morph";
import { Shot } from "../components/Shot";
import { REPO } from "../lib/site";
import { Reveal } from "../lib/reveal";

// The CLI, in the layout it prints (tab-aligned tables from `overseer fleet`).
const CLI: { id: string; label: string; lines: ReactNode[] }[] = [
  {
    id: "devices",
    label: "devices",
    lines: [
      <><span className="t-accent">$</span> overseer fleet devices</>,
      <span className="t-out">NAME         ID       OS/ARCH        STATUS        LAST SEEN</span>,
      <span className="t-out">MacBook Pro  mbp      darwin/arm64   online (hub)  Oct 20 16:41</span>,
      <span className="t-out">studio       studio   linux/amd64    online        Oct 20 16:41</span>,
      <span className="t-out">homelab      homelab  linux/arm64    online        Oct 20 16:40</span>,
    ],
  },
  {
    id: "new",
    label: "new",
    lines: [
      <><span className="t-accent">$</span> overseer fleet new studio fix-login --cwd ~/app --cmd claude</>,
      <span className="t-out">session "fix-login" created on studio</span>,
      <><span className="t-accent">$</span> overseer fleet sessions</>,
      <span className="t-out">SESSION      DEVICE   KIND      STATUS</span>,
      <span className="t-out">fix-login    studio   claude    working</span>,
      <span className="t-out">review-pr    homelab  codex     waiting</span>,
      <span className="t-out">dev-server   studio   terminal  idle</span>,
    ],
  },
  {
    id: "send",
    label: "send & read",
    lines: [
      <><span className="t-accent">$</span> overseer fleet send studio fix-login "run the auth tests"</>,
      <><span className="t-accent">$</span> overseer fleet read studio fix-login --lines 4</>,
      <span className="t-out">● Ran go test ./internal/auth/...</span>,
      <span className="t-out">  ok   internal/auth  2.41s</span>,
      <span className="t-ok">  All 44 tests pass.</span>,
    ],
  },
  {
    id: "forward",
    label: "forward",
    lines: [
      <><span className="t-accent">$</span> overseer forward studio 5173</>,
      <span className="t-out">Forwarding http://localhost:5173 -&gt; localhost:5173 on studio (Ctrl-C to stop)</span>,
    ],
  },
  {
    id: "mcp",
    label: "mcp",
    lines: [
      <span className="t-dim"># let Claude Code run your fleet</span>,
      <><span className="t-accent">$</span> claude mcp add overseer -- overseer mcp</>,
      <span className="t-out">Added stdio MCP server overseer</span>,
    ],
  },
];

function Cli() {
  const [tab, setTab] = useState(CLI[0].id);
  const current = CLI.find((item) => item.id === tab)!;
  return (
    <div className="cli-window">
      <div className="cli-window__body" role="tabpanel" aria-label={`${current.label} example`}>
        {current.lines.map((line, i) => <div key={i}>{line}</div>)}
        <div><span className="t-accent">$</span> <span className="cursor" /></div>
      </div>
      <div className="cli-tabs" role="tablist" aria-label="CLI examples">
        {CLI.map((item) => (
          <button key={item.id} type="button" role="tab" aria-selected={item.id === tab} onClick={() => setTab(item.id)}>{item.label}</button>
        ))}
      </div>
    </div>
  );
}

const FEATURES: { icon: ReactNode; title: string; body: string; checks: string[]; link: [string, string] }[] = [
  {
    icon: <Stack size={20} />,
    title: "Persistent Agent Sessions",
    body: "Sessions run on the machine, not in your browser. Close the tab, open Overseer on your phone, and the agent is still working where you left it.",
    checks: ["Claude Code, Codex, Gemini CLI, OpenCode, Devin and any ACP agent", "Fork a session, undo a step, steer it or queue a follow-up", "Pin, group in folders and archive sessions"],
    link: ["Sessions", "/features/#sessions"],
  },
  {
    icon: <Bell size={20} />,
    title: "Approvals, Status and Usage",
    body: "Each session shows as working, waiting, done or failed. When an agent wants to run a command, you allow once, always allow or reject it inline.",
    checks: ["Per-session access from read-only to full access", "Notification when an agent finishes", "Context window and Claude and Codex plan limits"],
    link: ["Approvals & usage", "/features/#sessions"],
  },
  {
    icon: <Robot size={20} />,
    title: "Agents, Skills and Plugins",
    body: "Agents installed on a machine appear automatically, each with its own models, thinking levels, fast mode and permission modes.",
    checks: ["Install and sign in to agent CLIs from Machines → Setup", "See and toggle skills, plugins, subagents, hooks and MCP servers", "Browse and install from the Claude Code and Codex marketplaces"],
    link: ["Agents & skills", "/features/#agents"],
  },
  {
    icon: <Desktop size={20} />,
    title: "Preview, Shell and Desktop",
    body: "Open the machine next to the chat. When the agent starts a dev server, the page appears in the Preview tab and updates as the agent edits.",
    checks: ["Live preview with hot reload, also on your phone", "Terminal, full remote desktop, files, changes and plan", "Live CPU, memory and disk for every machine"],
    link: ["Workspace", "/features/#workspace"],
  },
  {
    icon: <Clock size={20} />,
    title: "Automations and PR Review",
    body: "Schedule a prompt to run on its own, and see your open GitHub pull requests with an agent one click away.",
    checks: ["Cron schedules: dependency updates, failing CI, security audits, a morning digest", "Pick the agent, model and mode for each automation", "Review pull requests through the GitHub CLI on your machine"],
    link: ["Automations", "/features/#automate"],
  },
  {
    icon: <ShieldCheck size={20} />,
    title: "Self-Hosted and Private",
    body: "You run the hub. Machines connect out to it, and every agent keeps using the login already on its own machine.",
    checks: ["No inbound ports and no Overseer cloud", "Reach the hub over Tailscale, Cloudflare Tunnel or built-in HTTPS", "Checksum-verified updates with one-click rollback"],
    link: ["Security", "/security/"],
  },
];

function Home() {
  return (
    <>
      {/* Hero */}
      <section className="hero" aria-labelledby="hero-title">
        <div className="hero__copy">
          <h1 id="hero-title" className="display rise">Run coding agents<br />on all your computers.</h1>
          <p className="lead rise" style={{ animationDelay: "80ms" }}>
            Overseer is a self-hosted web app. Start Claude Code, Codex, Gemini CLI, Devin or any ACP agent on any
            machine, then approve commands, read diffs, open the shell and desktop, and watch the live preview, from
            your laptop or your phone.
          </p>
          <div className="actions rise mt-2" style={{ animationDelay: "160ms" }}>
            <a href="/download/" className="button button--primary">Get Started</a>
            <a href={REPO} target="_blank" rel="noreferrer" className="button">GitHub</a>
          </div>
        </div>
        <div className="hero__art-wrap" aria-hidden="true">
          <div className="hero__art absolute inset-0" />
          <div className="hero__glow" />
          <Morph className="morph" />
        </div>
      </section>

      {/* Showcase */}
      <section className="section-head" aria-labelledby="showcase-title">
        <h2 id="showcase-title" className="title">Chat, Preview and Sessions in One View</h2>
        <p className="lead lead--center">A Codex session builds a site on a remote machine. The live preview sits beside the chat, and the sidebar marks every session as working, waiting for approval, done or failed.</p>
      </section>
      <section className="showcase" aria-label="Overseer, full screen">
        <Reveal className="stage">
          <div className="glass">
            <div className="stage__frame">
              <Shot name="hero" eager alt="Overseer with a Codex session on the left and a live preview of the site it is building on the right" className="!rounded-none !shadow-none" />
            </div>
          </div>
        </Reveal>
      </section>

      <div className="ticks" aria-hidden="true" />

      {/* CLI */}
      <section className="section-head" aria-labelledby="cli-title">
        <h2 id="cli-title" className="title">A CLI and an MCP Server</h2>
        <p className="lead lead--center">overseer fleet lists machines, starts sessions, sends input and reads output. Add overseer mcp to Claude Code and it can launch and supervise worker agents on your other machines.</p>
      </section>
      <section className="cli-stage" aria-label="Overseer CLI">
        <div className="cli-stage__rays" />
        <Cli />
      </section>

      <div className="ticks" aria-hidden="true" />

      {/* Light band */}
      <div className="light">
        <section className="section-head" aria-labelledby="features-title">
          <h2 id="features-title" className="title">What You Can Do in Overseer</h2>
          <p className="lead lead--center">Run sessions, approve commands, manage agents and skills, use each machine's shell and desktop, and schedule recurring prompts.</p>
        </section>
        <div className="features">
          {FEATURES.map((feature) => (
            <Reveal key={feature.title} className="feature">
              <span className="feature__icon">{feature.icon}</span>
              <h3>{feature.title}</h3>
              <p>{feature.body}</p>
              <ul className="checklist">
                {feature.checks.map((check) => <li key={check}><span className="checklist__mark">[✓]</span>{check}</li>)}
              </ul>
              <a href={feature.link[1]} className="pill-link">{feature.link[0]}<ArrowUpRight size={13} /></a>
            </Reveal>
          ))}
        </div>
        <div className="section-head pb-12" style={{ paddingTop: 88 }}>
          <h2 className="title">Screenshots From the App</h2>
          <p className="lead lead--center">Skills shared across agents, an approval prompt, context and plan limits, and a machine's live stats.</p>
        </div>
        <div className="shots-row">
          <Reveal><Shot theme="light" name="skills" alt="Skills and plugins shared by Codex, Claude Code and Devin" /></Reveal>
          <Reveal delay={0.06}><Shot theme="light" name="approval" alt="A session waiting for approval before running a command" /></Reveal>
          <Reveal><Shot theme="light" name="usage" alt="Context, session tokens and plan limits in the usage popover" /></Reveal>
          <Reveal delay={0.06}><Shot theme="light" name="machine" alt="A machine's live stats and sessions" /></Reveal>
        </div>
      </div>

      {/* CTA */}
      <section className="cta" aria-labelledby="cta-title">
        <img src="/launch/logo-512.png" alt="" width={88} height={88} className="cta__icon" />
        <h2 id="cta-title" className="title">Install the Hub, Add Your Machines</h2>
        <p className="lead lead--center">Free and open source. One binary for macOS, Linux and Windows. Machines join with one pasted command.</p>
        <p className="text-sm text-ink-3">On the computer that stays on most, choose your platform:</p>
        <HeroInstall />
        <p className="text-sm text-ink-3">Then add each machine from Machines → Add machine.</p>
        <div className="actions actions--center">
          <a href="/download/" className="button button--primary">Get Started</a>
          <a href="/features/" className="button">See Every Screen<ArrowRight size={15} /></a>
        </div>
      </section>
    </>
  );
}

mount("home", <Home />);
