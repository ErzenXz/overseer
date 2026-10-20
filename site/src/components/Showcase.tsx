import { useState } from "react";
import { Reveal } from "../lib/reveal";

// Real screenshots of the app (the demo build, dark theme), not recreations.
const SHOTS = [
  {
    id: "preview",
    label: "Live preview",
    title: "Watch what your agent builds",
    body: "The agent starts a dev server on Studio; the site appears beside the chat, hot reload included, from any device.",
    src: "/shots/session-preview.webp",
  },
  {
    id: "skills",
    label: "Skills & plugins",
    title: "One skill, every agent",
    body: "Skills, plugins, commands, hooks and MCP servers for Claude Code, Codex and Devin on each machine, with who shares what.",
    src: "/shots/skills.webp",
  },
  {
    id: "agents",
    label: "Any agent",
    title: "Every agent on the machine, found for you",
    body: "Claude Code, Codex, Gemini, OpenCode, Devin and 40+ ACP agents, each with its own models, thinking levels and modes.",
    src: "/shots/agents.webp",
  },
  {
    id: "limits",
    label: "Plan limits",
    title: "Your real limits, before you hit them",
    body: "Claude’s 5-hour and weekly windows and Codex’s, per machine, straight from the CLIs. No tokens spent to check.",
    src: "/shots/limits.webp",
  },
  {
    id: "reply",
    label: "Rich replies",
    title: "Answers you can read",
    body: "Tables, highlighted code, math and diagrams render as the reply streams, and scrolling up keeps your place.",
    src: "/shots/reply.webp",
  },
  {
    id: "machines",
    label: "Machines",
    title: "Your whole fleet, live",
    body: "CPU, memory and disk for every computer, with its terminals, desktop and files a click away.",
    src: "/shots/machines.webp",
  },
];

export function Showcase() {
  const [active, setActive] = useState(0);
  const shot = SHOTS[active];
  return (
    <section id="app" aria-labelledby="app-title" className="py-24 sm:py-32">
      <div className="container-page">
        <Reveal className="max-w-[760px]">
          <p className="eyebrow">The real app</p>
          <h2 id="app-title" className="h-section mt-4">
            Not a mockup. This is Overseer.
          </h2>
          <p className="lede mt-5 max-w-[60ch]">
            Screenshots straight from the app, the same build you install.
          </p>
        </Reveal>

        <Reveal delay={0.06} className="mt-14 grid gap-8 lg:grid-cols-[280px_1fr] lg:gap-12">
          <div role="tablist" aria-label="Screens" className="showcase-tabs">
            {SHOTS.map((item, index) => (
              <button
                key={item.id}
                role="tab"
                id={`shot-tab-${item.id}`}
                aria-selected={index === active}
                aria-controls="shot-panel"
                onClick={() => setActive(index)}
                className="showcase-tab"
              >
                <span className="showcase-tab-index">{String(index + 1).padStart(2, "0")}</span>
                <span className="min-w-0">
                  <span className="block text-[15px] font-medium text-ink">{item.label}</span>
                  {index === active && <span className="mt-1 block text-[13.5px] leading-relaxed text-ink-3">{item.body}</span>}
                </span>
              </button>
            ))}
          </div>

          <figure id="shot-panel" role="tabpanel" aria-labelledby={`shot-tab-${shot.id}`} className="stage-panel showcase-stage">
            <div className="showcase-window">
              <div className="showcase-chrome" aria-hidden="true">
                <span /><span /><span />
                <span className="showcase-url">hub.your-tailnet.ts.net</span>
              </div>
              <div className="showcase-shot">
                {SHOTS.map((item, index) => (
                  <img
                    key={item.id}
                    src={item.src}
                    alt={`${item.title}: ${item.body}`}
                    width={2000}
                    height={1250}
                    loading={index === 0 ? "eager" : "lazy"}
                    decoding="async"
                    className={index === active ? "is-active" : ""}
                    aria-hidden={index !== active}
                  />
                ))}
              </div>
            </div>
            <figcaption className="mt-4 px-1 text-[14px] text-ink-3">
              <span className="font-medium text-ink">{shot.title}.</span> {shot.body}
            </figcaption>
          </figure>
        </Reveal>
      </div>
    </section>
  );
}
