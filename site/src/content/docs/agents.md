---
lead: Overseer works with the coding agents you already use. Install one on a machine and it shows up, with its own models, thinking levels and modes, and the skills and plugins that extend it are all on one page.
---

## Supported agents

**Claude Code** and **Codex** are driven through their own protocols, so every native feature works: models, thinking, modes, forks, compaction, slash commands and plan limits.

Every other agent runs over the [Agent Client Protocol](https://agentclientprotocol.com), an open standard for talking to coding agents. That includes Gemini CLI, OpenCode, Goose, Copilot CLI, Cursor Agent, Devin, Amp, Cline, Qwen Code, Kimi, Auggie, Factory Droid, Grok and many more.

## Found for you

Overseer reads the official [ACP agent registry](https://agentclientprotocol.com/registry), and each machine reports which of those agents it has installed. Install a new agent on any machine and it appears in the agent picker with its icon, without an Overseer update.

**Settings → Agents** shows which machines have which agents, with versions, what else is available, and how to install it.

![Settings → Agents with the agents found on each machine](shot:agents-settings)

## Add your own

Any agent that speaks ACP can be added by hand: **Settings → Agents → Add your own**, then give it a name and the command that starts it. It then shows up in the agent picker on the machines where that command exists.

## Install and sign in

Open **Machines → Setup** and pick a machine to see which agent CLIs are installed and signed in. Overseer can install or repair Claude Code, Codex and Gemini CLI there, then open each provider's own login in a terminal on that machine.

> [!TIP]
> Agents use the login already on each machine. Credentials stay in each provider's own storage; Overseer never reads or stores them.

## Skills & plugins

The **Skills** page lists everything that extends your agents, per machine and per agent:

| Kind | Examples |
| --- | --- |
| Skills | Folders of instructions an agent loads when they're relevant |
| Plugins | Bundles from Claude Code and Codex marketplaces |
| Commands | The agent's own slash commands |
| Subagents | Helpers an agent can hand work to |
| Rules | `CLAUDE.md`, `AGENTS.md` and similar files |
| Hooks | Commands an agent runs at certain events |
| MCP servers | Tools an agent can call |

Turn any of them on and off, open one to read what it does, and see which agents share it.

![The Skills page with skills shared by Codex, Claude Code and Devin](shot:skills)

### One skill, every agent

Create a skill from a template and pick the agents that should use it, or share an existing skill with more agents. The skill lives in one place, `.agents/skills`, and the other agents link to it, so an edit applies to all of them.

Removing a skill never deletes it: it moves to a trash folder next to it.

### Plugin marketplaces

Browse Claude Code's and Codex's plugin marketplaces from the Skills page. Before installing, Overseer shows what a plugin adds (skills, MCP servers, hooks), and if it needs to run a command, you see that exact command first.

## Shared MCP servers

**Customize** holds MCP servers that every agent gets on every machine. Add a server once and new sessions of every agent can use it. When Overseer lists an agent's MCP servers, environment values, headers and tokens are removed on the machine before anything is sent to the hub.
