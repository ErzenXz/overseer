import { ArrowRight } from "@phosphor-icons/react";
import { mount, PageHeader } from "../components/Layout";
import { Shot } from "../components/Shot";
import { Reveal } from "../lib/reveal";

// Every screen here is a real screenshot of the app.
const GROUPS: { id: string; label: string; title: string; items: { shot: string; title: string; body: string }[] }[] = [
  {
    id: "sessions",
    label: "Sessions",
    title: "A calm transcript, not a wall of terminal output.",
    items: [
      { shot: "approval", title: "Approve what runs", body: "Risky commands wait for you: allow once, always allow, or reject, inline. Choose how much each agent may do per session, from read-only to full access." },
      { shot: "reply", title: "Replies you can read", body: "Tables, highlighted code, math and diagrams render while the reply streams. Scroll up and it keeps your place." },
      { shot: "usage", title: "Context and limits at a glance", body: "How full the context window is, what the session used, and your plan’s rolling limits. Compact when you choose to." },
    ],
  },
  {
    id: "workspace",
    label: "Workspace",
    title: "Everything about the machine, beside the chat.",
    items: [
      { shot: "hero", title: "Live preview", body: "When the agent starts a dev server, see it right there, hot reload included. Each preview gets its own private address, so it works from your phone too." },
      { shot: "shell", title: "Shell, desktop, files and changes", body: "Open the machine’s shell, its full remote desktop, its files, the session’s changes and its plan without leaving the conversation." },
    ],
  },
  {
    id: "agents",
    label: "Agents",
    title: "Every agent you have, each with its own settings.",
    items: [
      { shot: "agents", title: "Any agent, model and thinking level", body: "Claude Code, Codex, Gemini, OpenCode, Devin and 40+ ACP agents, found on each machine with their own models, thinking levels, fast mode and modes." },
      { shot: "agents-settings", title: "Found for you", body: "Install an agent on any machine and it shows up. Add your own with a name and a command." },
      { shot: "skills", title: "Skills & plugins", body: "Skills, plugins, commands, subagents, rules, hooks and MCP servers for every agent, with which agents share each one. Turn them on and off." },
      { shot: "browse", title: "Plugin marketplaces", body: "Browse Claude Code’s and Codex’s marketplaces, see what a plugin adds, and install it with a clear confirmation." },
    ],
  },
  {
    id: "fleet",
    label: "Fleet",
    title: "All your computers, one list.",
    items: [
      { shot: "machines", title: "Machines", body: "Every computer connected to your hub with live CPU, memory and disk." },
      { shot: "machine", title: "One machine", body: "Its sessions, terminals, desktop, files and agents. Install and sign in to agent CLIs in one click." },
    ],
  },
  {
    id: "automate",
    label: "Automate & review",
    title: "The chores, on a schedule.",
    items: [
      { shot: "automations", title: "Automations", body: "Run a prompt on a schedule: dependency updates, failing CI, security audits, a morning digest. Pick the model and mode for each." },
      { shot: "review", title: "Review", body: "Your open pull requests from GitHub, with an agent one click away." },
    ],
  },
  {
    id: "settings",
    label: "The details",
    title: "Small things that add up.",
    items: [
      { shot: "limits", title: "Plan limits", body: "Claude’s 5-hour and weekly windows and Codex’s, per machine, read from the CLIs without spending tokens." },
      { shot: "previews-settings", title: "Previews setup", body: "One wildcard hostname on your tunnel and every dev server on every machine has a private preview." },
      { shot: "palette", title: "Command palette", body: "⌘K to jump to any session, machine, setting or action." },
    ],
  },
];

function Features() {
  return (
    <>
      <PageHeader label="Features" title={<>Every screen, <span className="text-ink-4">as it really is.</span></>}>
        These are screenshots of the app itself, in your theme. Nothing on this page is a mockup.
      </PageHeader>
      <div className="rule" />
      <nav aria-label="Sections" className="frame flex gap-1 overflow-x-auto px-4 py-3 [scrollbar-width:none] sm:px-8">
        {GROUPS.map((group) => <a key={group.id} href={`#${group.id}`} className="nav-link shrink-0">{group.label}</a>)}
      </nav>
      {GROUPS.map((group) => (
        <div key={group.id}>
          <div className="rule" />
          <section id={group.id} className="frame scroll-mt-16" aria-labelledby={`${group.id}-title`}>
            <Reveal className="section pb-10 sm:pb-12">
              <p className="label">{group.label}</p>
              <h2 id={`${group.id}-title`} className="h-section mt-4 max-w-[22ch]">{group.title}</h2>
            </Reveal>
            <div className="cells">
              {group.items.map((item, index) => (
                <div key={item.shot} className="cells lg:grid-cols-[1fr_2fr]">
                  <Reveal className="cell">
                    <p className="font-mono text-[12px] text-ink-4">{String(index + 1).padStart(2, "0")}</p>
                    <h3 className="mt-3 text-[19px] font-semibold tracking-[-0.02em]">{item.title}</h3>
                    <p className="mt-2 text-[15px] leading-relaxed text-ink-3">{item.body}</p>
                  </Reveal>
                  <div className="field p-4 sm:p-8"><Reveal delay={0.05}><Shot name={item.shot} alt={`${item.title}: ${item.body}`} /></Reveal></div>
                </div>
              ))}
            </div>
          </section>
        </div>
      ))}
      <div className="rule" />
      <section className="frame">
        <div className="section flex flex-wrap items-center justify-between gap-6 py-12">
          <h2 className="h-feature">Ready when you are.</h2>
          <a href="/download/" className="btn btn-dark">Download Overseer<ArrowRight size={15} /></a>
        </div>
      </section>
    </>
  );
}

mount("features", <Features />);
