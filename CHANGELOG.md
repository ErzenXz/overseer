# Changelog

What changed in each Overseer release. Installed hubs and machines update to
the newest release on their own; see [Settings → General](docs/guide.md#keeping-devices-up-to-date).

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
