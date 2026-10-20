import type { ReactNode } from "react";
import {
  ArrowUp,
  Check,
  CheckCircle,
  CircleDashed,
  Desktop,
  Folder,
  GitDiff,
  GitPullRequest,
  ListChecks,
  Microphone,
  Plus,
  ShieldCheck,
  SlidersHorizontal,
  Terminal,
  XCircle,
  CaretDown,
  Plugs,
  Robot,
} from "@phosphor-icons/react";
import { Card, Stat } from "./parts";
import { DesktopView } from "./AppWindow";
import { LogoMark } from "../Logo";

/* ---------------- sessions: new session + access levels ---------------- */

const ACCESS = [
  { label: "Ask", desc: "Read-only. Plans and answers, never edits." },
  { label: "Accept edits", desc: "Edits files freely, asks before commands." },
  { label: "Auto", desc: "The agent decides when to ask." },
  { label: "Full access", desc: "No prompts. Only for trusted machines." },
];

export function SessionsVignette() {
  return (
    <div className="flex flex-col items-center px-1 pt-6 pb-2 sm:px-6 sm:pt-10">
      <div className="mb-4 flex w-full max-w-[520px] items-center justify-between">
        <span className="flex items-center gap-2 text-[19px] font-semibold tracking-[-0.02em]">
          <LogoMark size={19} /> Overseer
        </span>
        <span className="flex items-center gap-1 rounded-full bg-hover p-0.5 text-[12px]">
          <span className="rounded-full bg-page px-2.5 py-1 shadow-[var(--shadow-card)]">
            Agent
          </span>
          <span className="px-2 py-1 text-ink-3">Ask</span>
          <span className="hidden px-2 py-1 text-ink-3 sm:inline">
            Terminal
          </span>
        </span>
      </div>
      <div className="relative w-full max-w-[520px]">
        <div className="m-composer shadow-[var(--shadow-pop)]">
          <div className="pb-3 text-[14px] leading-relaxed text-ink">
            Migrate the billing service to the new invoices API and fix the type
            errors. Open a PR when the tests pass.
          </div>
          <div className="flex items-center gap-1">
            <span className="m-chip -ml-1.5">
              <Plus size={14} />
            </span>
            <span className="m-chip is-boxed">
              <SlidersHorizontal size={13} /> Studio
            </span>
            <span className="m-chip is-boxed hidden font-mono text-[11px] sm:inline-flex">
              ~/Projects/billing
            </span>
            <span className="ml-auto" />
            <span className="m-chip ring-1 ring-line-strong">
              <span className="size-1.5 rounded-full bg-[#d97757]" />
              Claude Code · Opus
              <CaretDown size={11} />
            </span>
            <span className="m-chip hidden px-1.5 sm:inline-flex">
              <Microphone size={14} />
            </span>
            <span className="m-send">
              <ArrowUp size={13} weight="bold" />
            </span>
          </div>
        </div>

        <div className="relative z-10 mt-2 ml-auto w-[min(100%,300px)] rounded-xl border border-line-strong bg-elev p-1.5 shadow-[var(--shadow-pop)] sm:-mt-1 sm:mr-6">
          <div className="px-2.5 pt-1.5 pb-1 text-[11.5px] text-ink-3">
            Access
          </div>
          {ACCESS.map((a, i) => (
            <div
              key={a.label}
              className={`flex items-start gap-2.5 rounded-lg px-2.5 py-2 ${
                i === 1 ? "bg-hover" : ""
              }`}
            >
              <ShieldCheck
                size={15}
                className={`mt-0.5 ${i === 3 ? "text-warn" : "text-ink-3"}`}
              />
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium">{a.label}</div>
                <div className="text-[12px] leading-snug text-ink-3">
                  {a.desc}
                </div>
              </div>
              {i === 1 && <Check size={14} className="mt-0.5 text-ink" />}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ---------------- workspace: desktop ---------------- */

export function WorkspaceVignette() {
  const tabs: [string, ReactNode][] = [
    ["Shell", <Terminal key="s" size={14} />],
    ["Desktop", <Desktop key="d" size={14} />],
    ["Files", <Folder key="f" size={14} />],
    ["Changes", <GitDiff key="c" size={14} />],
    ["Plan", <ListChecks key="p" size={14} />],
  ];
  return (
    <Card>
      <div className="m-ws-tabs">
        {tabs.map(([label, icon]) => (
          <span
            key={label}
            className="m-ws-tab"
            aria-selected={label === "Desktop"}
          >
            {icon}
            {label}
          </span>
        ))}
      </div>
      <div className="h-[260px] sm:h-[340px]">
        <DesktopView compact />
      </div>
    </Card>
  );
}

/* ---------------- machines ---------------- */

const MACHINES: {
  name: string;
  os: string;
  state: "online" | "busy" | "offline";
  cpu: number;
  mem: number;
  disk: number;
}[] = [
  {
    name: "MacBook Pro",
    os: "macOS · arm64",
    state: "online",
    cpu: 18,
    mem: 61,
    disk: 48,
  },
  {
    name: "Studio",
    os: "macOS · arm64",
    state: "busy",
    cpu: 72,
    mem: 54,
    disk: 31,
  },
  {
    name: "Homelab",
    os: "Linux · amd64",
    state: "busy",
    cpu: 41,
    mem: 44,
    disk: 47,
  },
  {
    name: "Workstation",
    os: "Windows · amd64",
    state: "online",
    cpu: 9,
    mem: 38,
    disk: 66,
  },
  {
    name: "Cloud VM",
    os: "Linux · arm64",
    state: "offline",
    cpu: 0,
    mem: 0,
    disk: 22,
  },
];

function Bar({ value, muted }: { value: number; muted?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <div className="m-bar w-full">
        <span
          style={{ width: `${Math.max(value, 2)}%` }}
          className={muted ? "!bg-line-strong" : ""}
        />
      </div>
      <span className="w-8 text-right text-[11.5px] text-ink-3 tabular-nums">
        {muted ? "—" : `${value}%`}
      </span>
    </div>
  );
}

export function MachinesVignette() {
  return (
    <Card>
      <div className="flex h-11 items-center gap-2 border-b border-line px-4">
        <span className="font-medium">Machines</span>
        <span className="text-ink-3">5</span>
        <span className="m-btn m-btn-dark ml-auto h-7">
          <Plus size={12} /> Add device
        </span>
      </div>
      <div className="grid grid-cols-[1fr_72px_72px] gap-x-3 border-b border-line px-4 py-2 text-[11.5px] text-ink-3 sm:grid-cols-[1fr_88px_88px_88px]">
        <span>Name</span>
        <span>CPU</span>
        <span>Memory</span>
        <span className="hidden sm:block">Disk</span>
      </div>
      {MACHINES.map((m) => (
        <div
          key={m.name}
          className="grid grid-cols-[1fr_72px_72px] items-center gap-x-3 border-b border-line px-4 py-2.5 last:border-0 sm:grid-cols-[1fr_88px_88px_88px]"
        >
          <div className="flex min-w-0 items-center gap-2.5">
            <span
              className={`m-dot ${
                m.state === "offline" ? "bg-ink-4" : "bg-ok"
              }`}
            />
            <div className="min-w-0">
              <div className="truncate text-[13px] font-medium">{m.name}</div>
              <div className="truncate text-[11.5px] text-ink-3">
                {m.state === "offline" ? "Offline · 2h ago" : m.os}
              </div>
            </div>
          </div>
          <Bar value={m.cpu} muted={m.state === "offline"} />
          <Bar value={m.mem} muted={m.state === "offline"} />
          <div className="hidden sm:block">
            <Bar value={m.disk} muted={m.state === "offline"} />
          </div>
        </div>
      ))}
      <div className="border-t border-line bg-subtle px-4 py-3">
        <div className="mb-2 text-[11.5px] text-ink-3">Setup · Homelab</div>
        <div className="flex flex-wrap gap-1.5">
          <Tool name="Claude Code" ok />
          <Tool name="Codex" ok />
          <Tool name="Tailscale" ok />
          <span className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-line-strong bg-page px-2.5 text-[12px]">
            Gemini CLI
            <span className="rounded-md bg-inverse px-1.5 py-0.5 text-[11px] text-on-inverse">
              Install
            </span>
          </span>
        </div>
      </div>
    </Card>
  );
}

function Tool({ name, ok }: { name: string; ok?: boolean }) {
  return (
    <span className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-line bg-page px-2.5 text-[12px]">
      {ok && <CheckCircle size={13} weight="fill" className="text-ok" />}
      {name}
      <span className="text-ink-3">Signed in</span>
    </span>
  );
}

/* ---------------- automations ---------------- */

const AUTOMATIONS: {
  name: string;
  when: string;
  cron: string;
  where: string;
  on: boolean;
}[] = [
  {
    name: "Weekly dependency update",
    when: "Mondays at 09:00",
    cron: "0 9 * * 1",
    where: "Homelab · Codex",
    on: true,
  },
  {
    name: "Fix failing CI",
    when: "Every hour",
    cron: "0 * * * *",
    where: "Studio · Claude Code",
    on: true,
  },
  {
    name: "Security audit",
    when: "Fridays at 17:00",
    cron: "0 17 * * 5",
    where: "Homelab · Claude Code",
    on: true,
  },
  {
    name: "Clean disk space",
    when: "Daily at 03:00",
    cron: "0 3 * * *",
    where: "Cloud VM · Codex",
    on: false,
  },
  {
    name: "Morning repo digest",
    when: "Weekdays at 08:30",
    cron: "30 8 * * 1-5",
    where: "MacBook Pro · Gemini CLI",
    on: true,
  },
];

export function AutomationsVignette() {
  return (
    <Card>
      <div className="flex h-11 items-center gap-2 border-b border-line px-4">
        <span className="font-medium">Automations</span>
        <span className="m-btn ml-auto h-7">
          <Plus size={12} /> New
        </span>
      </div>
      {AUTOMATIONS.map((a) => (
        <div
          key={a.name}
          className="flex items-center gap-3 border-b border-line px-4 py-2.5 last:border-0"
        >
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-medium">{a.name}</div>
            <div className="flex min-w-0 items-center gap-1.5 text-[11.5px] text-ink-3">
              <span className="whitespace-nowrap">{a.when}</span>
              <span className="text-ink-4">·</span>
              <span className="truncate">{a.where}</span>
            </div>
          </div>
          <code className="hidden rounded-md bg-hover px-1.5 py-0.5 text-[11px] text-ink-2 sm:block">
            {a.cron}
          </code>
          <span className={`m-switch ${a.on ? "on" : ""}`} />
        </div>
      ))}
    </Card>
  );
}

/* ---------------- MCP: agents driving agents ---------------- */

export function McpVignette() {
  return (
    <div className="space-y-3">
      <Card>
        <div className="flex h-11 items-center gap-2 border-b border-line px-4">
          <Plugs size={15} className="text-ink-2" />
          <span className="font-medium">MCP servers</span>
          <span className="ml-auto text-[12px] text-ink-3">
            Shared with every agent
          </span>
        </div>
        {[
          ["github", "stdio"],
          ["postgres", "stdio"],
          ["docs", "Streamable HTTP"],
        ].map(([name, kind]) => (
          <div
            key={name}
            className="flex items-center gap-3 border-b border-line px-4 py-2 last:border-0"
          >
            <span className="font-mono text-[12px]">{name}</span>
            <span className="text-[11.5px] text-ink-3">{kind}</span>
            <span className="m-switch on ml-auto" />
          </div>
        ))}
      </Card>
      <Card className="!bg-term !text-[#d4d4d4]">
        <div className="space-y-2 p-4 font-mono text-[11.5px] leading-relaxed">
          <div className="text-[#8a8a8a]">
            <Robot size={12} className="mr-1.5 inline -translate-y-px" />
            claude · senior agent on MacBook Pro
          </div>
          <div>
            <span className="text-[#4ade80]">●</span> overseer.create_session
            <span className="text-[#8a8a8a]"> homelab · codex · ~/api</span>
          </div>
          <div className="pl-3.5 text-[#8a8a8a]">
            ⎿ started worker “fix-tests”
          </div>
          <div>
            <span className="text-[#4ade80]">●</span> overseer.read_output
            <span className="text-[#8a8a8a]"> homelab/fix-tests</span>
          </div>
          <div className="pl-3.5 text-[#8a8a8a]">
            ⎿ test result: ok. 44 passed; 0 failed
          </div>
        </div>
      </Card>
    </div>
  );
}

/* ---------------- review ---------------- */

const PRS: {
  repo: string;
  num: number;
  title: string;
  add: number;
  del: number;
  ci: "pass" | "fail" | "pending";
}[] = [
  {
    repo: "acme/api-gateway",
    num: 142,
    title: "Fix flaky auth integration tests",
    add: 27,
    del: 13,
    ci: "pass",
  },
  {
    repo: "acme/web",
    num: 88,
    title: "Migrate billing to the invoices API",
    add: 412,
    del: 96,
    ci: "fail",
  },
  {
    repo: "acme/harness",
    num: 1,
    title: "Build Rust OpenAI harness",
    add: 1204,
    del: 0,
    ci: "pending",
  },
];

export function ReviewVignette() {
  return (
    <Card>
      <div className="flex h-11 items-center gap-1 border-b border-line px-3">
        <span className="rounded-full border border-line-strong bg-page px-3 py-1 text-[12.5px] shadow-[var(--shadow-card)]">
          Open <span className="text-ink-4">3</span>
        </span>
        <span className="px-3 py-1 text-[12.5px] text-ink-3">
          Review requested
        </span>
      </div>
      {PRS.map((p) => (
        <div
          key={p.num + p.repo}
          className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-0"
        >
          <GitPullRequest size={16} className="text-ok" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px]">
              {p.title} <span className="text-ink-3">#{p.num}</span>
            </div>
            <div className="flex items-center gap-1.5 text-[11.5px] text-ink-3">
              <span className="truncate">{p.repo}</span>
              <span className="text-ink-4">·</span>
              <span className="text-[11.5px]">
                <Stat add={p.add} del={p.del} />
              </span>
              <span className="text-ink-4">·</span>
              {p.ci === "pass" ? (
                <span className="inline-flex items-center gap-1 text-ok">
                  <CheckCircle size={12} weight="fill" /> CI
                </span>
              ) : p.ci === "fail" ? (
                <span className="inline-flex items-center gap-1 text-err">
                  <XCircle size={12} weight="fill" /> CI
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-warn">
                  <CircleDashed size={12} /> CI
                </span>
              )}
            </div>
          </div>
          <span className={`m-btn h-7 ${p.ci === "fail" ? "m-btn-dark" : ""}`}>
            {p.ci === "fail" ? "Fix CI" : "Review"}
          </span>
        </div>
      ))}
    </Card>
  );
}
