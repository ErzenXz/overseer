---
lead: Install the hub on one computer, add your other machines with one pasted command each, and start your first agent session.
---

## Install the hub

Pick the computer that stays on most. An always-on Linux server is the best home for the hub, but a Mac or Windows PC works just as well.

On **Linux** with systemd:

```sh
curl -fsSL https://overseer.sh/install.sh | sh
```

On **macOS**, Intel or Apple Silicon:

```sh
curl -fsSL https://overseer.sh/install-macos.sh | sh
```

On **Windows**, from PowerShell:

```powershell
irm https://overseer.sh/install.ps1 | iex
```

The Linux installer sets up a systemd service. On macOS and Windows the hub runs in your user session and starts again when you log in; on Windows it runs hidden, so no console window stays open.

## Choose your password

When the installer finishes, it prints a link with a one-time setup code:

```text
http://192.168.1.20:4200/?setup=ABCDE-23456
```

Open it and choose an admin password. The setup code stops anyone else on your network from claiming the new hub before you do, and it stops working once a password is set. If you lose the link, the code is also in the hub's log and in the `setup-code` file in its data folder (`/var/lib/overseer` on Linux, `~/.overseer` on macOS and Windows).

The hub's own computer shows up in **Machines** right away.

## Add a machine

In the web app, open **Machines → Add machine**, choose the platform and copy the command it shows. Paste it into a terminal on the other computer:

```sh
curl -fsSL http://YOUR-HUB:4200/install/TOKEN.sh | sh
```

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -Command "irm http://YOUR-HUB:4200/install/TOKEN.ps1 | iex"
```

The command downloads the machine agent, checks it against the checksum the hub publishes, installs a background service and connects. The machine appears within seconds. Each link works once and expires after 15 minutes.

> [!TIP]
> Joining machines over a network you don't control? Use the hub's HTTPS address instead of plain HTTP. See [Remote Access](/docs/remote-access/).

## Start a session

1. Click **New session**.
2. Type what you want done.
3. Pick the machine, the folder and the agent.
4. Press <kbd>Enter</kbd>.

You get a chat with the agent. Its steps fold into a short "Worked for 2m 10s" line, edits show as diffs, and when it wants to run something you approve or reject it in the thread. Read more in [Sessions](/docs/sessions/).

## Sign in to your agents

Open **Machines → Setup**, pick a machine, and Overseer shows which agent CLIs are installed and signed in. It can install or repair Claude Code, Codex and Gemini CLI, then open each provider's own login flow in a terminal. Your credentials stay in each provider's storage on that machine; Overseer never stores them.

## Installer options

| Variable | What it does |
| --- | --- |
| `OVERSEER_INSTALL_SOURCE` | `binary` requires a published release, `source` forces a build from source |
| `OVERSEER_VERSION` | Install a specific release tag |
| `OVERSEER_REF` | The branch or commit to build from, for source installs |
| `OVERSEER_TLS_DOMAIN`, `OVERSEER_TLS_EMAIL` | Turn on built-in HTTPS with Let's Encrypt |
| `OVERSEER_PURGE` | With `uninstall`, also delete your data |

Every installer checks the release binary against the release's `checksums.txt` before installing it. If no release exists for your platform, it builds from source with temporary toolchains that are checked too, and leaves your own toolchains alone.

## Uninstall

Uninstalling keeps your data unless you add `OVERSEER_PURGE=1`.

```sh
curl -fsSL https://overseer.sh/install.sh | sh -s -- uninstall        # Linux
curl -fsSL https://overseer.sh/install-macos.sh | sh -s -- uninstall  # macOS
```

```powershell
& ([scriptblock]::Create((irm https://overseer.sh/install.ps1))) uninstall
```

To remove a machine you added, run `~/.overseer/bin/overseer agent uninstall` on it.
