import type { ReactNode } from "react";
import { Check } from "@phosphor-icons/react";
import { Reveal } from "../lib/reveal";
import { Vignette } from "./mock/parts";
import {
  AutomationsVignette,
  MachinesVignette,
  McpVignette,
  ReviewVignette,
  SessionsVignette,
  WorkspaceVignette,
} from "./mock/Vignettes";

function Points({ items }: { items: ReactNode[] }) {
  return (
    <ul className="mt-7 space-y-3">
      {items.map((item, i) => (
        <li
          key={i}
          className="flex gap-3 text-[15px] leading-relaxed text-ink-2"
        >
          <Check
            size={16}
            weight="bold"
            className="mt-[5px] text-ink-3"
            aria-hidden="true"
          />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function Row({
  id,
  eyebrow,
  title,
  body,
  points,
  vignette,
  label,
  flip,
}: {
  id: string;
  eyebrow: string;
  title: string;
  body: ReactNode;
  points: ReactNode[];
  vignette: ReactNode;
  label: string;
  flip?: boolean;
}) {
  return (
    <div
      aria-labelledby={`${id}-title`}
      role="group"
      className="grid grid-cols-1 items-center gap-10 lg:grid-cols-12 lg:gap-16"
    >
      <Reveal className={`lg:col-span-5 ${flip ? "lg:order-2" : ""}`}>
        <p className="eyebrow">{eyebrow}</p>
        <h3 id={`${id}-title`} className="h-feature mt-4">
          {title}
        </h3>
        <p className="lede mt-4 text-[16px]">{body}</p>
        <Points items={points} />
      </Reveal>
      <Reveal
        delay={0.08}
        className={`lg:col-span-7 ${flip ? "lg:order-1" : ""}`}
      >
        <Vignette label={label}>{vignette}</Vignette>
      </Reveal>
    </div>
  );
}

function Tile({
  id,
  eyebrow,
  title,
  body,
  vignette,
  label,
  delay = 0,
}: {
  id: string;
  eyebrow: string;
  title: string;
  body: ReactNode;
  vignette: ReactNode;
  label: string;
  delay?: number;
}) {
  return (
    <Reveal delay={delay} className="flex flex-col">
      <article aria-labelledby={`${id}-title`} className="flex h-full flex-col">
        <Vignette
          label={label}
          className="flex flex-col justify-center md:min-h-[440px]"
        >
          {vignette}
        </Vignette>
        <div className="mt-6 pr-4">
          <p className="eyebrow">{eyebrow}</p>
          <h3
            id={`${id}-title`}
            className="mt-3 text-[21px] font-semibold tracking-[-0.025em]"
          >
            {title}
          </h3>
          <p className="mt-2 text-[15px] leading-relaxed text-ink-3">{body}</p>
        </div>
      </article>
    </Reveal>
  );
}

export function Features() {
  return (
    <section
      id="features"
      aria-labelledby="features-title"
      className="py-24 sm:py-32"
    >
      <div className="container-page">
        <Reveal className="max-w-[760px]">
          <h2 id="features-title" className="h-section">
            A control room for agents, not another chat window.
          </h2>
          <p className="lede mt-5 max-w-[60ch]">
            Start work anywhere, watch it happen, step in when it matters. Every
            session runs on a real machine you own, in a real folder, with the
            tools and logins that are already there.
          </p>
        </Reveal>

        <div className="mt-20 space-y-28 sm:mt-24 sm:space-y-36">
          <Row
            id="f-sessions"
            eyebrow="Agent sessions"
            title="Chat with any agent, on any machine, in any folder."
            body="Pick the machine, the folder and the agent, then type what you want. You get a calm transcript, not a wall of terminal output."
            points={[
              <>
                Steps fold into{" "}
                <strong className="font-medium text-ink">
                  “Worked for 3m 56s”
                </strong>
                . File edits show as diffs.
              </>,
              "Risky commands wait for you. Allow once, always allow, or reject, right in the thread.",
              "Four access levels, from read-only Ask to Full access, and a model picker per agent.",
              "Claude Code and Codex run over their native protocols (stream-json, codex app-server). Everything else speaks ACP.",
            ]}
            label="Starting a new session: a prompt, the machine and folder, Claude Code with the Opus model, and the access menu showing Ask, Accept edits, Auto and Full access."
            vignette={<SessionsVignette />}
          />

          <Row
            id="f-workspace"
            flip
            eyebrow="Workspace"
            title="The whole machine, right beside the conversation."
            body="Every session has a workspace panel: the machine's shell, its screen, its files, the agent's changes and its plan."
            points={[
              "A live shell in tmux. Close the browser, open your phone, it's still there.",
              "The machine's remote desktop, tunnelled through the agent connection. VNC is never exposed to the network.",
              "Works with macOS Screen Sharing, x11vnc or wayvnc on Linux, and TightVNC on Windows.",
            ]}
            label="The workspace panel showing a remote desktop of the Homelab machine, connected through the agent tunnel."
            vignette={<WorkspaceVignette />}
          />
        </div>

        <div className="mt-28 grid grid-cols-1 gap-x-8 gap-y-20 sm:mt-36 md:grid-cols-2">
          <Tile
            id="f-machines"
            eyebrow="Machines"
            title="Your whole fleet, live."
            body="CPU, memory and disk for every machine, plus terminals and a file browser. Install and sign in to agent CLIs on any machine with one click."
            label="The machines list with live CPU, memory and disk, and a setup strip showing Claude Code, Codex and Tailscale signed in and Gemini CLI ready to install."
            vignette={<MachinesVignette />}
          />
          <Tile
            id="f-automations"
            delay={0.06}
            eyebrow="Automations"
            title="Agents on a schedule."
            body="Cron-scheduled runs for the chores nobody wants: dependency updates, failing CI, security audits, disk cleanup, a morning digest of your repos."
            label="A list of automations with schedules, machines and agents."
            vignette={<AutomationsVignette />}
          />
          <Tile
            id="f-mcp"
            eyebrow="MCP everywhere"
            title="Configure once. Agents drive agents."
            body="Add MCP servers once and every agent on every machine gets them. Overseer is itself an MCP server, so a senior agent can launch workers and read their output. The remote endpoint works from Claude, ChatGPT and Cursor."
            label="Shared MCP servers, and a senior Claude agent using Overseer's MCP tools to start a Codex worker on Homelab and read its test results."
            vignette={<McpVignette />}
          />
          <Tile
            id="f-review"
            delay={0.06}
            eyebrow="Review"
            title="Every open PR, one click from a fix."
            body="Your open pull requests, read through the GitHub CLI on your own machine, with diff size and CI status. Have an agent review one, or fix the failing checks."
            label="Open pull requests with diff sizes and CI status, with Review and Fix CI buttons."
            vignette={<ReviewVignette />}
          />
        </div>
      </div>
    </section>
  );
}
