---
lead: Overseer is a control room for your coding agents. Run Claude Code, Codex, Gemini, Devin and any ACP agent on every computer you own, and see which ones are working, which need you and which are done, from one browser tab.
---

## What it is

Most people who use coding agents end up with several of them running at once: one fixing tests on a desktop, one building a feature on a laptop, one on a homelab box or a cloud VM. Each lives in its own terminal, and you only find out one is waiting for you when you happen to look.

Overseer puts all of them in one place:

- **Every session, one list.** Sessions from every machine sit in one sidebar, each marked working, waiting, done or failed.
- **Answer from anywhere.** When an agent asks to run a command, you approve it in the thread, from your desk or your phone.
- **Sessions keep running.** Agents run on the machine, not in your browser. Close the tab and come back later; the session is where you left it.
- **Everything about the machine, beside the chat.** A live preview of the dev server, the machine's shell, its remote desktop, its files and the session's changes.

## Find your way around

A slim icon rail runs down the left edge, and the panel beside it lists your sessions. Hover an icon to see its name.

- **At the top:** **New session**, **Sessions**, **Automations**, **Review**, **Agent Arena**, **Machines** and **Mission control**.
- **Then:** **Skills & plugins**, **Projects** and **Customize**.
- **At the bottom:** search, notifications, help and **Settings**.
- **The Overseer logo** opens a menu with **Settings**, **Add a machine**, **New terminal**, **Agent Wrapped**, the theme and **Log out**.

Press <kbd>⌘</kbd> <kbd>B</kbd> to hide the sessions panel and show it again.

## How it fits together

Overseer has three parts, and all of them are the same `overseer` binary.

- **The hub** runs on one computer that stays on most, like a desktop, a home server or a small VM. It serves the web app and keeps your sessions, settings and history in a local SQLite database.
- **Machines** are every computer you add, including the hub itself. Each one runs a small background service that opens one outbound connection to the hub. Nothing new listens on the machine.
- **Agents** are the coding CLIs already installed on each machine. Overseer starts them, talks to them in their own protocols, and uses the login each CLI already has.

```text
  Browser or phone ── HTTPS ──►  Hub  (web app, API, SQLite)
                                  ▲
               one outbound connection per machine
            ┌─────────────────────┼─────────────────────┐
         laptop                studio                homelab
     Claude Code, Codex      Codex, Gemini        Claude Code, Devin
```

Terminal output, file transfers, previews and the remote desktop all travel over that single connection, so machines can sit behind NAT or a firewall without any changes.

> [!TIP]
> There is no Overseer account and no Overseer cloud. Everything runs on computers you own, and nothing about your code leaves your network unless an agent you started sends it.

## What you need

- A computer for the hub: **Linux** (with systemd), **macOS**, or **Windows 10/11** or Server 2016+. Intel and ARM are both fine.
- At least one coding agent CLI on a machine, signed in. Overseer can install and sign in to Claude Code, Codex and Gemini CLI for you from the **Setup** tab.
- A browser. The web app works on a phone too.

## Where to go next

- [Quick Start](/docs/quick-start/) installs the hub and adds your first machine.
- [Sessions](/docs/sessions/) covers models, modes, approvals, sending later and sharing a session.
- [Agent Arena](/docs/arena/) races several agents on the same task so you keep the best result.
- [Mission Control & Wrapped](/docs/mission/) puts every agent on one wall and recaps your week.
- [Teams & Chat Apps](/docs/teams/) lets more people use one hub, and lets you answer agents from Telegram, Slack or Discord.
- [Remote Access](/docs/remote-access/) shows how to reach the hub safely from outside your home network.
- [Command Line](/docs/cli/) and [MCP & Agents](/docs/mcp/) let scripts and other agents drive your fleet.
