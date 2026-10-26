---
lead: Every computer connected to your hub is a machine. Each one runs a small background service that dials out to the hub, so it works behind NAT and firewalls with nothing to configure.
---

## The machines list

**Machines** shows every computer with its status and live CPU, memory and disk. Open one to see its sessions, terminals, desktop, files and agents.

![Machines, with live stats for each computer](shot:machines)

## Add a machine

Open **Machines → Add machine**, choose the platform, and paste the command into a terminal on the new computer. See [Quick Start](/docs/quick-start/#add-a-machine) for the commands.

The command:

1. Downloads the machine agent and checks it against the checksum the hub publishes.
2. Enrolls the machine with your hub.
3. Installs a background service and connects.

Links work once and expire after 15 minutes. The service records your `PATH` when it's installed, so agents find Claude Code, Codex and your other CLIs.

## How each platform runs

| Platform | Background service | Terminals |
| --- | --- | --- |
| Linux | systemd | `tmux`, survive disconnects |
| macOS | launchd user agent | `tmux`, survive disconnects |
| Windows | Scheduled Task at sign-in | Native console, live but not yet reattachable |

Install `tmux` on Linux and macOS machines to get terminals you can come back to.

## Offline and mixed networks

If a new machine has the same OS and CPU as the hub, the hub serves the binary itself, which works on an air-gapped network. Otherwise it sends the installer to the matching GitHub release.

For fully offline setups with mixed platforms, put a cross-compiled `overseer_<os>_<arch>` binary in `~/.overseer/binaries/` on the hub and it is served from there.

> [!WARNING]
> Over plain HTTP the checksum catches a corrupted download, but not someone rewriting traffic on purpose. When joining machines over a network you don't control, use the hub's [HTTPS address](/docs/remote-access/).

## Cloud machines

No spare computer? Overseer can create a server for you at **Hetzner Cloud** or **DigitalOcean**, install everything on it and add it to your hub. Only an owner can do this.

Open **Machines → Add machine → New cloud machine**, then:

1. **Connect your provider.** Paste an API token with read and write access. The dialog links to how to make one. The token is checked once and then kept on your hub only. It is never shown again and never sent to the new server. **Disconnect** forgets it; servers it already made stay.
2. **Choose where and how big.** Pick a name, a region and a size. Each size lists its vCPUs, memory and monthly price. Prices come from the provider; if it can't be asked, they're marked as estimates.
3. **Choose the agents to install.** Claude Code is on by default; Codex and Gemini CLI are optional. You sign in to each one on the machine afterwards.
4. **Add an SSH key (optional).** It lets you ssh in as `overseer`. Without one, you reach the machine through Overseer only. Turn on **Close SSH too** and the firewall allows no inbound connections at all.
5. **Check that the server can reach your hub** (see below), then click **Create server**.

You get a fresh Ubuntu 24.04 server with git, tmux, Node, the GitHub CLI and the Overseer agent. It joins your hub by itself and shows up in **Machines** with a badge showing its size and price.

> [!WARNING]
> The server is billed by your provider every month until you delete it. The button shows the price before you click.

### Reaching your hub

The new server dials in to your hub, so it has to be able to reach it. The dialog tells you which case you're in:

- **A public address.** If you opened Overseer at a public address, such as a domain with `--tls-domain` or a tunnel, the server uses that. Nothing more to do. See [Remote Access](/docs/remote-access/).
- **Tailscale.** If your hub is on `localhost`, a home network or a tailnet, a server in the cloud can't reach it. Let the server join your Tailscale network first: paste a Tailscale auth key and your hub's address on the tailnet (`100.x.y.z` or a `.ts.net` name; Overseer suggests the ones it finds). The hub machine must be on the same tailnet.

Make the auth key **one-off and ephemeral** in the Tailscale admin console. It goes into the server's first-boot script, which your provider keeps, so it should stop working after one use. Your hub doesn't store it.

### Watch it come up

The server moves through four steps: **Creating**, **Booting**, **Installing** and **Joined**. It usually takes 2 to 4 minutes. If booting takes much longer, the dialog says the server may not be able to reach your hub. A server that hasn't joined after 25 minutes is marked failed, with the reason.

Servers still being set up, and ones that failed, are listed under **Cloud servers** on the Machines page. You can keep working while they finish.

### Delete a cloud machine

Removing a machine that is a cloud server asks what you want:

- **Remove from Overseer only** leaves the server running, and your provider keeps billing you.
- **Also delete the VM** deletes the server and everything on it, and stops billing right away. Type the machine's name to confirm.

A server that never joined has a **Delete server** button on its card, with the same confirmation.

## Signing agents in

Each agent signs in on the machine it runs on. Overseer asks the agent's own command whether it is signed in, so you see it before a session fails.

- **Machines → your machine → Agents** shows **Signed in** (with the account, when the agent says) or **Signed out**. Click **Sign in** and a terminal opens in a dialog. Follow what it shows: open the link, enter the code, approve in your browser. The dialog notices on its own when it worked.
- **New session** warns you above the composer when the agent you chose is signed out on the machine you chose. If no agent on the machine is ready yet, it walks you through the first one.
- If a session fails because an agent isn't signed in (a `401`, "unauthorized", "not logged in"), the error says so in plain words with a **Sign in** button, then **Resume session** once it worked. Usage limits and network errors get their own short explanations; the original text is under **Details**.

Codex uses a device code, so it works on a machine with no browser. Claude Code and Codex report their status; for other agents Overseer shows **Ready** and offers **Sign in** without claiming either way.

### Share a sign-in with your other machines

Signing in to the same agent on every machine gets old. **Settings → Sign-ins** keeps one Claude Code and one Codex sign-in on your hub and hands it to the machines you pick. Only owners can see or change it, and the secret never comes back to the browser.

- **Claude Code** uses a long-lived token, the way Anthropic documents for machines without a browser. On any computer with a browser, run `claude setup-token`, approve it, and paste the token (it starts with `sk-ant-oat`). It lasts a year and works with Pro, Max, Team and Enterprise plans. It can only run the model, so Remote Control and claude.ai connectors still need a normal sign-in. Overseer passes it to Claude Code as `CLAUDE_CODE_OAUTH_TOKEN` for the sessions it starts; an `ANTHROPIC_API_KEY` already set on a machine still wins.
- **Codex** copies `~/.codex/auth.json` from a machine where Codex is signed in, the way the Codex docs describe for headless machines. If that machine keeps Codex's login in the system keychain there is no file to copy; set `cli_auth_credentials_store = "file"` in `~/.codex/config.toml` and sign in again.

Each machine in the list shows whether it uses the shared sign-in, is signed in on its own, or isn't signed in. **Use it here** applies it; **Replace** swaps out a machine's own sign-in after asking. Overseer backs up a Codex sign-in file before replacing it.

Turn on **Use it on new machines** and a machine that joins with that agent installed but not signed in gets the sign-in by itself. A machine that is already signed in is never changed automatically.

> [!WARNING]
> Codex renews its sign-in while it works. With the same sign-in copied to several machines, a renewal on one can sign another out. If that happens, sign that machine in on its own with a device code, or use an API key for machines that run unattended. Claude Code's token isn't renewed, so sharing it doesn't have this problem.

**Stop sharing** removes the sign-in from your hub. Choose **Stop sharing and sign machines out** to also remove it from the machines where Overseer put it; a Codex file is only removed if it is still the one Overseer wrote.

## Remove a machine

On the machine, run:

```sh
~/.overseer/bin/overseer agent uninstall
```

This stops and removes the service. To take a machine off the hub from the web app, open it and choose **Remove machine** from its menu; its agent stops connecting until you add it again.
