import { useState, type ReactNode } from "react";
import {
  ArrowUp,
  Bell,
  BookOpen,
  CaretRight,
  ClockCounterClockwise,
  DotsThree,
  File,
  FileText,
  Folder,
  GitDiff,
  GitMerge,
  GitPullRequest,
  ListChecks,
  MagnifyingGlass,
  Microphone,
  Monitor,
  PencilSimple,
  Plus,
  Question,
  ShieldCheck,
  SidebarSimple,
  SlidersHorizontal,
  SquaresFour,
  Terminal,
  GearSix,
  Desktop,
  List,
  Lock,
  ArrowsOutSimple,
} from "@phosphor-icons/react";
import { useStages, useStream } from "../../lib/motion";
import { Chrome, Diff, Stat } from "./parts";
import { AUTH_DIFF } from "./data";

/*
  A faithful HTML recreation of the Overseer web app: sidebar, a live agent
  session, and the workspace panel. It plays one short sequence on load
  (a test step finishes, the steps fold, the reply streams, an approval
  appears) and then holds. Reduced-motion readers get the final frame.
*/

const REPLY =
  "The flake is two `time.Sleep` calls racing the session TTL on slow CI runners. I injected a fake clock into the store, so expiry is now deterministic, and updated both tests. To be sure it's gone, I'd like to run the auth suite 50 times with the race detector.";
const REPLY_WORDS = REPLY.split(" ");

type WsTab = "shell" | "desktop" | "files" | "changes" | "plan";

export function AppWindow() {
  // 1: tests pass  2: steps fold  3: reply streams
  const { stage } = useStages([1900, 2700, 3100]);
  const words = useStream(REPLY_WORDS.length, stage >= 3, 32);
  const replied = words >= REPLY_WORDS.length;
  const [tab, setTab] = useState<WsTab>("shell");

  return (
    <figure className="m-window">
      <figcaption className="sr-only">
        The Overseer web app: a sidebar of agent sessions across machines, a
        Claude Code session on a machine called Homelab that has fixed a flaky
        test and is asking for approval to run a command, and a workspace panel
        with the machine's shell, desktop, files, changes and plan.
      </figcaption>
      <Chrome url="hub.your-tailnet.ts.net" />
      <div className="flex h-[620px] sm:h-[600px] lg:h-[624px]">
        <Sidebar stage={stage} replied={replied} />
        <Thread stage={stage} words={words} replied={replied} />
        <Workspace tab={tab} setTab={setTab} />
      </div>
    </figure>
  );
}

/* ---------------- sidebar ---------------- */

function Sidebar({ stage, replied }: { stage: number; replied: boolean }) {
  const waiting = replied;
  return (
    <div className="m-sidebar hidden lg:flex" aria-hidden="true">
      <div className="m-sb-head">
        <img src="/favicon.svg" width={18} height={18} alt="" className="rounded-[4px]" />
        <span className="ml-1.5 font-medium">Overseer</span>
        <span className="ml-auto flex">
          <span className="m-icon-btn">
            <MagnifyingGlass size={15} />
          </span>
          <span className="m-icon-btn">
            <Bell size={15} />
          </span>
          <span className="m-icon-btn">
            <SidebarSimple size={15} />
          </span>
        </span>
      </div>
      <div className="m-nav">
        <NavItem icon={<Plus size={15} />} primary>
          New session
        </NavItem>
        <NavItem icon={<ClockCounterClockwise size={15} />}>
          Automations
        </NavItem>
        <NavItem icon={<Monitor size={15} />}>Machines</NavItem>
        <NavItem icon={<GitPullRequest size={15} />}>Review</NavItem>
        <NavItem icon={<BookOpen size={15} />}>Projects</NavItem>
        <NavItem icon={<SquaresFour size={15} />}>Customize</NavItem>
      </div>
      <div className="m-sessions-head">
        Sessions
        <span className="ml-auto flex text-ink-3">
          <span className="m-icon-btn">
            <Plus size={14} />
          </span>
          <span className="m-icon-btn">
            <SlidersHorizontal size={14} />
          </span>
        </span>
      </div>
      <div className="m-sessions-sub">
        <ClockCounterClockwise size={14} /> Recent
      </div>
      <div className="flex flex-col gap-px pb-3">
        <Row
          active
          title="Fix flaky auth integration tests"
          lead={
            waiting ? (
              <span className="m-dot bg-[var(--amber-dot)]" />
            ) : (
              <span className="m-dot bg-ink-3 pulse-dot" />
            )
          }
          meta={[
            waiting ? (
              <span key="s" className="text-warn">
                Needs approval
              </span>
            ) : (
              <span key="s" className={stage < 2 ? "shimmer" : "text-ink-2"}>
                Working
              </span>
            ),
            "Homelab",
          ]}
        />
        <Row
          unread
          title="Build Rust OpenAI harness"
          meta={[
            <span key="s" className="text-ok">
              PR is ready
            </span>,
            "Studio",
            <span key="p" className="inline-flex items-center gap-0.5 text-pr">
              <GitPullRequest size={13} />1
            </span>,
          ]}
        />
        <Row
          title="Improve dashboard UI and features"
          meta={["5h", "MacBook Pro", "Claude Code"]}
        />
        <Row
          title="Weekly dependency update"
          meta={[
            "9d",
            "Homelab",
            <span key="p" className="inline-flex items-center gap-0.5 text-pr">
              <GitMerge size={13} />
              88
            </span>,
          ]}
        />
        <Row
          title="Update archive homepage design"
          meta={["6d", "Studio", "Gemini CLI"]}
        />
        <Row
          title="Investigate memory leak on homelab"
          lead={<span className="m-dot bg-err" />}
          meta={[
            <span key="s" className="text-err">
              Failed
            </span>,
            "Homelab",
            "OpenCode",
          ]}
        />
      </div>
      <div className="mt-auto flex h-11 items-center gap-1 border-t border-line px-3 text-ink-2">
        <span className="m-icon-btn">
          <Question size={16} />
        </span>
        <span className="m-icon-btn">
          <GearSix size={16} />
        </span>
      </div>
    </div>
  );
}

function NavItem({
  icon,
  children,
  primary,
}: {
  icon: ReactNode;
  children: ReactNode;
  primary?: boolean;
}) {
  return (
    <div className={`m-nav-item ${primary ? "is-primary" : ""}`}>
      {icon}
      {children}
    </div>
  );
}

function Row({
  title,
  meta,
  lead,
  active,
  unread,
}: {
  title: string;
  meta: ReactNode[];
  lead?: ReactNode;
  active?: boolean;
  unread?: boolean;
}) {
  return (
    <div className="m-row" aria-current={active ? "true" : undefined}>
      <span className="m-row-lead">
        {lead ?? <span className="m-tiny-dot" />}
      </span>
      <span className="min-w-0 flex-1">
        <span
          className="m-row-title"
          style={unread ? { paddingRight: 16 } : undefined}
        >
          {title}
        </span>
        <span className="m-row-meta">
          {meta.map((m, i) => (
            <span key={i} className="contents">
              {i > 0 && <span className="sep">·</span>}
              {m}
            </span>
          ))}
        </span>
      </span>
      {unread && <span className="m-unread" />}
    </div>
  );
}

/* ---------------- thread ---------------- */

function Thread({
  stage,
  words,
  replied,
}: {
  stage: number;
  words: number;
  replied: boolean;
}) {
  const live = stage < 2;
  return (
    <div className="flex min-w-0 flex-1 flex-col" aria-hidden="true">
      <div className="m-thread-head">
        <span className="m-icon-btn -ml-2 lg:hidden">
          <List size={16} />
        </span>
        <div className="min-w-0">
          <div className="truncate text-[13.5px] font-medium">
            Fix flaky auth integration tests
          </div>
        </div>
        <span className="hidden shrink-0 items-center gap-1.5 text-[12px] text-ink-3 sm:flex">
          <span className="text-ink-4">·</span> Homelab
        </span>
        <span className="ml-auto flex">
          <span className="m-icon-btn is-on hidden md:inline-grid">
            <SidebarSimple size={15} className="-scale-x-100" />
          </span>
        </span>
      </div>

      <div className="relative flex min-h-0 flex-1 flex-col justify-end overflow-hidden [mask-image:linear-gradient(to_bottom,transparent,black_48px)]">
        <div className="m-col">
          <div className="m-user">
            <div className="m-user-bubble">
              The auth integration tests fail about one run in ten on CI. Find
              the flake and fix it.
            </div>
          </div>

          <div className="my-3.5">
            <div className="m-worked-toggle" data-open={live}>
              <CaretRight size={13} className="chev" />
              {live ? (
                <span className="shimmer">Working… 5 steps</span>
              ) : (
                <span className="flex items-center gap-2.5">
                  Worked for 1m 33s
                  <span className="text-[12.5px]">
                    <Stat add={27} del={13} />
                  </span>
                </span>
              )}
            </div>
            <div className="m-worked-body" data-open={live}>
              <div className="m-worked-inner">
                <div className="m-steps">
                  <div className="m-step text-ink-3">
                    <span className="m-step-icon">
                      <DotsThree size={15} />
                    </span>
                    2 earlier steps
                  </div>
                  <div className="m-step">
                    <span className="m-step-icon">
                      <PencilSimple size={14} />
                    </span>
                    <span className="truncate">
                      Edit internal/auth/session.go
                    </span>
                    <span className="text-[12px]">
                      <Stat add={9} del={2} />
                    </span>
                  </div>
                  <div className="m-step">
                    <span className="m-step-icon">
                      <PencilSimple size={14} />
                    </span>
                    <span className="truncate">
                      Edit internal/auth/session_test.go
                    </span>
                    <span className="text-[12px]">
                      <Stat add={18} del={11} />
                    </span>
                  </div>
                  <div className="m-step">
                    <span className="m-step-icon">
                      {stage < 1 ? (
                        <span className="m-spinner" />
                      ) : (
                        <Terminal size={14} />
                      )}
                    </span>
                    <span className={stage < 1 ? "shimmer" : ""}>
                      Run tests
                    </span>
                    <code>go test ./internal/auth/...</code>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {stage >= 3 && (
            <div className="m-agent">
              <Words words={REPLY_WORDS} count={words} />
              {!replied && <span className="caret" />}
            </div>
          )}

          {replied && (
            <div className="m-approval fade-in">
              <div className="flex items-center gap-2.5 text-[14px] font-medium">
                <ShieldCheck size={17} className="text-warn" />
                <span className="min-w-0">
                  Allow the agent to run{" "}
                  <span className="whitespace-nowrap">go test -count=50</span>?
                </span>
              </div>
              <div className="m-approval-detail">
                go test -race -count=50 ./internal/auth/...
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <span className="m-btn m-btn-dark">Allow once</span>
                <span className="m-btn">Always allow go test</span>
                <span className="m-btn hidden sm:inline-flex">Reject</span>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="mx-auto w-full max-w-[660px] px-3 pb-3 sm:px-5 sm:pb-4">
        <div className="m-composer">
          <div className="pb-2.5 text-[13.5px] text-ink-4">
            Reply to Claude Code…
          </div>
          <div className="flex items-center gap-1">
            <span className="m-chip -ml-1.5">
              <Plus size={14} />
            </span>
            <span className="m-chip is-boxed">
              <ShieldCheck size={13} /> Accept edits
            </span>
            <span className="ml-auto" />
            <span className="m-chip hidden sm:inline-flex">
              <span className="size-1.5 rounded-full bg-[#d97757]" />
              Claude Code · Sonnet
            </span>
            <span className="m-chip px-1.5">
              <Microphone size={14} />
            </span>
            <span className="m-send">
              <ArrowUp size={13} weight="bold" />
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function Words({ words, count }: { words: string[]; count: number }) {
  return (
    <>
      {words.slice(0, count).map((w, i) => {
        const m = w.match(/^`([^`]+)`(.*)$/);
        return (
          <span key={i}>
            {i > 0 && " "}
            {m ? (
              <>
                <code className="kbd-code font-mono text-[12px]">{m[1]}</code>
                {m[2]}
              </>
            ) : (
              w
            )}
          </span>
        );
      })}
    </>
  );
}

/* ---------------- workspace ---------------- */

const TABS: { id: WsTab; label: string; icon: ReactNode }[] = [
  { id: "shell", label: "Shell", icon: <Terminal size={14} /> },
  { id: "desktop", label: "Desktop", icon: <Desktop size={14} /> },
  { id: "files", label: "Files", icon: <Folder size={14} /> },
  { id: "changes", label: "Changes", icon: <GitDiff size={14} /> },
  { id: "plan", label: "Plan", icon: <ListChecks size={14} /> },
];

function Workspace({
  tab,
  setTab,
}: {
  tab: WsTab;
  setTab: (t: WsTab) => void;
}) {
  return (
    <div className="m-workspace hidden w-[44%] md:flex lg:w-[38%]">
      <div
        className="m-ws-tabs"
        role="tablist"
        aria-label="Workspace panel (try the tabs)"
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`ws-tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls="ws-panel"
            className="m-ws-tab"
            onClick={() => setTab(t.id)}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>
      <div
        id="ws-panel"
        role="tabpanel"
        aria-labelledby={`ws-tab-${tab}`}
        className="relative min-h-0 flex-1 overflow-hidden"
      >
        <div className="h-full">
          {tab === "shell" && <ShellView />}
          {tab === "desktop" && <DesktopView />}
          {tab === "files" && <FilesView />}
          {tab === "changes" && <ChangesView />}
          {tab === "plan" && <PlanView />}
        </div>
      </div>
    </div>
  );
}

function ShellView() {
  const P = () => <span className="p">homelab:/srv/api-gateway$ </span>;
  return (
    <div className="m-term flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-hidden px-3.5 py-3 whitespace-pre">
        <div>
          <P />
          git status --short
        </div>
        <div className="text-[#e5c07b]"> M internal/auth/session.go</div>
        <div className="text-[#e5c07b]"> M internal/auth/session_test.go</div>
        <div>
          <P />
          go test ./internal/auth/...
        </div>
        <div>
          <span className="ok">ok</span>
          {"   github.com/acme/api-gateway/internal/auth  1.284s"}
        </div>
        <div>
          <P />
          df -h /
        </div>
        <div className="dim">Filesystem Size Used Avail Use%</div>
        <div>/dev/nvme0 916G 402G 468G 47%</div>
        <div>
          <P />
          <span className="caret !bg-[#d4d4d4]" />
        </div>
      </div>
      <div className="m-tmux">
        <span>[overseer] 0:shell* 1:logs</span>
        <span className="ml-auto">homelab</span>
      </div>
    </div>
  );
}

export function DesktopView({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex h-full flex-col bg-[#0c0c0c]">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-line bg-page px-3 text-[12px] text-ink-3">
        <span className="size-1.5 rounded-full bg-ok" />
        <span className="truncate">Connected · Homelab · via agent tunnel</span>
        <span className="ml-auto flex items-center gap-1">
          <Lock size={13} />
          <ArrowsOutSimple size={13} className="ml-1.5" />
        </span>
      </div>
      <div className="relative min-h-0 flex-1 overflow-hidden bg-[linear-gradient(160deg,#2d3446,#141821_60%,#0f1218)]">
        {/* top panel */}
        <div className="flex h-5 items-center justify-between bg-black/60 px-2.5 text-[9.5px] text-white/70">
          <span>Activities</span>
          <span>Mon 14:32</span>
          <span>● ◐ ⏻</span>
        </div>
        {/* a browser window */}
        <div
          className={`absolute overflow-hidden rounded-md border border-white/10 bg-[#f6f6f6] shadow-2xl ${
            compact
              ? "top-9 left-[6%] h-[58%] w-[62%]"
              : "top-10 left-[6%] h-[52%] w-[70%]"
          }`}
        >
          <div className="flex h-5 items-center gap-1 bg-[#e4e4e4] px-2">
            <span className="size-1.5 rounded-full bg-[#ff5f57]" />
            <span className="size-1.5 rounded-full bg-[#febc2e]" />
            <span className="size-1.5 rounded-full bg-[#28c840]" />
            <span className="ml-2 h-2.5 flex-1 rounded-sm bg-white text-[7px] leading-[10px] text-[#888]">
              &nbsp;localhost:3000/login
            </span>
          </div>
          <div className="grid h-[calc(100%-20px)] place-items-center">
            <div className="w-[52%] space-y-1.5">
              <div className="mx-auto mb-2 size-3.5 rounded-full border-2 border-[#222]" />
              <div className="h-2.5 rounded-[3px] border border-[#ddd] bg-white" />
              <div className="h-2.5 rounded-[3px] border border-[#ddd] bg-white" />
              <div className="h-2.5 rounded-[3px] bg-[#222]" />
            </div>
          </div>
        </div>
        {/* a terminal window */}
        <div
          className={`absolute overflow-hidden rounded-md border border-white/10 bg-[#111] font-mono text-[8.5px] leading-[1.6] text-[#cfcfcf] shadow-2xl ${
            compact
              ? "right-[5%] bottom-[8%] h-[44%] w-[52%]"
              : "right-[5%] bottom-[7%] h-[40%] w-[58%]"
          }`}
        >
          <div className="h-4 bg-[#1e1e1e]" />
          <div className="px-2 py-1">
            <div>
              <span className="text-[#6fb3ff]">~/api$</span> npm run dev
            </div>
            <div className="text-[#7a7a7a]">ready on http://localhost:3000</div>
            <div className="text-[#4ade80]">✓ compiled in 412ms</div>
          </div>
        </div>
        {/* dock */}
        <div className="absolute bottom-1.5 left-1/2 flex -translate-x-1/2 gap-1 rounded-md bg-white/10 p-1">
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className="size-2.5 rounded-[3px] bg-white/30" />
          ))}
        </div>
      </div>
    </div>
  );
}

function FilesView() {
  const rows: [number, "dir" | "file", string, string?][] = [
    [0, "dir", "cmd"],
    [0, "dir", "internal"],
    [1, "dir", "auth"],
    [2, "file", "session.go", "M"],
    [2, "file", "session_test.go", "M"],
    [2, "file", "token.go"],
    [1, "dir", "billing"],
    [1, "dir", "http"],
    [0, "file", "go.mod"],
    [0, "file", "go.sum"],
    [0, "file", "Makefile"],
    [0, "file", "README.md"],
  ];
  return (
    <div className="h-full overflow-hidden">
      <div className="flex h-9 items-center gap-1.5 border-b border-line px-3.5 font-mono text-[11.5px] text-ink-3">
        <Folder size={13} /> /srv/api-gateway
      </div>
      <div className="p-2">
        {rows.map(([depth, kind, name, flag]) => (
          <div
            key={name}
            className={`flex h-[27px] items-center gap-2 rounded-md px-2 text-[12.5px] ${
              name === "session_test.go" ? "bg-active" : ""
            }`}
            style={{ paddingLeft: 8 + depth * 16 }}
          >
            {kind === "dir" ? (
              <Folder size={14} className="text-ink-3" />
            ) : name.endsWith(".md") ? (
              <FileText size={14} className="text-ink-3" />
            ) : (
              <File size={14} className="text-ink-3" />
            )}
            <span className="truncate">{name}</span>
            {flag && (
              <span className="ml-auto font-mono text-[11px] text-warn">
                {flag}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function ChangesView() {
  return (
    <div className="h-full space-y-2.5 overflow-hidden p-3">
      <div className="flex items-center justify-between px-0.5 text-[12.5px] text-ink-3">
        <span>2 files changed</span>
        <Stat add={27} del={13} />
      </div>
      <Diff
        path="internal/auth/session_test.go"
        add={18}
        del={11}
        lines={AUTH_DIFF}
      />
      <Diff
        path="internal/auth/session.go"
        add={9}
        del={2}
        lines={[
          ["@", "@@ -21,6 +21,13 @@ type Store struct {"],
          ["+", "func WithClock(c Clock) Option {"],
          ["+", "\treturn func(s *Store) { s.clock = c }"],
          ["+", "}"],
        ]}
      />
    </div>
  );
}

function PlanView() {
  const items: [string, "done" | "active" | "todo"][] = [
    ["Reproduce the flake locally", "done"],
    ["Find the timing dependency", "done"],
    ["Replace sleeps with a fake clock", "done"],
    ["Run the suite 50× with -race", "active"],
    ["Open a pull request", "todo"],
  ];
  return (
    <div className="p-4">
      <div className="mb-2 text-[12.5px] text-ink-3">Plan · 3 of 5</div>
      {items.map(([text, state]) => (
        <div
          key={text}
          className={`flex items-start gap-2.5 py-1.5 text-[13.5px] ${
            state === "done"
              ? "text-ink-3 line-through decoration-ink-4"
              : "text-ink-2"
          }`}
        >
          <span className={`m-plan-check ${state === "todo" ? "" : state}`}>
            {state === "done" && (
              <svg width="9" height="9" viewBox="0 0 12 12" aria-hidden="true">
                <path
                  d="M2.5 6.5l2.2 2.2L9.5 3.8"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                />
              </svg>
            )}
          </span>
          {text}
        </div>
      ))}
    </div>
  );
}
