import { ArrowRight, GithubLogo, Plus } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { AgentMark } from "../components/AgentMark";
import { FleetField } from "../components/FleetField";
import { HeroInstall } from "../components/InstallCommand";
import { mount } from "../components/Layout";
import { Art, Shot } from "../components/Shot";
import { REPO } from "../lib/site";
import { Reveal } from "../lib/reveal";

const AGENTS = [
  { id: "claude", name: "Claude Code", note: "Anthropic" },
  { id: "codex", name: "Codex", note: "OpenAI" },
  { id: "gemini", name: "Gemini CLI", note: "Google" },
  { id: "devin", name: "Devin", note: "Cognition" },
  { id: "opencode", name: "OpenCode", note: "SST" },
  { id: "copilot", name: "Copilot CLI", note: "GitHub" },
  { id: "cursor", name: "Cursor Agent", note: "Cursor" },
  { id: "acp", name: "40+ more", note: "Any ACP agent" },
];

function Feature({ index, label, title, children, shot, alt, flip = false }: { index: string; label: string; title: string; children: ReactNode; shot: string; alt: string; flip?: boolean }) {
  return (
    <section aria-label={label} className="frame">
      <div className={`cells ${flip ? "lg:grid-cols-[7fr_5fr]" : "lg:grid-cols-[5fr_7fr]"}`}>
        <Reveal className={`cell flex flex-col justify-center ${flip ? "lg:order-2" : ""}`}>
          <p className="label"><span className="label-index">{index}</span>{label}</p>
          <h3 className="h-feature mt-4">{title}</h3>
          <div className="mt-4 space-y-3 text-[15.5px] leading-relaxed text-ink-3">{children}</div>
        </Reveal>
        <div className={`field p-4 sm:p-8 ${flip ? "lg:order-1" : ""}`}>
          <Reveal delay={0.06}><Shot name={shot} alt={alt} crop /></Reveal>
        </div>
      </div>
    </section>
  );
}

function Small({ title, body, shot, alt }: { title: string; body: string; shot: string; alt: string }) {
  return (
    <Reveal className="flex flex-col">
      <div className="field p-4 sm:p-5"><Shot name={shot} alt={alt} crop /></div>
      <div className="cell pt-6">
        <h3 className="text-[17px] font-semibold tracking-[-0.02em]">{title}</h3>
        <p className="mt-1.5 text-[14.5px] leading-relaxed text-ink-3">{body}</p>
      </div>
    </Reveal>
  );
}

const FAQ: { q: string; a: string }[] = [
  { q: "What is Overseer?", a: "A self-hosted control room for coding agents. You run one hub, join your other computers to it, and then start, watch and steer agent sessions, shells and desktops on any of them from a browser." },
  { q: "Does my code or my API key go through your servers?", a: "No. There are no Overseer servers. The hub runs on your machine, and each agent uses the CLI login already on the computer it runs on. Overseer never stores provider tokens." },
  { q: "Which agents does it support?", a: "Claude Code and Codex through their own protocols, and Gemini CLI, Devin, OpenCode, Copilot CLI, Cursor Agent, Goose and every other agent in the ACP registry. Install one on a machine and Overseer finds it." },
  { q: "Do I need to open ports or set up SSH?", a: "No. Each machine opens one outbound connection to the hub, so it works behind NAT and firewalls. To reach the hub from outside, use Tailscale, Cloudflare Tunnel or the built-in HTTPS." },
  { q: "What happens when I close the browser?", a: "Sessions keep running on the machine. Open the hub again, from any device, and you're back where you left off." },
  { q: "How does it update?", a: "The hub and every machine update themselves to each stable release, verified by checksum, with one-click rollback." },
  { q: "What does it cost?", a: "Nothing. Overseer is free and open source under the MIT license. Your agents use the subscriptions or API keys you already have." },
];

function Home() {
  return (
    <>
      {/* Hero */}
      <section className="frame" aria-labelledby="hero-title">
        <div className="section flex flex-col items-center pt-16 pb-14 text-center sm:pt-24 sm:pb-16">
          <a href="/changelog/" className="pill rise">
            <span className="pill-tag">v0.4.0</span>
            Skills &amp; plugins for every agent
            <ArrowRight size={13} className="text-ink-4" />
          </a>
          <h1 id="hero-title" className="h-display rise mt-8 text-[44px] sm:text-[72px] lg:text-[84px]" style={{ animationDelay: "60ms" }}>
            <span className="block">Every coding agent.</span>
            <span className="block text-ink-4">Every machine. One tab.</span>
          </h1>
          <p className="lede rise mt-7 max-w-[56ch] sm:text-[19px]" style={{ animationDelay: "120ms" }}>
            Run Claude Code, Codex, Gemini, Devin and any ACP agent on your laptop, homelab and cloud boxes, then
            watch, steer and review them all from one browser tab. At your desk or on your phone.
          </p>
          <div className="rise mt-10 flex w-full flex-col items-center" style={{ animationDelay: "180ms" }}>
            <HeroInstall />
            <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5">
              <a href="/download/" className="btn btn-dark">Download<ArrowRight size={15} /></a>
              <a href={REPO} target="_blank" rel="noreferrer" className="btn btn-outline"><GithubLogo size={16} />Star on GitHub</a>
            </div>
            <p className="mt-6 font-mono text-[12px] text-ink-4">Free &amp; open source · macOS, Linux, Windows · No inbound ports</p>
          </div>
        </div>
      </section>

      {/* The whole app, full screen */}
      <div className="rule" />
      <section className="frame field" aria-label="Overseer, full screen">
        <div className="rise px-3 py-6 sm:px-10 sm:py-12" style={{ animationDelay: "240ms" }}>
          <div className="corners">
            <span className="corner corner-tl" /><span className="corner corner-tr" /><span className="corner corner-bl" /><span className="corner corner-br" />
            <Shot name="hero" eager alt="Overseer with a Codex session on the left and a live preview of the school website it is building on the right" />
          </div>
          <p className="mt-5 text-center font-mono text-[12px] text-ink-4">A real session: Codex starts a dev server on Studio, and the site shows up live beside the chat.</p>
        </div>
      </section>

      {/* Agents */}
      <div className="rule" />
      <section className="frame" aria-labelledby="agents-title">
        <div className="cells lg:grid-cols-[1fr_2fr]">
          <div className="cell flex flex-col justify-center">
            <p className="label">Agents</p>
            <h2 id="agents-title" className="h-feature mt-4">Works with the agents you already pay for.</h2>
            <p className="mt-3 text-[15px] leading-relaxed text-ink-3">Each one uses the login already on that machine. Nothing goes through a third party.</p>
          </div>
          <div className="cells grid-cols-2 sm:grid-cols-4">
            {AGENTS.map((agent) => (
              <div key={agent.id} className="flex flex-col gap-3 p-6">
                <span className="text-ink">{agent.id === "acp" ? <Plus size={22} /> : <AgentMark agent={agent.id} size={22} />}</span>
                <span>
                  <span className="block text-[14.5px] font-medium">{agent.name}</span>
                  <span className="block text-[12.5px] text-ink-3">{agent.note}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <div className="rule" />
      <section className="frame" aria-labelledby="features-title">
        <Reveal className="section pb-12 sm:pb-14">
          <p className="label">How you work with it</p>
          <h2 id="features-title" className="h-section mt-4 max-w-[20ch]">A control room for agents, not another chat window.</h2>
        </Reveal>
      </section>
      <div className="rule" />
      <Feature index="01" label="Sessions" title="Talk to any agent, on any machine, in any folder." shot="approval" alt="A Claude Code session asking for approval before running go test">
        <p>Pick the machine, the folder and the agent, then type what you want. Steps fold into “Worked for 46s”, edits show as diffs, and risky commands wait for your answer.</p>
        <p>Allow once, always allow, or reject, right in the thread. Fork from any message, undo a turn, or steer it while it works.</p>
      </Feature>
      <div className="rule" />
      <Feature flip index="02" label="Workspace" title="The machine is right next to the conversation." shot="shell" alt="A session with the machine's shell open in a side panel">
        <p>Every session has a panel with the machine’s shell, a live preview of the dev server it starts, its remote desktop, its files, its changes and its plan.</p>
        <p>The preview gets its own private address, so you can open what your agent builds from your phone.</p>
      </Feature>
      <div className="rule" />
      <Feature index="03" label="Skills & plugins" title="One skill, every agent." shot="skills" alt="The Skills and plugins page listing skills shared by Codex, Claude Code and Devin">
        <p>See the skills, plugins, commands, subagents, rules, hooks and MCP servers of every agent on every machine, and turn them on or off.</p>
        <p>Write a skill once and share it with Claude Code, Codex and Devin. Install plugins from their marketplaces, with a clear warning before anything runs code.</p>
      </Feature>
      <div className="rule" />
      <Feature flip index="04" label="Usage" title="Know your limits before you hit them." shot="usage" alt="The usage popover showing context, session tokens and Codex plan limits">
        <p>The ring next to the send button shows how full the context window is, what the session has used, and your plan’s 5-hour and weekly limits for that agent.</p>
        <p>Straight from the CLIs on your machines. No tokens are spent to check.</p>
      </Feature>
      <div className="rule" />
      <Feature index="05" label="Fleet" title="Your whole fleet, live." shot="machine" alt="A machine's overview with CPU, memory, disk and its sessions">
        <p>CPU, memory and disk for every computer, its sessions, terminals, desktop and files. Install and sign in to agents on any of them in one click.</p>
      </Feature>

      {/* More, all real */}
      <div className="rule" />
      <section className="frame" aria-labelledby="more-title">
        <Reveal className="section pb-12">
          <p className="label">And more</p>
          <h2 id="more-title" className="h-section mt-4 max-w-[22ch]">Everything else you’d expect, done properly.</h2>
        </Reveal>
        <div className="cells sm:grid-cols-2 lg:grid-cols-3">
          <Small title="Any agent, any model" body="Each agent’s own models, thinking levels, fast mode and modes, found on the machine." shot="agents" alt="The agent picker with Claude Code, Codex, Gemini CLI, OpenCode and Devin" />
          <Small title="Automations" body="Run a prompt on a schedule, with the model and mode you choose." shot="automations" alt="The automations page with scheduled runs" />
          <Small title="Review" body="Your open pull requests, ready for an agent to fix." shot="review" alt="The review page listing pull requests" />
          <Small title="Plan limits" body="Every subscription’s windows, per machine, in one place." shot="limits" alt="Usage and limits settings with Claude Code and Codex plan limits" />
          <Small title="Rich replies" body="Tables, code, math and diagrams render as the reply streams." shot="reply" alt="A reply with a formatted table and code block" />
          <Small title="Everything from the keyboard" body="⌘K to jump to any session, machine or setting." shot="palette" alt="The command palette" />
        </div>
      </section>

      {/* Phone */}
      <div className="rule" />
      <section className="frame" aria-labelledby="phone-title">
        <div className="cells lg:grid-cols-2">
          <Reveal className="cell flex flex-col justify-center">
            <p className="label">On your phone</p>
            <h2 id="phone-title" className="h-feature mt-4">Approve, steer and review from anywhere.</h2>
            <p className="mt-4 text-[15.5px] leading-relaxed text-ink-3">The same app on a phone browser. Get a notification when an agent needs you, answer it, and get back to your day.</p>
          </Reveal>
          <div className="field flex justify-center gap-4 px-4 py-10 sm:gap-6 sm:py-14">
            <Reveal className="w-[44%] max-w-[230px]"><Shot name="phone-session" alt="A session on a phone, waiting for approval" /></Reveal>
            <Reveal delay={0.08} className="mt-10 w-[44%] max-w-[230px]"><Shot name="phone-home" alt="Starting a new session on a phone" /></Reveal>
          </div>
        </div>
      </section>

      {/* How it works */}
      <div className="rule" />
      <section className="frame" aria-labelledby="how-title">
        <div className="cells lg:grid-cols-[1fr_1.2fr]">
          <div className="flex flex-col">
            <Reveal className="cell">
              <p className="label">How it works</p>
              <h2 id="how-title" className="h-feature mt-4">One hub. Every machine dials in.</h2>
            </Reveal>
            <div className="cells flex-1">
              {[
                ["1", "Install the hub", "One command on the computer that stays on most. Open the link it prints, choose a password."],
                ["2", "Add your machines", "Paste one command on each other computer. They connect out to the hub: no ports, no SSH keys."],
                ["3", "Start a session", "Pick a machine, a folder and an agent, and say what you want."],
              ].map(([n, title, body]) => (
                <div key={n} className="flex gap-4 p-6 sm:px-9">
                  <span className="font-mono text-[12px] text-ink-4">0{n}</span>
                  <span><span className="block text-[15px] font-medium">{title}</span><span className="mt-1 block text-[14px] leading-relaxed text-ink-3">{body}</span></span>
                </div>
              ))}
            </div>
          </div>
          <div className="relative min-h-[380px] overflow-hidden bg-page-2" aria-hidden="true">
            <FleetField className="absolute inset-0 h-full w-full" centerY={0.5} />
            <p className="absolute bottom-4 left-5 font-mono text-[11.5px] text-ink-4">Live: machines on their orbits, agent work streaming to the hub</p>
          </div>
        </div>
      </section>

      {/* Trust */}
      <div className="rule" />
      <section className="frame" aria-labelledby="trust-title">
        <div className="cells sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["No inbound ports", "Machines open one outbound connection to your hub. Nothing on them listens to the internet."],
            ["Your logins stay put", "Agents use the CLI logins on each machine. Overseer never sees or stores provider tokens."],
            ["You approve what runs", "Choose how much each agent may do, from read-only to full access, per session."],
            ["Open source", "MIT licensed, one binary, verified updates with rollback. Read every line."],
          ].map(([title, body], i) => (
            <Reveal key={title} delay={i * 0.04} className="cell">
              <h3 id={i === 0 ? "trust-title" : undefined} className="text-[15.5px] font-semibold">{title}</h3>
              <p className="mt-2 text-[14px] leading-relaxed text-ink-3">{body}</p>
            </Reveal>
          ))}
        </div>
        <div className="border-t border-line px-6 py-4 sm:px-9"><a href="/security/" className="inline-flex items-center gap-1.5 text-[14px] text-ink-2 hover:text-ink">How Overseer keeps your machines safe <ArrowRight size={14} /></a></div>
      </section>

      {/* FAQ */}
      <div className="rule" />
      <section className="frame" aria-labelledby="faq-title">
        <div className="cells lg:grid-cols-[1fr_2fr]">
          <div className="cell"><p className="label">FAQ</p><h2 id="faq-title" className="h-feature mt-4">Questions, answered.</h2></div>
          <div className="cells">
            {FAQ.map((item) => (
              <details key={item.q} className="faq px-6 py-5 sm:px-9">
                <summary className="flex items-center justify-between gap-4 text-[15.5px] font-medium">{item.q}<Plus size={16} className="faq-plus shrink-0 text-ink-3" /></summary>
                <p className="mt-3 max-w-[68ch] text-[14.5px] leading-relaxed text-ink-3">{item.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* Closing */}
      <div className="rule" />
      <section className="frame" aria-labelledby="cta-title">
        <div className="cells lg:grid-cols-2">
          <div className="cell flex flex-col justify-center py-16">
            <h2 id="cta-title" className="h-section max-w-[16ch]">Put every agent you have to work.</h2>
            <p className="lede mt-5 max-w-[44ch]">One hub, one command per machine, one tab for all of it.</p>
            <div className="mt-8 flex flex-wrap gap-2.5">
              <a href="/download/" className="btn btn-dark">Download Overseer<ArrowRight size={15} /></a>
              <a href={REPO} target="_blank" rel="noreferrer" className="btn btn-outline"><GithubLogo size={16} />GitHub</a>
            </div>
          </div>
          <div className="relative min-h-[320px] overflow-hidden"><Art name="orbit" className="absolute inset-0" /></div>
        </div>
      </section>
    </>
  );
}

mount("home", <Home />);
