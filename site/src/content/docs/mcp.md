---
lead: Overseer is also an MCP server. Connect it to Claude Code, Codex, ChatGPT or any MCP client, and that agent can start and supervise other agents on every machine you own.
---

## Why

With the MCP tools, one agent can act as a lead: it picks a machine with free capacity, launches a worker agent there, checks on it, and reports back. Ask it things like:

> Launch Claude in ~/projects/api on the homelab box, have it fix the failing tests, and tell me when it's done.

## Local MCP

On the computer where your agent runs, sign in once with an API token from **Settings → API tokens**:

```sh
overseer fleet login --hub https://overseer.example.com --token YOUR_API_TOKEN
```

Then add Overseer to your agent:

```sh
claude mcp add overseer -- overseer mcp     # Claude Code
codex mcp add overseer -- overseer mcp      # Codex
```

Any other client that runs stdio MCP servers can use the command `overseer mcp`.

## Tools

| Tool | What it does |
| --- | --- |
| `list_devices` | Every machine, with CPU, memory, load and how many sessions are working |
| `list_sessions` | Sessions on one machine or all of them |
| `create_session` | Start a session, optionally running a command such as an agent |
| `send_input` | Type into a session |
| `read_output` | Read a session's recent output |
| `run_command` | Run a command and return its output |
| `kill_session` | End a session |
| `list_files` | List a folder on a machine |
| `read_file` | Read a file |
| `write_file` | Write a file |

`list_devices` is a best-effort snapshot to help choose a machine before `create_session`. Values a machine couldn't report are marked unavailable rather than shown as zero, and load averages aren't available on Windows.

## What delegated agents can do

When a lead agent starts a worker with `create_session`, the worker is an ordinary terminal session on that machine, running the command the lead chose, such as `claude` or `codex`. Know these four things before you hand over a token:

- **Workers get their own CLI's permissions, not the lead's.** Restrictions on the lead, like a plan or read-only mode, do not carry over. A worker starts with whatever that CLI does by default on that machine, plus any flags in its command.
- **The lead can answer the worker's prompts.** If a worker asks "allow this command?", the lead can reply with `send_input`. So a worker's approvals are only as careful as the lead. If you want to approve things yourself, tell the lead to stop and report instead of answering, and open the session in Overseer to answer it.
- **The token is the boundary.** An API token can run commands and write files on every machine through `run_command` and `write_file`. There is no read-only or per-machine token yet.
- **Everything stays visible.** Workers show up in Overseer's session list on their machine, so you can watch, steer or stop them like any other session.

> [!TIP]
> To keep a worker cautious, put the mode in its command, for example `claude --permission-mode plan` or `codex --sandbox read-only`, and ask the lead to report back before making changes.

## Remote MCP

The hub also serves the same tools over HTTP at `/mcp`, so clients with remote MCP connectors, such as ChatGPT, Claude and Cursor, can drive your fleet directly.

1. Put the hub on HTTPS. See [Remote Access](/docs/remote-access/).
2. Create an API token in **Settings → API tokens**.
3. In your client, add a connector for `https://overseer.example.com/mcp` and give it the token as a Bearer credential.

> [!WARNING]
> This is a remote shell. `run_command` and `write_file` run commands and write files on your machines. The endpoint refuses requests without a valid token and must only be exposed over HTTPS. Treat the token like an SSH key, and rotate it in Settings if it leaks.
