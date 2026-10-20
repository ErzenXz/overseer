import { useState, type ReactNode } from "react";
import { ArrowRight, ArrowUpRight, Bell, Robot, ShieldCheck, Stack } from "@phosphor-icons/react";
import { mount } from "../components/Layout";
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
    title: "Sessions That Keep Running",
    body: "Agents run on the machine, not in your browser. Close the tab, open it on your phone, and every session is where you left it.",
    checks: ["Claude Code, Codex, Gemini, Devin and any ACP agent", "Fork, undo, steer or queue a follow-up", "Pin, folder and archive in the sidebar"],
    link: ["Sessions", "/features/#sessions"],
  },
  {
    icon: <Bell size={20} />,
    title: "Know Which Ones Need You",
    body: "Every session is working, waiting, done or failed. The ones waiting on you stand out, and you answer them right in the thread.",
    checks: ["Approve risky commands inline", "Notifications when an agent finishes", "Plan limits before you hit them"],
    link: ["Approvals & usage", "/features/#sessions"],
  },
  {
    icon: <Robot size={20} />,
    title: "Every Agent, Found for You",
    body: "Install an agent on any machine and it shows up, with its own models, thinking levels and modes. Skills and plugins for all of them in one place.",
    checks: ["40+ agents from the ACP registry", "One skill, shared across agents", "Plugin marketplaces with clear consent"],
    link: ["Agents & skills", "/features/#agents"],
  },
  {
    icon: <ShieldCheck size={20} />,
    title: "Your Machines, Your Keys",
    body: "Machines dial out to a hub you run. No inbound ports, no Overseer cloud, and every agent uses the login already on its machine.",
    checks: ["Live previews of dev servers, kept private", "Remote shell and desktop, never exposed", "Verified updates with one-click rollback"],
    link: ["Security", "/security/"],
  },
];

function Home() {
  return (
    <>
      {/* Hero */}
      <section className="hero" aria-labelledby="hero-title">
        <div className="hero__copy">
          <h1 id="hero-title" className="display rise">Every coding agent.<br />Every machine.</h1>
          <p className="lead rise" style={{ animationDelay: "80ms" }}>
            Overseer is a control room for your coding agents. Run Claude Code, Codex, Gemini and Devin on all your
            computers, and see which ones are working, which need you, and which are done, from one tab.
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
        <h2 id="showcase-title" className="title">Every Agent, One Tab</h2>
        <p className="lead lead--center">A Codex session builds a site on your studio machine, and the preview shows up beside the chat. The sidebar tells you which session needs you.</p>
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
        <h2 id="cli-title" className="title">Drive It From the Shell</h2>
        <p className="lead lead--center">List machines, start sessions, type into them and read their output, from your shell or from an agent over MCP.</p>
      </section>
      <section className="cli-stage" aria-label="Overseer CLI">
        <div className="cli-stage__rays" />
        <Cli />
      </section>

      <div className="ticks" aria-hidden="true" />

      {/* Light band */}
      <div className="light">
        <section className="section-head" aria-labelledby="features-title">
          <h2 id="features-title" className="title">Built for Many Agents at Once</h2>
          <p className="lead lead--center">One tab for every task in flight, on every machine, and a clear answer to the question that matters: who needs you right now?</p>
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
          <h2 className="title">The Real Thing</h2>
          <p className="lead lead--center">Screenshots straight from the app.</p>
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
        <h2 id="cta-title" className="title">Bring Your Agents</h2>
        <p className="lead lead--center">Install the hub, add your machines, and stop losing track of what your agents are doing.</p>
        <div className="cta__code"><span className="t-dim"># on the computer that stays on most</span>{"\n"}<span className="t-accent">$</span> curl -fsSL https://overseer.sh/install.sh | sh{"\n"}<span className="t-dim"># then add each machine from Machines → Add machine</span></div>
        <div className="actions actions--center">
          <a href="/download/" className="button button--primary">Get Started</a>
          <a href="/features/" className="button">See Every Screen<ArrowRight size={15} /></a>
        </div>
      </section>
    </>
  );
}

mount("home", <Home />);
