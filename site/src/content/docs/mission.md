---
lead: Mission control puts every agent on every machine on one live wall. Agent Wrapped turns what they got done into cards you can post.
---

## Mission control

Click **Mission control** in the icon rail. Every session is a tile, grouped by what it needs from you:

| Group | What's in it |
| --- | --- |
| **Needs you** | Sessions waiting for an approval or an answer. The one that has waited longest comes first |
| **Working** | Sessions running now, with a timer and the step they're on |
| **Failed** | Sessions that stopped with an error in the last 3 hours |
| **Done** | Sessions that finished in the last hour |

Each tile shows the session's title, the agent and model, the machine and folder, and a line about what it's doing or asking. Subagents, lines changed and the pull request show along the bottom. Click a tile to open the session.

Across the top, counters show how many are working, waiting and failed, and how many finished today. Under them, every online machine shows its live CPU and memory. The wall updates by itself, with no refreshing.

## TV mode

Press <kbd>F</kbd>, or click **Full screen**, to turn the wall into a display for a spare monitor. Press <kbd>F</kbd> or <kbd>Esc</kbd> to leave.

- The tiles fill the screen. If there are more sessions than fit, the wall shows one page at a time and moves to the next every 14 seconds.
- The screen is kept awake, and the mouse pointer hides when you stop moving it.

To open the wall in TV mode straight away, add `?tv=1` to the address:

```text
https://overseer.example.com/mission?tv=1
```

That shows the TV layout without going full screen, so use your browser's own full-screen mode to hide its bars. You still need to be signed in, so sign in on that screen once.

## Agent Wrapped

Open **Agent Wrapped** from the Overseer logo menu. It's a recap of what your agents got done, made from the sessions on your hub. Choose **Week**, **Month** or **All time** at the top.

There are three cards. Click one to see it larger:

| Card | What it shows |
| --- | --- |
| **Overview** | Agent time, prompts, sessions, pull requests, lines changed, and a bar for each day |
| **Crew** | Which agents and which machines did the work |
| **Highlights** | Your busiest day, longest run, active streak, and how many times you stepped in |

Pick the **Midnight** (dark) or **Paper** (light) style, then:

- **Download PNG** saves the card.
- **Copy image** puts it on your clipboard.
- **Post on X** opens a ready-to-post message. Attach the image you copied or downloaded.

The numbers are worked out on your hub, and the cards are drawn in your browser. Nothing is sent anywhere until you post.

On the first visit each Monday, the **New session** page shows a small card, **Your week with agents**, with the week's totals. Click it to open the recap, or dismiss it. It shows once a week, and only if there was something to show.
