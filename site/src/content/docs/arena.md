---
lead: Agent Arena gives the same task to two to four agents at once. Each one works in its own copy of your repo, you compare the results side by side, and you keep the best one.
---

## Set up an arena

Click **Agent Arena** in the icon rail. Then:

1. **Write the task.** Say what the agents should do, like "fix the flaky auth tests, keep the change small". Press <kbd>⌘</kbd> <kbd>Enter</kbd> to start.
2. **Choose the agents.** You start with two, such as Claude Code **vs** Codex. Click **Add** for up to four. Each agent has its own model and thinking level, so you can also race one agent against itself with different settings.
3. **Pick the repo.** Use the machine and folder button at the bottom left. The folder must be a git repository.
4. **Set a check (optional).** A command Overseer runs in each copy when its agent finishes, like `npm test` or `go test ./...`.
5. **Choose permissions.** The same levels as a session: **Ask**, **Accept edits**, **Auto** or **Full access**. Arena starts in **Auto**, so the agents don't stop to ask.

If another online machine has a clone of the same repo, a machine button appears on each agent. Use it to run that agent on a different computer.

> [!TIP]
> A check makes the comparison fair. Without one you're judging on the diff alone; with one, each result shows whether it passes.

## Every agent gets its own copy

Agents never touch your own checkout. Overseer makes a separate git worktree for each one, at the same commit, on its own branch:

```text
~/.overseer/worktrees/arena/<arena>/<n>-<agent>
```

Every agent starts from the last commit on your current branch. Uncommitted changes in your folder are not copied. If you have any, the page tells you how many were left out, so commit them first if the agents need to see them.

## Watch the race

Each agent is one row. While it works, the row shows what it's doing right now, like "Running go test" or "Reading auth.go". Click an agent to open its answer, the check output and a link to its full session. If an agent needs an approval, the row says so and links to the session.

**Stop all** ends every agent that is still running.

## The results

When everyone has finished, the rows turn into a scoreboard:

| Column | What it shows |
| --- | --- |
| **Time** | How long the agent took |
| **Changes** | Lines added and removed. **None** if it changed nothing |
| **Check** | **passed** or **failed**, when you set a check |
| **Cost** | What the run cost, or its tokens when the cost isn't known |

Overseer marks **fastest**, **smallest** and **cheapest** among the agents that finished well, and only when the numbers really differ.

## Pick a winner

Click **Pick** on the result you want. You choose what happens to it:

| Choice | What it does |
| --- | --- |
| **Open a pull request** | Pushes the agent's branch and opens a pull request with the GitHub CLI (`gh`) on that machine |
| **Apply to my folder** | Puts the changes into your own folder as uncommitted edits. Only works when your folder is clean, and only for agents that ran on the same machine |
| **Keep the branch** | Saves the work on its branch in its own folder. Nothing else changes |
| **Download as a patch** | Gets the changes as a `.patch` file |

You can pick again later with **Change**.

## Clean up

Each copy takes disk space. When you're done, click **Clean up** on the winner banner. It lists the extra copies and their branches and removes only the folders Overseer made for this arena. Your own folder is never touched. You can also remove the winner's copy once its changes are in your folder or on GitHub.

**Forget this arena** in the **⋯** menu removes it from Overseer's list without touching any copy.

## Share the result

On a finished arena, **Share** makes an image of the scoreboard. **Copy image** and **Download PNG** save it, and **Post on X** opens a ready-to-post message. Past arenas are listed at the bottom of the Agent Arena page.
