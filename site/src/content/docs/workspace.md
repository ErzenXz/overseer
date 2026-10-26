---
lead: The panel on the right of every session shows the machine the agent is working on: what it's building, its shell and desktop, its files, and what the session changed.
---

## The side panel

Open the panel from the top right of a session. Each tab works on the session's machine:

| Tab | What it shows |
| --- | --- |
| **Preview** | The dev server the agent started, live |
| **Shell** | A terminal on the machine, in the session's folder |
| **Desktop** | The machine's full remote desktop |
| **Files** | Browse, open, upload and download files |
| **Changes** | Every file this session changed, as diffs |
| **Plan** | The agent's current plan and its progress |

![A Codex session with a live preview of the site it is building](shot:hero)

## Live previews

When an agent starts a dev server, say Vite on port 5173, open **Preview**. Overseer finds what is listening on the machine and shows it, hot reload included. Links to `localhost` in an agent's reply open there too.

Each preview has its own private address:

```text
https://5173-studio.example.com
```

It asks your hub who you are first, so only you can open it. Nothing new is opened on the machine: traffic goes through its existing connection and can only reach that machine's `localhost`.

### Set up preview addresses

If you open the hub on `localhost`, previews work with no setup. For a hub on a domain, such as `overseer.example.com` behind Cloudflare Tunnel, add one wildcard hostname:

1. In your tunnel, add a public hostname `*.example.com`.
2. Point it at the same service as Overseer, for example `http://localhost:4200`.

The preview domain is taken from the hub's address. Change it in **Settings → Previews**, or start the hub with `--preview-domain`:

```sh
overseer serve --preview-domain example.com
```

### No domain?

Forward the port to your own computer instead:

```sh
overseer forward studio 5173     # then open http://localhost:5173
```

See [Command Line](/docs/cli/#forward-a-port) for the options.

## Shell

The **Shell** tab opens a real terminal on the machine. On Linux and macOS terminals run in `tmux`, so they survive a dropped connection; reopen the tab and you are back where you were. Windows uses its native console, which is fully interactive but doesn't yet survive a disconnect.

## Remote desktop

Every machine has a **Desktop** tab. Overseer tunnels the machine's own VNC server through its connection, so VNC is never reachable from the network.

### One-click setup

If a machine has no VNC server yet, the Desktop tab offers **Set up remote desktop**. Overseer works out what that machine needs, runs the setup in a terminal you can watch (and type your password into), and connects as soon as the desktop is ready. Every setup keeps VNC listening on the machine itself only.

| Platform | What the setup does |
| --- | --- |
| macOS | Turns on Screen Sharing, with a firewall rule so it only answers on the machine itself. Sign in with your Mac account. |
| Linux (X11) | Installs `x11vnc`, asks you for a desktop password, and runs it as a background service bound to localhost |
| Linux (Wayland: sway, Hyprland and similar) | Installs `wayvnc` and runs it on localhost |
| Linux (GNOME or KDE on Wayland) | Shows the steps instead: log in with the Xorg session, then use one-click setup |
| Windows | Installs TightVNC with `winget`, accepting connections from the machine itself only |

Prefer to do it yourself? **Show me the commands** lists every step, with a copy button.

## Files and changes

**Files** browses the machine from the session's folder. Open a file to read it, or upload and download files. **Changes** lists every file the session edited with a diff for each, so you can review the agent's work without opening an editor.

## Before and after

When an agent works on something with a web page, **Changes** also shows **Before / after**: how the page looked before the agent started, and how it looks after its last turn.

Overseer takes the pictures by itself. When a dev server starts in the session's folder it takes the "before", and when the agent's turn ends it takes the "after". The pictures come from the Chrome, Chromium or Edge already installed on that machine, run in the background. Nothing is bundled; with no such browser, Overseer skips it quietly.

- **Side by side** or **Slider** switches how you compare them. The slider wipes from before to after as you drag.
- **Desktop** and **Phone** switch the screen size, when phone-size pictures are on.
- The **⋯** menu takes a "before" or "after" now, deletes the pictures, and has three switches that apply to every session: **Take screenshots** (on), **Phone size too** (off) and **Add to pull requests** (on).

Pictures are kept on your hub, a few per session. When a pull request is opened from the session, they're added to it as a comment, so reviewers can see the change. That only works when your hub has a public `https` address that GitHub can load images from. A hub on `localhost`, a private network, Tailscale or plain `http` can't, and the card says so instead. See [Remote Access](/docs/remote-access/).
