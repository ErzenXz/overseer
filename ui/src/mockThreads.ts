// DEV-ONLY MOCK for agent threads, automations, MCP servers and review data.
// Implements the endpoints in docs/agent-sessions-api.md so the UI can be
// built and judged without a hub. Simulates streaming agent turns.

import type { Automation, McpServer, Thread, ThreadMessage } from './types'

const nowSec = () => Math.floor(Date.now() / 1000)
const nowMs = () => Date.now()
let counter = 100
const uid = (prefix: string) => `${prefix}_${(counter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`

const deviceNames: Record<string, string> = { macbook: 'MacBook Pro', studio: 'Studio', homelab: 'Homelab', office: 'Office PC' }

function thread(partial: Partial<Thread> & Pick<Thread, 'id' | 'title' | 'deviceId' | 'agent' | 'cwd'>): Thread {
  const updated = partial.updatedAt ?? nowSec() - 600
  return {
    deviceName: deviceNames[partial.deviceId] ?? partial.deviceId,
    access: 'auto',
    status: 'idle',
    createdAt: updated - 3600,
    updatedAt: updated,
    lastReadAt: updated,
    terminal: `t-${partial.id}`,
    ...partial,
  }
}

const threads: Thread[] = [
  thread({ id: 'th_rust', title: 'Build Rust OpenAI harness', deviceId: 'studio', agent: 'codex', cwd: '~/Projects/codex-harness', updatedAt: nowSec() - 120, lastReadAt: nowSec() - 900, pinned: true, folder: 'Harness', pr: { url: 'https://github.com/ErzenXz/codex-harness/pull/1', number: 1, state: 'open', checks: 'passing' }, usage: { inputTokens: 412_000, outputTokens: 38_400, costUsd: 3.12, contextTokens: 161_000, contextWindow: 272_000 } }),
  thread({ id: 'th_ui', title: 'Improve dashboard UI and features', deviceId: 'macbook', agent: 'claude', model: 'opus', cwd: '~/Projects/LiveAgent', updatedAt: nowSec() - 3600 * 5, pr: { url: 'https://github.com/ErzenXz/overseer/pull/3', number: 3, state: 'open', checks: 'passing' } }),
  thread({ id: 'th_auth', title: 'Fix flaky auth integration tests', deviceId: 'homelab', agent: 'claude', cwd: '/srv/api-gateway', status: 'waiting', updatedAt: nowSec() - 60 * 14, lastReadAt: nowSec() - 3600 }),
  thread({ id: 'th_archive', title: 'Update archive homepage design', deviceId: 'studio', agent: 'claude', cwd: '~/Projects/archive', status: 'waiting', folder: 'Websites', updatedAt: nowSec() - 120, pr: { url: 'https://github.com/ErzenXz/archive/pull/1', number: 1, state: 'open', checks: 'passing' } }),
  thread({ id: 'th_deps', title: 'Weekly dependency update', deviceId: 'homelab', agent: 'codex', cwd: '/srv/api-gateway', updatedAt: nowSec() - 86400 * 9, automationId: 'au_deps', pr: { url: 'https://github.com/ErzenXz/api-gateway/pull/88', number: 88, state: 'merged' } }),
  thread({ id: 'th_map', title: 'Redesign calendar UI with map', deviceId: 'macbook', agent: 'claude', cwd: '~/Projects/takvimi', updatedAt: nowSec() - 86400 * 61, pr: { url: 'https://github.com/ErzenXz/takvimi/pull/3', number: 3, state: 'merged' } }),
  thread({ id: 'th_leak', title: 'Investigate memory leak on homelab', deviceId: 'homelab', agent: 'opencode', cwd: '/srv/worker', status: 'error', error: 'opencode exited with status 1: provider not configured', updatedAt: nowSec() - 86400 * 70 }),
]

const diffReadme = `@@ -1,9 +1,24 @@
-# codex-harness
-
-Experimental harness. See docs/ for details.
+# codex-harness
+
+A tiny Rust harness that drives Codex and other ACP agents.
+
+## Install
+
+\`\`\`sh
+cargo install --git https://github.com/ErzenXz/codex-harness
+\`\`\`
+
+## Sign in
+
+\`\`\`sh
+codex-harness login
+\`\`\`
+
+## Run
+
+\`\`\`sh
+codex-harness acp
+\`\`\``

function msg(threadId: string, partial: Partial<ThreadMessage> & Pick<ThreadMessage, 'role'>, at: number): ThreadMessage {
  const list = (messages[threadId] ??= [])
  const message: ThreadMessage = { id: uid('m'), seq: list.length + 1, at, updatedAt: at, text: '', ...partial }
  list.push(message)
  return message
}

const messages: Record<string, ThreadMessage[]> = {}

function seed() {
  const base = nowMs() - 3600_000
  let t = base
  const step = (ms: number) => (t += ms)
  const u1 = msg('th_rust', { role: 'user', text: 'Build a small Rust harness for Codex with ACP support, MCP over stdio and HTTP, and opt-in computer use. Keep idle memory tiny.' }, step(0))
  msg('th_rust', { role: 'thought', turn: u1.id, text: 'Start with the ACP surface: initialize, session/new, session/prompt. MCP connections should be lazy and shared across sessions so idle RSS stays low.' }, step(4000))
  msg('th_rust', { role: 'plan', turn: u1.id, text: '', plan: [
    { content: 'Scaffold crate with tokio + serde_json', status: 'completed' },
    { content: 'ACP server: initialize, session/new, session/prompt', status: 'completed' },
    { content: 'MCP client for stdio and Streamable HTTP', status: 'completed' },
    { content: 'Computer use behind an approval gate', status: 'completed' },
    { content: 'Benchmark 10 mock agents for idle RSS', status: 'completed' },
  ] }, step(3000))
  msg('th_rust', { role: 'tool', turn: u1.id, text: '', tool: { name: 'bash', title: 'Run cargo new', status: 'completed', input: 'cargo new codex-harness --bin', output: '    Creating binary (application) `codex-harness` package\nnote: see more `Cargo.toml` keys and their definitions at https://doc.rust-lang.org/cargo/reference/manifest.html' } }, step(9000))
  msg('th_rust', { role: 'tool', turn: u1.id, text: '', tool: { name: 'edit', title: 'Edit src/acp.rs', status: 'completed', input: 'src/acp.rs', files: [{ path: 'src/acp.rs', additions: 212, deletions: 0 }] } }, step(42000))
  msg('th_rust', { role: 'tool', turn: u1.id, text: '', tool: { name: 'bash', title: 'Run tests', status: 'completed', input: 'cargo test --all', output: 'running 44 tests\n............................................\ntest result: ok. 44 passed; 0 failed; 0 ignored; finished in 2.31s' } }, step(30000))
  msg('th_rust', { role: 'assistant', turn: u1.id, durationMs: 93_000, text: 'Implemented and pushed; **CI is green and all 44 tests pass**: [codex-harness#1](https://github.com/ErzenXz/codex-harness/pull/1)\n\nMCP supports stdio and Streamable HTTP with lazy, shared connections. Opt-in computer use includes screenshots, mouse/keyboard actions, and a bundled skill — all approval-gated.\n\nFresh 10-agent mock benchmark: **5.32 MiB idle RSS**.\n\nNative desktop use requires Linux/X11 and remains mock-tested — not validated against a real app. PR remains unmerged.' }, step(12000))
  const u2 = msg('th_rust', { role: 'user', text: 'Update the README so it is very simple how to install and run. Then push and merge into main.' }, step(240_000))
  msg('th_rust', { role: 'assistant', turn: u2.id, text: 'I’ll simplify the install, sign-in and run instructions, verify the commands, then push and merge everything into `main` once checks pass.' }, step(3000))
  msg('th_rust', { role: 'tool', turn: u2.id, text: '', tool: { name: 'edit', title: 'Edit README.md', status: 'completed', input: 'README.md', files: [{ path: 'README.md', additions: 19, deletions: 3, diff: diffReadme }] } }, step(60_000))
  msg('th_rust', { role: 'tool', turn: u2.id, text: '', tool: { name: 'bash', title: 'Verify install from a clean checkout', status: 'completed', input: 'cargo install --path . && codex-harness acp --help', output: '  Installing codex-harness v0.1.0\n   Finished `release` profile [optimized] target(s) in 41.20s\n  Installed package `codex-harness v0.1.0`\nUsage: codex-harness acp [OPTIONS]' } }, step(80_000))
  msg('th_rust', { role: 'tool', turn: u2.id, text: '', tool: { name: 'bash', title: 'Push branch', status: 'completed', input: 'git push origin readme-quickstart', output: 'To github.com:ErzenXz/codex-harness.git\n   4f1c2aa..9e07b3d  readme-quickstart -> readme-quickstart' } }, step(9000))
  msg('th_rust', { role: 'assistant', turn: u2.id, durationMs: 236_000, text: 'The [quick start](https://github.com/ErzenXz/codex-harness#install) is now **install → sign in → connect your ACP app**, with advanced details moved out of the way.\n\nInstallation and ACP startup are verified; all 44 local tests pass. CI is running, then I’ll merge into `main`.' }, step(4000))

  t = nowMs() - 3600_000 * 5
  const v1 = msg('th_ui', { role: 'user', text: 'Make the session sidebar match the reference screenshots and add sort/filter/group menus.' }, step(0))
  msg('th_ui', { role: 'tool', turn: v1.id, text: '', tool: { name: 'read', title: 'Read ui/src/components/Layout.tsx', status: 'completed', input: 'ui/src/components/Layout.tsx' } }, step(5000))
  msg('th_ui', { role: 'tool', turn: v1.id, text: '', tool: { name: 'edit', title: 'Edit ui/src/index.css', status: 'completed', input: 'ui/src/index.css', files: [{ path: 'ui/src/index.css', additions: 214, deletions: 96 }] } }, step(80_000))
  msg('th_ui', { role: 'assistant', turn: v1.id, durationMs: 412_000, text: 'Sessions are now the primary sidebar, with **Sort**, **Filter**, **Group** and **Property visibility** menus. Opened [overseer#3](https://github.com/ErzenXz/overseer/pull/3).' }, step(9000))

  t = nowMs() - 60_000 * 20
  const a1 = msg('th_auth', { role: 'user', text: 'The auth integration tests fail about 1 in 5 runs. Find out why and fix it.' }, step(0))
  msg('th_auth', { role: 'tool', turn: a1.id, text: '', tool: { name: 'grep', title: 'Search for time.Sleep in tests', status: 'completed', input: 'time.Sleep  internal/auth', output: 'internal/auth/session_test.go:88:\ttime.Sleep(10 * time.Millisecond)\ninternal/auth/session_test.go:142:\ttime.Sleep(5 * time.Millisecond)' } }, step(6000))
  msg('th_auth', { role: 'thought', turn: a1.id, text: 'The tests race the session expiry ticker. Injecting a fake clock removes the sleeps entirely.' }, step(4000))
  msg('th_auth', { role: 'tool', turn: a1.id, text: '', tool: { name: 'edit', title: 'Edit internal/auth/session_test.go', status: 'completed', input: 'internal/auth/session_test.go', files: [{ path: 'internal/auth/session_test.go', additions: 18, deletions: 11, diff: '@@ -84,9 +84,12 @@ func TestSessionExpiry(t *testing.T) {\n-\tstore := NewStore()\n+\tclock := newFakeClock()\n+\tstore := NewStore(WithClock(clock))\n \tid := store.Create(user)\n-\ttime.Sleep(10 * time.Millisecond)\n+\tclock.Advance(ttl + time.Second)\n \tif store.Valid(id) {\n \t\tt.Fatal("expired session still valid")\n \t}' }] } }, step(40_000))
  msg('th_auth', { role: 'approval', turn: a1.id, text: '', approval: { id: 'ap_1', title: 'Run go test -count=50 ./internal/auth/...', detail: 'go test -race -count=50 ./internal/auth/...', options: [
    { id: 'allow', label: 'Allow once', kind: 'allow_once' },
    { id: 'always', label: 'Always allow go test', kind: 'allow_always' },
    { id: 'reject', label: 'Reject', kind: 'reject_once' },
  ] } }, step(2000))

  t = nowMs() - 86400_000 * 70
  const l1 = msg('th_leak', { role: 'user', text: 'The worker on homelab grows to 3 GB over a day. Profile it.' }, step(0))
  msg('th_leak', { role: 'error', turn: l1.id, text: 'opencode exited with status 1: provider not configured. Run `opencode auth login` on Homelab.' }, step(3000))

  for (const id of ['th_archive', 'th_deps', 'th_map']) {
    t = (threads.find((item) => item.id === id)!.updatedAt * 1000) - 600_000
    const user = msg(id, { role: 'user', text: threads.find((item) => item.id === id)!.title }, step(0))
    msg(id, { role: 'tool', turn: user.id, text: '', tool: { name: 'bash', title: 'Install dependencies', status: 'completed', input: 'pnpm install', output: 'Done in 4.2s' } }, step(8000))
    msg(id, { role: 'assistant', turn: user.id, durationMs: 340_000, text: `Done. Opened ${threads.find((item) => item.id === id)!.pr?.url ?? 'a branch'} with the changes.` }, step(330_000))
  }
  const q1 = msg('th_archive', { role: 'user', text: 'Add a newsletter signup to the homepage.' }, nowMs() - 60_000 * 3)
  msg('th_archive', { role: 'question', turn: q1.id, text: '', question: { id: 'q_1', text: 'Which provider should the signup form use?', options: [
    { id: 'buttondown', label: 'Buttondown', description: 'Simple API, no tracking by default' },
    { id: 'resend', label: 'Resend', description: 'You already use it for transactional email' },
    { id: 'none', label: 'Just store emails', description: 'Save to a local JSON file for now' },
  ], allowText: true } }, nowMs() - 60_000 * 2)
}
seed()

// ---- live streaming ----

type Listener = (event: { type: 'snapshot'; thread: Thread; messages: ThreadMessage[] } | { type: 'message'; message: ThreadMessage } | { type: 'thread'; thread: Thread }) => void
const listeners: Record<string, Set<Listener>> = {}
let onThreadsChanged: () => void = () => {}
export function setThreadsChangedHandler(fn: () => void) { onThreadsChanged = fn }

function emit(threadId: string, event: Parameters<Listener>[0]) {
  listeners[threadId]?.forEach((listener) => listener(event))
}
function touch(item: Thread, patch: Partial<Thread>) {
  Object.assign(item, patch, { updatedAt: nowSec() })
  emit(item.id, { type: 'thread', thread: { ...item } })
  onThreadsChanged()
}
function push(threadId: string, partial: Partial<ThreadMessage> & Pick<ThreadMessage, 'role'>) {
  const message = msg(threadId, partial, nowMs())
  emit(threadId, { type: 'message', message: { ...message } })
  return message
}
function update(threadId: string, message: ThreadMessage, patch: Partial<ThreadMessage>) {
  Object.assign(message, patch, { updatedAt: nowMs() })
  emit(threadId, { type: 'message', message: { ...message, tool: message.tool && { ...message.tool } } })
}

export function mockThreadStream(id: string, listener: Listener) {
  ;(listeners[id] ??= new Set()).add(listener)
  const item = threads.find((entry) => entry.id === id)
  window.setTimeout(() => {
    if (item) listener({ type: 'snapshot', thread: { ...item }, messages: (messages[id] ?? []).map((message) => ({ ...message })) })
  }, 60)
  return () => { listeners[id]?.delete(listener) }
}

const timers: Record<string, number[]> = {}
function later(threadId: string, ms: number, fn: () => void) {
  ;(timers[threadId] ??= []).push(window.setTimeout(fn, ms))
}
function cancelTimers(threadId: string) {
  timers[threadId]?.forEach((timer) => window.clearTimeout(timer))
  timers[threadId] = []
}

// A long, formatted reply for checking Markdown rendering while it streams.
function richAnswer(machine: string) {
  return [
    `Here’s what I can see for \`${machine}\`. It’s a **KVM virtual machine**, so these are its assigned resources.`,
    '',
    '| Component | Details |',
    '|---|---|',
    '| **CPU** | AMD EPYC 7K62, **4 virtual CPUs** assigned |',
    '| **GPU** | Emulated Cirrus Logic GD 5446; no dedicated GPU |',
    '| **RAM** | **11.7 GiB** total, 2.9 GiB used, **8.8 GiB** available |',
    '| **Storage** | **80 GiB** virtual disk; 12 GiB used, 62 GiB available |',
    '| **OS** | Ubuntu 24.04.5 LTS, 64-bit |',
    '| **Kernel** | `6.8.0-147-generic` |',
    '',
    '## How I checked',
    '',
    '1. Read `/proc/cpuinfo` and `lscpu` for the processor',
    '2. Listed PCI devices for the GPU',
    '3. Compared `free -h` with `df -h /`',
    '',
    '```bash',
    'lscpu | grep -E "Model name|^CPU\\(s\\)"',
    'free -h && df -h /',
    'lspci | grep -i vga',
    '```',
    '',
    '- [x] CPU and memory',
    '- [x] Disk usage',
    '- [ ] GPU passthrough (not configured)',
    '',
    '> The “48-Core” in the model name describes the *host* CPU. This VM can use ~~48~~ **4** of them.',
    '',
    'Memory headroom is roughly $$\\frac{8.8}{11.7} \\approx 75\\%$$ of the total.',
    '',
    '```mermaid',
    'flowchart LR',
    '  Host[EPYC host] --> VM[erzen-dev VM]',
    '  VM --> CPU[4 vCPU]',
    '  VM --> RAM[11.7 GiB]',
    '```',
    '',
    'More detail is in the [Ubuntu server docs](https://ubuntu.com/server/docs).',
  ].join('\n')
}

function simulateTurn(item: Thread, text: string) {
  const started = nowMs()
  const user = push(item.id, { role: 'user', text })
  touch(item, { status: 'working', error: undefined })
  const lower = text.toLowerCase()
  const askOnly = item.access === 'ask'
  later(item.id, 700, () => {
    const thought = push(item.id, { role: 'thought', turn: user.id, text: '' })
    const words = `Looking at the request. I’ll inspect the project layout in ${item.cwd}, then make the smallest change that does the job and verify it.`.split(' ')
    words.forEach((word, index) => later(item.id, 40 * index, () => update(item.id, thought, { text: thought.text + (index ? ' ' : '') + word })))
  })
  later(item.id, 2200, () => {
    const tool = push(item.id, { role: 'tool', turn: user.id, text: '', tool: { name: 'bash', title: 'List project files', status: 'running', input: 'git status --short && ls' } })
    later(item.id, 900, () => update(item.id, tool, { tool: { ...tool.tool!, status: 'completed', output: ' M src/app.tsx\nREADME.md  package.json  src  tsconfig.json' } }))
  })
  if (!askOnly) {
    later(item.id, 3600, () => {
      const tool = push(item.id, { role: 'tool', turn: user.id, text: '', tool: { name: 'edit', title: 'Edit src/app.tsx', status: 'running', input: 'src/app.tsx' } })
      later(item.id, 1400, () => update(item.id, tool, { tool: { ...tool.tool!, status: 'completed', files: [{ path: 'src/app.tsx', additions: 6, deletions: 2, diff: '@@ -12,7 +12,11 @@ export function App() {\n-  const title = "Overseer"\n-  return <Shell title={title} />\n+  const title = useTitle()\n+  return (\n+    <Shell title={title}>\n+      <Sessions />\n+    </Shell>\n+  )\n }' }] } }))
    })
  }
  const serve = /dev server|preview|serve|run (it|the site)|start/.test(lower)
  later(item.id, 5600, () => {
    if (serve) {
      const tool = push(item.id, { role: 'tool', turn: user.id, text: '', tool: { name: 'bash', title: 'Start the dev server', status: 'running', input: 'npm run dev -- --port 5173' } })
      later(item.id, 1400, () => update(item.id, tool, { tool: { ...tool.tool!, status: 'completed', output: '\n  VITE v6.0.3  ready in 412 ms\n\n  ➜  Local:   http://localhost:5173/\n  ➜  Network: use --host to expose' } }))
      return
    }
    const tool = push(item.id, { role: 'tool', turn: user.id, text: '', tool: { name: 'bash', title: 'Run tests', status: 'running', input: 'npm test -- --run' } })
    later(item.id, 1600, () => update(item.id, tool, { tool: { ...tool.tool!, status: 'completed', output: ' ✓ src/app.test.tsx (6 tests) 41ms\n\n Test Files  1 passed (1)\n      Tests  6 passed (6)' } }))
  })
  later(item.id, 7600, () => {
    const answer = serve ? `The school site is running at http://localhost:5173/ on **${item.deviceName}**. It hot-reloads as I edit, so keep the preview open while I work.` : /spec|markdown|hardware/.test(lower) ? richAnswer(item.deviceName) : askOnly
      ? `Here’s what I found in \`${item.cwd}\`. The entry point is \`src/app.tsx\`; the change you asked about would touch it and the tests in \`src/app.test.tsx\`. Switch to **Agent** mode and I’ll make it.`
      : lower.includes('pr') || lower.includes('push')
        ? `Done. I committed the change and opened a pull request. **All 6 tests pass.**`
        : `Done — updated \`src/app.tsx\` and verified with the test suite (**6 passed**). Nothing is committed yet; say “push” and I’ll open a PR.`
    const message = push(item.id, { role: 'assistant', turn: user.id, text: '' })
    const parts = answer.split(/(\s+)/)
    const step = answer.length > 400 ? 40 : 18
    parts.forEach((part, index) => later(item.id, step * index, () => update(item.id, message, { text: message.text + part })))
    later(item.id, step * parts.length + 50, () => {
      update(item.id, message, { durationMs: nowMs() - started })
      touch(item, { status: 'idle' })
    })
  })
}

// ---- other demo data ----

let mcpServers: McpServer[] = [
  { id: 'builtin', name: 'Overseer', transport: 'http', url: `${location.origin}/mcp`, enabled: false, builtin: true },
  { id: 'mcp_github', name: 'GitHub', transport: 'http', url: 'https://api.githubcopilot.com/mcp/', headers: { Authorization: 'Bearer ${GITHUB_TOKEN}' }, enabled: true },
  { id: 'mcp_playwright', name: 'Playwright', transport: 'stdio', command: 'npx', args: ['@playwright/mcp@latest'], enabled: false },
]

let automations: Automation[] = [
  { id: 'au_deps', name: 'Weekly dependency update', prompt: 'Update dependencies to the latest compatible versions, run the tests, and open a PR if anything changed.', deviceId: 'homelab', agent: 'codex', cwd: '/srv/api-gateway', access: 'auto', schedule: '0 9 * * 1', enabled: true, createdAt: nowSec() - 86400 * 30, lastRunAt: nowSec() - 86400 * 9, lastThreadId: 'th_deps', nextRunAt: nowSec() + 86400 * 2 },
]

const reviewPrs = [
  { number: 3, title: 'Refresh the Overseer UI and expose fleet capacity through MCP', repository: { nameWithOwner: 'ErzenXz/overseer' }, url: 'https://github.com/ErzenXz/overseer/pull/3', updatedAt: new Date(Date.now() - 3600_000).toISOString(), isDraft: false, state: 'open', author: { login: 'devin-ai-integration' }, commentsCount: 0 },
  { number: 1, title: 'Redesign archive as a plain early-web homepage', repository: { nameWithOwner: 'ErzenXz/archive' }, url: 'https://github.com/ErzenXz/archive/pull/1', updatedAt: new Date(Date.now() - 86400_000 * 6).toISOString(), isDraft: false, state: 'open', author: { login: 'devin-ai-integration' }, commentsCount: 0 },
  { number: 1, title: 'Rebuild all 32 apps as a minimal OS-style desktop', repository: { nameWithOwner: 'ErzenXz/apps' }, url: 'https://github.com/ErzenXz/apps/pull/1', updatedAt: new Date(Date.now() - 86400_000 * 6).toISOString(), isDraft: false, state: 'open', author: { login: 'devin-ai-integration' }, commentsCount: 0 },
  { number: 3, title: 'docs: simple user-first README + auto-update (systemd timer)', repository: { nameWithOwner: 'ErzenXz/opencel' }, url: 'https://github.com/ErzenXz/opencel/pull/3', updatedAt: new Date(Date.now() - 86400_000 * 180).toISOString(), isDraft: false, state: 'open', author: { login: 'devin-ai-integration' }, commentsCount: 1 },
  { number: 15, title: '[Snyk] Security upgrade next from 16.0.10 to 16.1.5', repository: { nameWithOwner: 'ErzenXz/nexora' }, url: 'https://github.com/ErzenXz/nexora/pull/15', updatedAt: new Date(Date.now() - 86400_000 * 270).toISOString(), isDraft: false, state: 'open', author: { login: 'ErzenXz' }, commentsCount: 0 },
  { number: 86, title: '[Snyk] Security upgrade node from 20.19.2-alpine3.21 to 20.19.6-alpine3.21', repository: { nameWithOwner: 'ErzenXz/work-box' }, url: 'https://github.com/ErzenXz/work-box/pull/86', updatedAt: new Date(Date.now() - 86400_000 * 330).toISOString(), isDraft: true, state: 'open', author: { login: 'ErzenXz' }, commentsCount: 0 },
]
const prStats: Record<string, [number, number, 'pass' | 'fail']> = {
  'ErzenXz/overseer#3': [1300, 897, 'pass'], 'ErzenXz/archive#1': [1600, 529, 'pass'], 'ErzenXz/apps#1': [8800, 11000, 'pass'], 'ErzenXz/opencel#3': [346, 69, 'pass'], 'ErzenXz/nexora#15': [1, 1, 'fail'], 'ErzenXz/work-box#86': [3, 3, 'fail'],
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
}

export function mockExec(command: string): { exitCode: number; stdout: string; stderr: string } | null {
  if (command.includes('--review-requested')) return { exitCode: 0, stdout: '[]', stderr: '' }
  if (command.includes('gh search prs') || command.includes('gh pr list')) return { exitCode: 0, stdout: JSON.stringify(reviewPrs), stderr: '' }
  if (command.includes('gh pr view')) {
    const match = command.match(/gh pr view (\d+) -R (\S+)/)
    const [additions, deletions, ci] = (match && prStats[`${match[2]}#${match[1]}`]) || [12, 4, 'pass']
    return { exitCode: 0, stdout: JSON.stringify({ additions, deletions, statusCheckRollup: [{ conclusion: ci === 'pass' ? 'SUCCESS' : 'FAILURE', status: 'COMPLETED' }] }), stderr: '' }
  }
  if (command.includes('--review-requested')) return { exitCode: 0, stdout: '[]', stderr: '' }
  if (command.includes('gh auth status')) return { exitCode: 0, stdout: '', stderr: 'github.com\n  ✓ Logged in to github.com account ErzenXz (keyring)\n  - Active account: true' }
  if (command.includes('gh repo list')) return { exitCode: 0, stdout: JSON.stringify(['overseer', 'archive', 'apps', 'opencel', 'nexora', 'work-box', 'auth-backend'].map((name) => ({ nameWithOwner: `ErzenXz/${name}` }))), stderr: '' }
  return null
}

export function prStatsFor(repo: string, number: number) {
  return prStats[`${repo}#${number}`]
}

export async function threadRoute(method: string, path: string, body: Record<string, unknown>): Promise<Response | null> {
  if (path === '/api/threads' && method === 'GET') return json([...threads].sort((a, b) => b.updatedAt - a.updatedAt))
  if (path === '/api/threads' && method === 'POST') {
    const prompt = String(body.prompt ?? '')
    const item = thread({
      id: uid('th'),
      title: String(body.title || prompt.split('\n')[0].slice(0, 60) || 'New session'),
      deviceId: String(body.deviceId ?? 'macbook'),
      agent: String(body.agent ?? 'claude'),
      cwd: String(body.cwd || '~'),
      model: body.model ? String(body.model) : undefined,
      effort: body.effort ? String(body.effort) : undefined,
      fast: body.fast ? true : undefined,
      mode: body.mode ? String(body.mode) : undefined,
      access: (body.access as Thread['access']) ?? 'auto',
      status: 'starting',
      updatedAt: nowSec(),
      lastReadAt: nowSec(),
    })
    threads.unshift(item)
    messages[item.id] = []
    window.setTimeout(() => simulateTurn(item, prompt), 400)
    onThreadsChanged()
    return json(item)
  }
  const match = path.match(/^\/api\/threads\/([^/]+)(?:\/(prompt|cancel|approval|fork|compact|undo|answer|commands|capabilities))?$/)
  if (match) {
    const item = threads.find((entry) => entry.id === decodeURIComponent(match[1]))
    if (!item) return json({ error: 'thread not found' }, 404)
    const action = match[2]
    if (!action && method === 'GET') return json({ thread: item, messages: messages[item.id] ?? [] })
    if (!action && method === 'PATCH') {
      if (body.read === true) item.lastReadAt = nowSec() + 1
      if (body.read === false) item.lastReadAt = 0
      if (typeof body.pinned === 'boolean') item.pinned = body.pinned
      if (typeof body.archived === 'boolean') item.archived = body.archived
      if (typeof body.folder === 'string') item.folder = body.folder || undefined
      if (typeof body.title === 'string') item.title = body.title
      if (typeof body.access === 'string') item.access = body.access as Thread['access']
      if (typeof body.model === 'string') item.model = body.model
      if (typeof body.effort === 'string') item.effort = body.effort
      if (typeof body.fast === 'boolean') item.fast = body.fast
      if (typeof body.mode === 'string') item.mode = body.mode
      emit(item.id, { type: 'thread', thread: { ...item } })
      return json({ ...item })
    }
    if (!action && method === 'DELETE') {
      cancelTimers(item.id)
      threads.splice(threads.indexOf(item), 1)
      onThreadsChanged()
      return json({ ok: true })
    }
    if (action === 'prompt') {
      // While a turn runs, a new prompt steers it (demo: shown as queued, then sent).
      if (item.status === 'working') {
        const queued = push(item.id, { role: 'user', text: String(body.text ?? ''), queued: true })
        later(item.id, 2500, () => update(item.id, queued, { queued: false }))
        return json({ ok: true })
      }
      simulateTurn(item, String(body.text ?? ''))
      return json({ ok: true })
    }
    if (action === 'capabilities') {
      const native = item.agent === 'codex'
      return json({ fork: true, compact: item.agent !== 'opencode', undo: native, steer: native || item.agent === 'claude', images: true, commands: true, review: native })
    }
    if (action === 'commands') return json(demoCommands(item.agent))
    if (action === 'fork') {
      const child = thread({ id: uid('th'), title: `${item.title} (continued)`, deviceId: item.deviceId, agent: item.agent, cwd: item.cwd, model: item.model, effort: item.effort, mode: item.mode, parentId: item.id, updatedAt: nowSec(), lastReadAt: nowSec() })
      threads.unshift(child)
      messages[child.id] = []
      push(child.id, { role: 'status', text: `Continued from “${item.title}”. The agent keeps that conversation’s context.` })
      onThreadsChanged()
      return json(child)
    }
    if (action === 'compact') {
      push(item.id, { role: 'status', text: 'Conversation compacted: older turns summarised to free up context.' })
      if (item.usage) item.usage = { ...item.usage, contextTokens: Math.round((item.usage.contextTokens ?? 120_000) * 0.25) }
      touch(item, {})
      return json({ ok: true })
    }
    if (action === 'undo') {
      if (item.agent !== 'codex') return json({ error: `undo is not supported by ${item.agent}` }, 409)
      const list = messages[item.id] ?? []
      const lastUser = [...list].reverse().find((message) => message.role === 'user')
      if (lastUser) messages[item.id] = list.filter((message) => message.id !== lastUser.id && message.turn !== lastUser.id)
      emit(item.id, { type: 'snapshot', thread: { ...item }, messages: (messages[item.id] ?? []).map((message) => ({ ...message })) })
      touch(item, {})
      return json({ ok: true })
    }
    if (action === 'answer') {
      const question = (messages[item.id] ?? []).find((message) => message.question?.id === body.questionId)
      if (question?.question) {
        const answers = (body.answers as string[]) ?? []
        update(item.id, question, { question: { ...question.question, answered: body.text ? [...answers, String(body.text)] : answers } })
        const picked = question.question.options.filter((option) => answers.includes(option.id)).map((option) => option.label).join(', ') || String(body.text ?? '')
        touch(item, { status: 'working' })
        later(item.id, 900, () => { push(item.id, { role: 'assistant', turn: question.turn, text: `Going with **${picked}**. I’ll set it up and run the tests.` }); touch(item, { status: 'idle' }) })
      }
      return json({ ok: true })
    }
    if (action === 'cancel') {
      cancelTimers(item.id)
      push(item.id, { role: 'status', text: 'Stopped by you' })
      touch(item, { status: 'idle' })
      return json({ ok: true })
    }
    if (action === 'approval') {
      const approval = (messages[item.id] ?? []).find((message) => message.approval?.id === body.approvalId)
      if (approval?.approval) {
        update(item.id, approval, { approval: { ...approval.approval, resolved: String(body.optionId) } })
        const rejected = String(body.optionId).startsWith('reject')
        if (rejected) {
          push(item.id, { role: 'assistant', turn: approval.turn, text: 'Understood — I won’t run that. The fix is in place; you can run the tests yourself with `go test -race -count=50 ./internal/auth/...`.' })
          touch(item, { status: 'idle' })
        } else {
          touch(item, { status: 'working' })
          const tool = push(item.id, { role: 'tool', turn: approval.turn, text: '', tool: { name: 'bash', title: 'Run auth tests 50 times', status: 'running', input: 'go test -race -count=50 ./internal/auth/...' } })
          later(item.id, 2200, () => update(item.id, tool, { tool: { ...tool.tool!, status: 'completed', output: 'ok  \tgithub.com/acme/api-gateway/internal/auth\t8.412s' } }))
          later(item.id, 2800, () => {
            push(item.id, { role: 'assistant', turn: approval.turn, durationMs: 4 * 60_000 + 12_000, text: 'Fixed. The tests raced the session-expiry ticker; they now use an injected fake clock instead of `time.Sleep`. **50/50 runs pass with `-race`.** Want me to open a PR?' })
            touch(item, { status: 'idle' })
          })
        }
      }
      return json({ ok: true })
    }
  }

  if (path === '/api/agent-kinds') return json([
    { id: 'claude', name: 'Claude Code', protocol: 'native' }, { id: 'codex', name: 'Codex', protocol: 'native' }, { id: 'gemini', name: 'Gemini CLI', protocol: 'acp' },
    { id: 'opencode', name: 'OpenCode', protocol: 'acp' }, { id: 'goose', name: 'Goose', protocol: 'acp' }, { id: 'copilot', name: 'Copilot CLI', protocol: 'acp' }, { id: 'cursor', name: 'Cursor Agent', protocol: 'acp' },
  ])
  const optionsMatch = path.match(/^\/api\/devices\/([^/]+)\/agents\/([^/]+)\/options$/)
  if (optionsMatch) return json(demoOptions(decodeURIComponent(optionsMatch[2])))
  const agentsMatch = path.match(/^\/api\/devices\/([^/]+)\/(agents|desktop)$/)
  if (agentsMatch && agentsMatch[2] === 'agents') {
    const id = agentsMatch[1]
    const installed: Record<string, string[]> = { macbook: ['claude', 'codex', 'gemini', 'opencode'], studio: ['claude', 'codex', 'gemini'], homelab: ['claude', 'codex', 'opencode'], office: [] }
    return json(['claude', 'codex', 'gemini', 'opencode', 'goose', 'copilot', 'cursor'].map((agent) => ({ id: agent, installed: (installed[id] ?? []).includes(agent), version: (installed[id] ?? []).includes(agent) ? { claude: '2.1.4', codex: '0.61.0', gemini: '0.12.0', opencode: '1.0.40' }[agent as 'claude'] : undefined })))
  }
  if (agentsMatch && agentsMatch[2] === 'desktop') {
    const id = agentsMatch[1]
    if (id === 'macbook') return json({ available: true, port: 5900 })
    if (id === 'studio') return json({ available: true, port: 5901 })
    return json({ available: false, port: 0, reason: id === 'office' ? 'Install a VNC server such as TightVNC.' : 'Install and start a VNC server, e.g. x11vnc -localhost -forever or wayvnc.' })
  }

  if (path === '/api/mcp-servers' && method === 'GET') return json(mcpServers)
  if (path === '/api/mcp-servers' && method === 'POST') {
    const server = { ...(body as unknown as McpServer), id: uid('mcp'), enabled: body.enabled !== false }
    mcpServers = [...mcpServers, server]
    return json(server)
  }
  const mcpMatch = path.match(/^\/api\/mcp-servers\/([^/]+)$/)
  if (mcpMatch) {
    const id = decodeURIComponent(mcpMatch[1])
    if (method === 'PATCH') { mcpServers = mcpServers.map((server) => server.id === id ? { ...server, ...body } as McpServer : server); return json(mcpServers.find((server) => server.id === id)) }
    if (method === 'DELETE') { mcpServers = mcpServers.filter((server) => server.id !== id || server.builtin); return json({ ok: true }) }
  }

  if (path === '/api/automations' && method === 'GET') return json(automations)
  if (path === '/api/automations' && method === 'POST') {
    const automation = { ...(body as unknown as Automation), id: uid('au'), createdAt: nowSec(), enabled: body.enabled !== false, nextRunAt: nowSec() + 3600 }
    automations = [...automations, automation]
    return json(automation)
  }
  const autoMatch = path.match(/^\/api\/automations\/([^/]+)(\/run)?$/)
  if (autoMatch) {
    const id = decodeURIComponent(autoMatch[1])
    const automation = automations.find((item) => item.id === id)
    if (!automation) return json({ error: 'automation not found' }, 404)
    if (autoMatch[2] && method === 'POST') {
      const response = await threadRoute('POST', '/api/threads', { prompt: automation.prompt, title: automation.name, deviceId: automation.deviceId, agent: automation.agent, cwd: automation.cwd, access: automation.access })
      const created = await response!.clone().json() as Thread
      created.automationId = automation.id
      const stored = threads.find((item) => item.id === created.id)
      if (stored) stored.automationId = automation.id
      automation.lastRunAt = nowSec()
      automation.lastThreadId = created.id
      return json(created)
    }
    if (method === 'PATCH') { Object.assign(automation, body); return json(automation) }
    if (method === 'DELETE') { automations = automations.filter((item) => item.id !== id); return json({ ok: true }) }
  }
  return null
}

// What a hub might discover from each CLI; shows how agents differ.
function demoOptions(agent: string) {
  const efforts = (ids: string[]) => ids.map((id) => ({ id, label: id === 'xhigh' ? 'Extra high' : id[0].toUpperCase() + id.slice(1) }))
  if (agent === 'claude') return {
    agent, source: 'discovered', defaultMode: 'default',
    models: [
      { id: '', label: 'Default', description: 'Opus for planning, Sonnet for the rest', default: true },
      { id: 'opus', label: 'Opus', description: 'Most capable for complex work', efforts: ['low', 'medium', 'high', 'max'] },
      { id: 'sonnet', label: 'Sonnet', description: 'Fast and capable for everyday work', efforts: ['low', 'medium', 'high'] },
      { id: 'haiku', label: 'Haiku', description: 'Fastest for quick tasks', efforts: [] },
    ],
    efforts: efforts(['low', 'medium', 'high', 'max']),
    fast: { label: 'Fast mode', description: 'Faster output on Opus; uses more of your plan' },
    modes: [
      { id: 'default', label: 'Ask before edits', description: 'Asks before changing files or running commands', kind: 'ask' },
      { id: 'acceptEdits', label: 'Accept edits', description: 'Edits files freely, asks before commands', kind: 'edits' },
      { id: 'plan', label: 'Plan', description: 'Explores and proposes a plan, changes nothing', kind: 'plan' },
      { id: 'auto', label: 'Auto', description: 'Claude decides what is safe to run', kind: 'auto' },
      { id: 'bypassPermissions', label: 'Bypass permissions', description: 'Never asks. Only on machines you trust', kind: 'full' },
    ],
  }
  if (agent === 'codex') return {
    agent, source: 'discovered', defaultMode: 'on-request',
    models: [
      { id: 'gpt-5.1-codex', label: 'GPT-5.1 Codex', description: 'Optimized for agentic coding', default: true, efforts: ['low', 'medium', 'high', 'xhigh'], defaultEffort: 'medium' },
      { id: 'gpt-5.1-codex-mini', label: 'GPT-5.1 Codex Mini', description: 'Cheaper and faster', efforts: ['medium', 'high'] },
      { id: 'gpt-5.1', label: 'GPT-5.1', description: 'Broad knowledge and reasoning', efforts: ['minimal', 'low', 'medium', 'high'] },
    ],
    efforts: efforts(['minimal', 'low', 'medium', 'high', 'xhigh']),
    fast: { label: 'Fast', description: 'Priority processing; uses more of your plan' },
    modes: [
      { id: 'read-only', label: 'Read only', description: 'Reads and answers, never writes', kind: 'readonly' },
      { id: 'plan', label: 'Plan', description: 'Proposes a plan before doing anything', kind: 'plan' },
      { id: 'on-request', label: 'Ask for approval', description: 'Works in the folder, asks before anything else', kind: 'ask' },
      { id: 'auto', label: 'Auto', description: 'Works in the folder; reviews risky steps itself', kind: 'auto' },
      { id: 'full-access', label: 'Full access', description: 'No sandbox, never asks', kind: 'full' },
    ],
  }
  if (agent === 'gemini') return {
    agent, source: 'discovered', defaultMode: 'default',
    models: [
      { id: '', label: 'Auto', description: 'Gemini picks per task', default: true },
      { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', description: 'Most capable' },
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', description: 'Fast and efficient' },
    ],
    efforts: [],
    modes: [
      { id: 'default', label: 'Default', description: 'Asks before edits and commands', kind: 'ask' },
      { id: 'autoEdit', label: 'Auto edit', description: 'Edits files without asking', kind: 'edits' },
      { id: 'plan', label: 'Plan', description: 'Read-only planning', kind: 'plan' },
      { id: 'yolo', label: 'YOLO', description: 'Approves everything', kind: 'full' },
    ],
  }
  return { agent, source: 'builtin', defaultMode: 'build', models: [{ id: '', label: 'Default', default: true }], efforts: [], modes: [
    { id: 'build', label: 'Build', description: 'Full tool access', kind: 'auto' },
    { id: 'plan', label: 'Plan', description: 'Read-only analysis', kind: 'plan' },
  ] }
}

function demoCommands(agent: string) {
  if (agent === 'codex') return [
    { name: 'review', description: 'Review the current changes and find issues' },
    { name: 'compact', description: 'Summarise the conversation to free context' },
    { name: 'diff', description: 'Show the git diff, including untracked files' },
    { name: 'init', description: 'Create an AGENTS.md with instructions for Codex' },
    { name: 'mention', description: 'Mention a file', hint: 'path' },
  ]
  if (agent === 'claude') return [
    { name: 'compact', description: 'Clear history but keep a summary in context', hint: 'instructions' },
    { name: 'review', description: 'Review a pull request', hint: 'PR number' },
    { name: 'init', description: 'Create a CLAUDE.md for this project' },
    { name: 'security-review', description: 'Security review of the pending changes' },
    { name: 'cost', description: 'Show token usage and cost for this session' },
  ]
  return [{ name: 'compact', description: 'Summarise the conversation' }]
}
