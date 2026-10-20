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

## Remove a machine

On the machine, run:

```sh
~/.overseer/bin/overseer agent uninstall
```

This stops and removes the service. To take a machine off the hub from the web app, open it and choose **Remove machine** from its menu; its agent stops connecting until you add it again.
