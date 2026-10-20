---
lead: A session is one conversation with one agent on one machine. It runs on that machine, so it keeps going when you close the tab, and you can pick it up again from any device.
---

## Start a session

Click **New session** (or press <kbd>⌘</kbd> <kbd>⇧</kbd> <kbd>O</kbd>), write what you want, and choose:

- **Machine**: any connected computer.
- **Folder**: where the agent works. Recent folders on that machine are suggested.
- **Agent**: every agent Overseer found on that machine. See [Agents & Skills](/docs/agents/).

Press <kbd>Enter</kbd> to send, or <kbd>Shift</kbd> <kbd>Enter</kbd> for a new line. You can paste or drop images and files; they are copied to the machine so the agent can read them.

![A Claude Code session asking for approval before it runs a command](shot:approval)

## Model, thinking and mode

The controls under the message box come from the agent itself, so each agent shows what it really supports.

- **Model**: the models that agent offers, such as Opus, Sonnet or Haiku for Claude Code.
- **Thinking**: how much the model reasons before answering, from minimal to high.
- **Fast**: priority output on models that support it. It uses more of your plan.
- **Mode**: how much the agent may do without asking.

Press <kbd>Shift</kbd> <kbd>Tab</kbd> in the message box to cycle through the modes. The common ones are:

| Mode | What the agent may do |
| --- | --- |
| Read only | Read files and answer, never write |
| Plan | Explore and propose a plan, change nothing |
| Ask before edits | Ask before changing files or running commands |
| Accept edits | Edit files freely, ask before commands |
| Auto | Decide for itself which steps are safe |
| Full access | Never ask. Only use this on machines you trust |

Names differ a little per agent: Codex calls its ask mode "Ask for approval", for example.

## Approvals

When an agent wants to do something its mode doesn't allow, the session turns **waiting** and the request appears in the thread with the exact command or edit. Choose **Allow once**, **Always allow** or **Reject**.

Waiting sessions stand out in the sidebar, and you get a notification when an agent finishes or needs you, so you can leave several running and only look when one asks.

> [!TIP]
> Agents also ask questions of their own, like which of two approaches to take. Those appear as a short form in the thread; answer it and the agent continues.

## While it works

- **Steer**: send a message while the agent is working and it reads it at the next step.
- **Queue**: line up a follow-up that runs when the current turn ends.
- **Stop**: end the current turn without closing the session.

Every reply renders as it streams: tables, highlighted code, math and diagrams. If you scroll up to read something, Overseer keeps your place instead of jumping to the bottom.

## Slash commands

Type <kbd>/</kbd> in an empty message box to see commands. The agent's own commands come first, followed by Overseer's:

| Command | What it does |
| --- | --- |
| `/plan` | Make a plan and wait for your go-ahead before changing anything |
| `/review` | Review uncommitted changes for bugs and risky edits |
| `/test` | Run the test suite and fix what fails |
| `/pr` | Commit the work on a new branch and open a pull request |
| `/explain` | Tour the codebase and its entry points |
| `/fix-ci` | Reproduce and fix failing CI checks |
| `/compact` | Summarise the conversation to free up context |

Use <kbd>↑</kbd> <kbd>↓</kbd> to choose and <kbd>Enter</kbd> or <kbd>Tab</kbd> to pick.

## Fork, undo and retry

Hover a message to see its actions:

- **Copy**, **Edit** or **Retry** a message.
- **Fork** starts a new session from that point, with everything before it.
- **Undo** removes the last turn.
- **Continue in a new session** carries the context into a fresh one.

## Usage and limits

The ring next to the send button shows how full the context window is. Click it to see this session's tokens and cost, your plan's rolling limits for that agent, and a **Compact** button.

![The usage popover with context, session tokens and plan limits](shot:usage)

**Settings → Usage & Limits** shows every plan's limits per machine: Claude Code's 5-hour, weekly and weekly Opus windows and Codex's windows, with how much is used and when each resets. Overseer reads them from the CLIs themselves, without sending prompts or spending tokens.

## Organise

Right-click a session in the sidebar, or use the buttons that appear on hover, to **pin**, **rename**, move it to a **folder** or **archive** it. Archived sessions are kept and can be restored.
