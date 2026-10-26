# Changelog

What changed in each Overseer release. Installed hubs and machines update to
the newest release on their own; see [Settings → General](docs/guide.md#keeping-devices-up-to-date).

## v0.5.0 — 2026-10-26

Teams, a race between agents, a live wall for everything running, start a
session from any GitHub repo, sign in to agents without leaving Overseer, and a
calmer app from top to bottom.

### New
- **Start from anywhere.** Pick the machine and folder under the composer, or
  start straight from a GitHub repository and branch. Overseer clones it, or
  checks it out in its own worktree, so what you were already working on is
  never touched. Folders on a machine are found for you, and a machine that
  drops off says when it was last seen. A start that fails or gets cut off can
  be retried without creating the session twice.
- **Attach files and images.** Pick, paste or drag them onto the composer.
  Images go to agents that read them; other files land in the session's folder.
- **Sign in to agents inside Overseer.** Overseer now checks whether Claude
  Code and Codex are signed in. **Signed out** shows on the Agents tab and above
  the composer, and **Sign in** opens a terminal in a dialog that notices when
  it worked. An error like `unauthorized (401)` becomes a plain card with a
  **Sign in** button and **Resume session**. Usage limits and network errors get
  their own short explanations, with the original text under **Details**. When
  no agent on a machine is ready, the new-session page walks you through the
  first one.
- **Agent Arena.** Give one task to several agents. Each races in its own copy
  of the repo, you watch them side by side, compare what they changed, run a
  check command on every result, and keep the winner.
- **Mission control and Agent Wrapped.** A live wall of every session, grouped
  by what needs you, with each machine's CPU and memory and a TV mode for a
  spare screen. **Agent Wrapped** is a shareable recap of what your agents got
  done.
- **Share a session.** Send a link to a replay, or let someone watch live,
  view only. Machine and folder names are hidden by default, secrets Overseer
  recognises are masked, and links can expire or be revoked in **Settings →
  Shared links**.
- **Send later and guardrails.** Start a session tonight, tomorrow, at a time
  you pick, or when your plan limit resets. Optional guardrails hold new
  sessions at 90% of a weekly limit and pause running ones at 98%. Waiting
  sessions sit in **Scheduled** and can be started, edited or cancelled.
- **Continue in another agent.** When one agent is stuck or out of limit, hand
  the session to another on the same machine and folder, with a handoff prompt
  written from the conversation. Each session links to the other.
- **Approve from chat.** Get approvals and finished sessions in Telegram, Slack
  or Discord, answer them there, or send them to a webhook.
- **Issue autopilot.** Label a GitHub issue and an agent works on it and opens a
  pull request. Choose who may trigger it and see every run.
- **Before and after.** The Changes tab captures screenshots of your running
  app before and after a session's edits.
- **Cloud machines.** Create a server at Hetzner Cloud or DigitalOcean from
  **Machines → Add machine**. It installs the agent and the tools you pick and
  joins your hub by itself.
- **Recipes.** Share an automation as a link; open one to add it to your hub.
- **Teams.** More than one person on a hub, with owner, member and viewer roles,
  invites, who is looking at a session, hand-offs between people and an
  activity log. Your existing password becomes the first owner (**Admin**).
- **`overseer top`.** An htop-style view of every machine and session in your
  terminal, plus `overseer status` for a one-line summary.
- **Keyboard shortcuts everywhere.** Go to any page with a two-key chord, open
  workspace tabs with Alt+1 to 6, stop an agent, and press **?** for the full
  list. They also show in the command palette.
- **One-click remote desktop setup.** Opening the Desktop tab on a machine that
  isn't ready offers a guided install instead of an error.
- **Alerts when an agent needs you.** A browser notification and the tab title
  tell you when a session is waiting for an approval.
- **Agent updates.** When a newer Claude Code, Codex, Gemini CLI or OpenCode is
  out for a machine, a card under the Overseer update offers to update it. Each
  agent updates itself the way it was installed. An agent that has a session
  running is never touched: its update waits and starts by itself when the
  session ends. Turn on **Update automatically** to keep them current in the
  background.
- **Update notice with the changelog.** A quiet card in the sidebar shows when
  a new version is out and what changed in it.

### Improved
- **A calmer layout.** A slim icon rail and a sessions panel replace the long
  sidebar. Spacing is the same everywhere, the green status dots are gone, and
  machines show their real operating system.
- **A simpler composer.** Agent, mode, usage and send sit in one row. The folder
  and machine live in a tray under it, like the model menu. The agent, thinking
  and mode menus fold down gracefully when the workspace panel is open.
- **Easier-to-read sessions.** Steps are grouped under one line, with subagent
  work shown as its own nested tree, and details open on request.
- **Session header.** One **i** button holds the agent, machine, folder, branch
  and pull request. With the workspace panel closed the actions sit on the
  right; with it open they move next to the title and the panel runs to the
  top of the page.
- **Live previews.** Previews now load inside the panel (the sign-in cookie was
  being dropped in the frame) and the picker lists only dev servers started in
  the session's folder, not every port on the machine. Other servers sit behind
  one **Other servers** row.
- **Docs.** Twelve pages written from the guide, including Arena, Mission
  control, Teams and chat apps, and Keyboard shortcuts.
- **A new logo and icons** across the app, the site and the install page.
- Delegated agents (the MCP `create_session` tool) now explain what a
  delegated session can and can't do.

### Fixed
- Images and files could not be uploaded to a session.
- The workspace terminal no longer logs an error when it is resized.
- Opening the workspace panel no longer squeezes the composer's mode menu down
  to an icon.
- The same error repeated by an agent now shows once instead of several times.

### Security
- Shared session links are read only, hide machine details by default and can
  be revoked. Preview and shared pages are sent with strict frame and content
  rules.
- Every action on a team hub is attributed to a person in the activity log.

### Upgrading
- Everyone signs in again once, because the hub restarts to update. Existing
  hubs get an owner called **Admin** from your current password; rename it in
  **Settings → People**.
- Nothing needs to change on your machines; they update with the hub.

## v0.4.0 — 2026-10-20

Skills and plugins for every agent in one place, your real plan limits, every
ACP agent found automatically, and a round of polish.

### New
- **Skills & plugins.** A new page shows what extends each agent on each
  machine: skills, plugins and marketplaces, slash commands, subagents, rules
  files (CLAUDE.md, AGENTS.md…), hooks and MCP servers, for Claude Code, Codex,
  Devin and more. Turn things on and off, see which agents share a skill, and
  open any of them to read what it does.
- **One skill, every agent.** Create a skill from a template and pick the
  agents that should use it; share an existing skill with more agents. It
  stays in one place (`.agents/skills`) and the others link to it, so edits
  apply everywhere.
- **Browse and install plugins** from Claude Code’s and Codex’s marketplaces.
  Overseer shows what a plugin adds (skills, MCP servers, hooks) and asks
  before anything runs code.
- **Plan limits.** Settings → Usage & Limits shows each subscription’s rolling
  limits per machine: Claude Code’s 5-hour, weekly and weekly Opus limits, and
  Codex’s windows, with percent used and when they reset. They come straight
  from the CLIs on your machines (no prompts, no tokens spent) and running
  sessions keep them current.
- **Usage at a glance.** The ring next to the send button opens your context
  window, this session’s tokens and cost, and the plan limits for that agent.
  Compacting is now a button in there, not something a stray click does.
- **Any agent, detected automatically.** Overseer reads the official
  [ACP agent registry](https://agentclientprotocol.com/registry) (Devin, Amp,
  Kimi, Qwen Code, Cline, Auggie, Factory Droid, Grok and 30+ more) and each
  machine reports which ones it has. Install one and it shows up in the agent
  picker with its icon, no Overseer update needed.
- **Your own agents.** Settings → Agents → Add your own: any ACP agent by name
  and command.
- **Automations pick the model.** Choose the model, thinking level, fast mode
  and the agent’s mode for each automation; scheduled runs start in Auto.

### Improved
- **Settings → Agents** shows which machines have which agents (with
  versions), what else is available, and how to install it.
- **Clear update diagnostics.** A hub running under your own systemd or launchd
  service is no longer called “started by hand”. Settings → General lists
  exactly what’s missing for automatic updates and gives a ready-to-paste fix;
  the guide has a new [Custom services](docs/guide.md#custom-services) section.
- The home composer sits centred on the page.

### Fixed
- Side menus (agent, thinking, folder…) open on hover even when the menu is
  long enough to scroll or sits in a dialog.
- Dialogs cover the whole app, sidebar included; menus inside them always
  appear on top.

## v0.3.0 — 2026-10-20

Live previews of what your agents build, every native agent feature, and a
cleaner composer.

### New
- **Live previews.** When an agent starts a dev server, open the session’s
  Preview tab and watch it update as it works, from any device, hot reload
  included. Each preview gets its own private address
  (`https://5173-machine.yourdomain.com`), and links to `localhost` in replies
  open there. No domain? `overseer forward <machine> <port>` puts it on your
  own `localhost`.
- **Models, thinking and modes.** Pick the model, thinking level, fast mode
  and each agent’s own modes (plan, ask, auto, full access…), discovered from
  Claude Code, Codex and ACP agents on each machine. Shift+Tab cycles modes.
- **Native session features.** Fork from any message, compact, undo the last
  turn, steer a running agent or queue a follow-up, attach images, use the
  agent’s own slash commands, and answer the questions it asks.
- **Organise sessions.** Pin, folders, archive and rename, from a right-click
  menu or the buttons that appear on hover.
- **Message actions.** Copy, edit, retry, or continue in a new session.

### Improved
- **Replies render properly while they stream**: tables, highlighted code,
  math and diagrams.
- Scrolling up while an agent streams keeps your place.
- A new, much shorter README with screenshots; the full guide lives in
  [docs/guide.md](docs/guide.md). The site and installers moved to
  [overseer.sh](https://overseer.sh).

### Security
- Cookie-authenticated changes must come from the hub itself (CSRF guard),
  including behind reverse proxies that rewrite the Host header.

## v0.2.0 — 2026-10-20

Overseer becomes a control room for your coding agents.

### New
- **Agent sessions.** Start Claude Code, Codex, Gemini, OpenCode, Goose,
  Copilot or Cursor on any machine from one chat box; steps fold into
  “Worked for 2m”, edits show as diffs, and you approve actions inline.
- **Remote desktop** for every machine, tunnelled through the agent so VNC is
  never exposed.
- **Automations** run a prompt on a schedule; **MCP servers** are shared with
  every agent; **Review** lists your pull requests.
- A new landing page and the Orbit icon.

### Improved
- **Safer installers and self-healing updates on every OS**: downloads are
  checksum-verified, a bad release rolls itself back, and Windows updates swap
  the binary safely.
- A rebuilt interface with a session-first sidebar, command palette and
  machine setup page.

## v0.1 — 2026-07

The first versions: one hub, devices that join with a single pasted command,
tmux terminals that survive disconnects, a fleet dashboard, file browser, CLI
and MCP server (local and remote over HTTPS), Linux/macOS/Windows installers
and automatic updates.
