---
lead: A session is one conversation with one agent on one machine. It runs on that machine, so it keeps going when you close the tab, and you can pick it up again from any device.
---

## Start a session

Click **New session** (or press <kbd>⌘</kbd> <kbd>⇧</kbd> <kbd>O</kbd>), write what you want, and pick the agent. Press <kbd>Enter</kbd> to send, or <kbd>Shift</kbd> <kbd>Enter</kbd> for a new line.

## Where it runs

Next to the send button, Overseer always shows where the session will run: the machine, the folder and its git branch, such as **Studio · ~/code/api · main**. Click it to change any of them.

- **Machines are tabs.** The picker has one tab per machine along the top. A machine that isn't connected is dimmed and says when it was last seen, like "last seen 2 hours ago".
- **Folders are one-line rows.** Under the tabs are that machine's recent folders, each with its branch. Click one to choose it. Type to search folders on every machine at once, or type a path.
- **Three ways out at the bottom.** **Home folder** uses the machine's home folder, **Browse…** walks through the machine's folders, and **From GitHub…** starts from a repo (see below).
- **Offline machines are obvious.** If the machine you picked is offline, a warning under the message box says so. You can't start work on it by accident, and Overseer never switches to another machine on its own.
- **Sessions remember their machine.** Every session shows its machine, folder and branch in its header and in the sidebar, even after you pick a different machine for new work.

### Start from GitHub

Choose **From GitHub…**, pick one of your repos, then pick a branch. To use a repo that isn't in your list, paste `owner/name` or a link to it. The branch list shows open pull requests and marks the default branch; type a name to use a branch that isn't listed.

The machine comes from the tabs. Under the repo name the picker says **Uses your clone** or **Clones it** on that machine. Overseer gets the branch ready before the agent starts. If the machine already has a clone, it uses it; if that clone is on another branch, it adds a separate folder (a git worktree) so your own checkout and uncommitted changes are never touched. With no clone, it clones the repo into your usual code folder.

Repos and branches are read with the GitHub CLI (`gh`) on one of your machines. The name at the top of the list shows which one; click it to use another. If `gh` isn't installed or signed in there, the picker says so and can run `gh auth login` for you.

If the connection drops just as you start a session, Overseer checks whether it actually started. It then tells you it started, that it **didn't start**, or that the **start status is unknown**. Retrying is always safe: a retry can never start the same work twice.

## Attach files and images

Drag files or images onto the message box, paste a screenshot, or click **+**. Each file shows as a chip while it uploads to the machine, and Send waits until uploads finish. Images go to the agent as images; other files are passed by path. Files land in `.overseer/uploads` in the session's folder, which is kept out of git. Files can be up to 25 MB, and up to 10 per message.

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

## Send later

The small arrow on the right of the send button starts a session later instead of now.

| Choice | What it does |
| --- | --- |
| **Send now** | Starts it right away, like pressing the button |
| **Send when my limit resets** | Starts it when your plan's limit resets. Only shown when that limit is at 90% or more and Overseer knows when it resets |
| **Tonight at…** and **Tomorrow at…** | Start it at 1 AM tonight or 9 AM tomorrow |
| **Pick a date and time…** | Start it at a time you choose |

Sessions waiting for their time sit in a **Scheduled** group in the sessions panel, which only shows when something is waiting. Each row has buttons to **Start now**, **Edit** and **Cancel**. Edit lets you change the prompt, the agent and when it starts.

The machine must be online when the time comes. If it isn't, the row says so and the session starts once the machine is back. If the limit hasn't actually reset yet, Overseer waits for the next reset. A session that couldn't start stays in the list with the reason, and you can try again. Starting is safe to retry: a scheduled session can never run twice.

## Approvals

When an agent wants to do something its mode doesn't allow, the session turns **waiting** and the request appears in the thread with the exact command or edit. Choose **Allow once**, **Always allow** or **Reject**.

Waiting sessions are hard to miss:

- They move to a **Needs you** group at the top of the sidebar.
- The browser tab shows how many are waiting, like **(2) Waiting · Overseer**, and its icon gets an amber dot.
- You get a notification when an agent finishes or needs you, and a reminder if it's still waiting after 5 and 30 minutes. Click a notification to jump straight to that session. Turn notifications on in **Settings → Notifications**; they work on phones too.

> [!TIP]
> Agents also ask questions of their own, like which of two approaches to take. Those appear as a short form in the thread; answer it and the agent continues.

## While it works

While the agent works, one quiet line at the bottom says what it's doing right now, like "Running go test ./… · 12s" or "Reading auth.go". When the turn ends, its steps fold into one line, such as **Worked for 2m 10s · 12 steps · +100 −5**. Open it to see each step on its own line, and open a step for its output or diff. Its thinking shows as a short "Thought for 7s".

**Subagents.** When Claude Code or Codex hands work to subagents, each one gets its own row: its type, its task, and whether it's running, done or failed, with how long it took. Open a subagent to see its steps and what it reported back.

- **Steer**: send a message while the agent is working and it reads it at the next step.
- **Queue**: line up a follow-up that runs when the current turn ends.
- **Stop**: end the current turn without closing the session.

If you scroll up to read something while a reply streams, Overseer keeps your place instead of jumping to the bottom.

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

- **Copy**, **Edit** or **Retry** one of your messages.
- **Continue in new session** on an agent reply starts a new session from that point, with everything before it.
- **Continue in another agent** on an agent reply hands the work to a different agent (see below).

The **⋯** menu at the top right of a session has **New child session**, **Compact conversation** and **Undo last turn**, for the agents that support them. Undo removes the last turn.

## Continue in another agent

When one agent is stuck, or you've run out of its limit, you can carry on with a different one. Choose **Continue in another agent…** from the session's **⋯** menu, from a session's right-click menu in the sidebar, or from an agent reply to continue from that point.

1. Pick the agent. Overseer suggests another one that's installed on the same machine.
2. Overseer writes a handoff prompt from the conversation: the goal, what was done so far, the files changed, the plan and the last error. A line above it says what went in, such as "6 turns · 4 files changed · last error included".
3. Edit the prompt if you like, then click **Start in** the agent's name.

The new session runs on the same machine and folder. The original session stays as it is, and each shows a link to the other: **Continued from** and **Continued in**.

## Share a session

Open a session's **⋯** menu and choose **Share…** to make a link. Anyone with the link can watch the session without signing in. They can't send messages, approve anything or see your other sessions.

| Option | What it does |
| --- | --- |
| **Replay** | The session as it is now, with a player to watch it back. Frozen: nothing that happens next is included |
| **Live** | View only. Follows the session in real time, including turns you haven't sent yet |
| **Hide machine and folder names** | On by default. Shows "the machine" and shortened paths instead |
| **Link expires** | After 1 day, 7 days (the default) or never |

The full link is shown once, when you create it, so copy it then. Keys and passwords that Overseer recognises are hidden, but that is best effort. Look the session over first: anything the agent printed is visible to whoever opens the link.

To turn a link off, open **Settings → Shared links**. It lists each link with its kind, when it was made, how many times it was viewed and when it expires. **Revoke** stops it working at once.

> [!WARNING]
> Only people who can reach your hub can open a link. If your hub is at a private address, such as a Tailscale name or `localhost`, the dialog says so. To share with anyone, give your hub a public address first. See [Remote Access](/docs/remote-access/).

## Usage and limits

The ring next to the send button shows how full the context window is. Click it to see this session's tokens and cost, your plan's rolling limits for that agent, and a **Compact** button.

![The usage popover with context, session tokens and plan limits](shot:usage)

**Settings → Usage & Limits** shows every plan's limits per machine: Claude Code's 5-hour, weekly and weekly Opus windows and Codex's windows, with how much is used and when each resets. Overseer reads them from the CLIs themselves, without sending prompts or spending tokens.

### Guardrails

Guardrails keep a subscription from running dry. In **Settings → Usage & Limits → Guardrails**, each of Claude Code and Codex has two switches. Both are off until you turn them on, and both watch the weekly limit.

| Guardrail | Default | What it does |
| --- | --- | --- |
| **Hold new sessions at** | 90% | A new session waits in **Scheduled** and starts when the limit resets |
| **Pause running sessions at** | 98% | Stops the current turn, like the Stop button. Sessions are never ended |

Change the percentage next to each switch; it saves by itself. When a guardrail acts, an amber **Guardrails** group appears in the sessions panel and you get a notice. It stays until you dismiss it. Claude's weekly Opus limit only counts for sessions that use Opus.

## Organise

Right-click a session in the sidebar, or use the buttons that appear on hover, to **pin**, **rename**, move it to a **folder** or **archive** it. Archived sessions are kept and can be restored.
