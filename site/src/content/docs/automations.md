---
lead: Automations run a prompt on a schedule, on the machine and folder you choose, with the agent, model and mode you pick. Review lists your open pull requests with an agent one click away.
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

> [!TIP]
> Give an automation a mode with as little access as the job needs. A digest only needs Read only; a dependency update needs to edit files and run tests.

## Review

**Review** lists your open pull requests and the ones waiting for your review, read with the GitHub CLI (`gh`) on one of your machines. Filter by repository, or paste any pull request link.

On each pull request, **Review** starts an agent session that reviews it, and **Fix** starts one that works on it. If `gh` isn't signed in yet, Review offers to run `gh auth login` on the machine.

![Review, with open pull requests](shot:review)
