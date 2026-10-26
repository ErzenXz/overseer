---
lead: Automations run a prompt on a schedule, on the machine and folder you choose, with the agent, model and mode you pick. Issue autopilot turns labelled GitHub issues into pull requests, and Review lists your open pull requests with an agent one click away.
---

## Create an automation

Open **Automations** and click **Create automation**, or start from a suggestion. Each automation has:

- **A prompt**: what the agent should do each time.
- **A machine and folder**: where it runs.
- **An agent, model, thinking level and fast mode**, the same choices as a session.
- **A mode**. Scheduled runs start in **Auto** so they don't stop to ask, and you can choose another.
- **A schedule**.

Every run is an ordinary session, so you can open it, read what the agent did, and continue the conversation.

![Automations with suggested schedules](shot:automations)

## Schedules

Pick a preset or write any cron expression:

| Preset | Cron |
| --- | --- |
| Every hour | `0 * * * *` |
| Every day at 9:00 | `0 9 * * *` |
| Weekdays at 9:00 | `0 9 * * 1-5` |
| Mondays at 9:00 | `0 9 * * 1` |
| Sundays at 3:00 | `0 3 * * 0` |

Times use the hub's local time. Click **Run** on any automation to try it without waiting.

## Suggestions

Overseer suggests automations for common chores:

- **Fix CI failures** every two hours on your open pull requests.
- **Weekly dependency update** with tests and a pull request.
- **Morning repo digest** of yesterday's commits, pull requests and issues.
- **Security audit** and **Secret scan** for vulnerabilities and leaked keys.
- **Clean disk space**, clearing only caches and build output that rebuild themselves.
- **Update coding agents** nightly.
- **Keep the README honest** and **Release notes draft**.
- **Triage new issues**, **Weekly changelog draft**, **Dead code sweep**, **Bump Node/Go version**, **Flaky test hunter**, **Docs drift check**, **License/header check** and **Upgrade lint rules**.

Filter the suggestions by category: **Maintenance**, **CI/CD & Release**, **Security** or **Fleet**.

> [!TIP]
> Give an automation a mode with as little access as the job needs. A digest only needs Read only; a dependency update needs to edit files and run tests.

## Share an automation as a link

Any automation, and any suggestion, can be shared as a recipe link. Choose **Share as link** from an automation's **⋯** menu, or click the link icon on a suggestion.

You get two links:

- **For people on this hub** opens the import page on this hub.
- **For any hub** opens `overseer.sh`, which sends people on to their own hub.

A recipe holds only the name, schedule, prompt and hints about the agent, model and mode. It never includes a machine, a folder, an access setting or a secret. **See exactly what the link contains** shows the whole thing.

### Add one from a link

Choose **Create automation → From a link…**, paste the link, or open it directly. The import page:

1. Shows **Exactly what it will tell the agent to do**: the full prompt, in a box. Read it as you would a script from the internet.
2. Lists things to know before you add it, like "Can push code, open pull requests or publish" or "Runs in Auto mode".
3. Lets you pick the machine, folder, agent and mode. A mode hint is only a hint; with none, it starts read-only.
4. Adds it when you click **Add automation**. **Turn it on right away** is on by default; switch it off to keep it saved.

Opening a link never runs anything. The automation only runs on its schedule once you've added it. Links that carry unknown fields or what looks like a key or token are refused.

## Issue autopilot

Issue autopilot works on GitHub issues for you. Label an issue `overseer`, and an agent picks it up on a free machine and opens a pull request. It never merges anything.

Open **Automations → Issue autopilot** and click **Add a repo**. Nothing is watched and nothing runs until you do, and you confirm that you understand an agent will run on your machine for each issue it picks up.

| Setting | What it does |
| --- | --- |
| **Repo** | One of your repos, or any `owner/name` |
| **Trigger label** | The label that starts a run. The default is `overseer` |
| **Watches GitHub from** | The machine whose GitHub CLI (`gh`) looks for labelled issues. No webhook needed |
| **Who can trigger it** | See below |
| **Runs on** | A machine that already has a clone, or any online machine with a clone (the least busy one) |
| **At the same time** | One to five issues at once |
| **Agent and mode** | Starts in **Auto** unless you choose otherwise, because nobody is there to approve each step |
| **Comment when it starts** | Posts a "Working on this in Overseer" comment on the issue |
| **“Built with Overseer” in the pull request** | A one-line footer with a link |

Overseer checks GitHub about every two minutes. **Check now** looks straight away, and the switch pauses a repo.

### Who can trigger it

Issues are written by other people, and the agent runs code on your machine, so Overseer looks at **who added the label**:

- **The owner and collaborators with write access** is the default and recommended.
- **Only me** accepts only labels added by the account signed in to GitHub on that machine, or by the repo's owner.

A label from anyone else never starts a run on its own. The issue shows as **Needs your OK** under **Issues handled**, and nothing happens until you click **Run anyway**.

### What a run does

- **It never clones for you.** The machine must already have a clone of the repo.
- **Your checkout stays untouched.** Each issue gets its own git worktree on a new branch named `overseer/issue-<number>-<title>`.
- **It ends in a pull request.** The pull request body starts with `Fixes #<number>`, so merging it closes the issue.
- **It labels the issue** `overseer:working` while it runs, then `overseer:done` when the pull request is open, or `overseer:failed` if it couldn't finish. Overseer creates these labels for you.

Every run is an ordinary session you can open from **Issues handled**. A run that failed has **Retry**, and one in progress has **Stop**. The session also shows an **Issue #** chip linking back to GitHub.

## Review

**Review** lists your open pull requests and the ones waiting for your review, read with the GitHub CLI (`gh`) on one of your machines. Filter by repository, or paste any pull request link.

On each pull request, **Review** starts an agent session that reviews it, and **Fix** starts one that works on it. If `gh` isn't signed in yet, Review offers to run `gh auth login` on the machine.

![Review, with open pull requests](shot:review)
