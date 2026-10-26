---
lead: Installed hubs and machines keep themselves up to date. Every release is verified before anything is replaced, and the previous version is kept so you can go back with one click.
---

## Software updates

**Settings → General → Software updates** shows the installed version, the newest stable release, how far the rollout across your machines has got, and the version you can roll back to.

Hubs check every six hours and install stable releases on their own. Turn **Auto-update** off to decide yourself, or click **Check now** and then **Install** to update right away. Each release's changes are on the [changelog](/changelog/).

When a new release is out, a small **Update available** card appears at the bottom of the sidebar. Click it to read what's new and install it in one click. After an update, the same card offers **See what's new** once.

## What happens during an update

1. The release binary is downloaded and checked against the release's `checksums.txt`.
2. The new binary must report the expected version before anything else happens.
3. It replaces the running binary in one step on Linux and macOS. On Windows a small helper swaps it once the running program exits.
4. The previous verified binary is kept beside the new one.

If a new version can't stay up, crashing three times before it has run for 90 seconds, the next start restores the previous version on its own. A bad release never leaves a machine stuck restarting.

Releases are only published after the tests pass, and CI publishes signed GitHub build provenance for every binary.

## Roll back

Click **Restore** with the previous version number in Settings → General, or run:

```sh
overseer rollback
```

## Machines

Machines follow the hub's stable version automatically. A failed download leaves the current version running and tries again later; a successful one restarts the machine's service. A foreground `overseer agent run`, used for debugging, is never replaced.

## From the command line

```sh
overseer update --check     # is there a newer release?
overseer update             # install it
overseer rollback           # go back to the previous version
```

Automatic replacement needs an install made by one of the installers. A hub you built and started yourself still shows when a new release exists, but never changes itself.

## Custom services

Running the hub under your own systemd unit or launchd job? It can still update itself. **Settings → General** lists what's missing and gives a ready-made fix. A custom service needs three things:

1. **The managed flag.** Set `OVERSEER_MANAGED=hub` in the service's environment. Without it the hub only reports new releases.
2. **A binary the service user can replace.** Updates are staged next to the running binary, so keep a copy the service user owns, such as `<data dir>/bin/overseer`, and point the service at it. A root-owned symlink from `/usr/local/bin/overseer` to it is fine.
3. **Restart after a clean exit.** A successful update exits with status 0 so the new binary starts. Use `Restart=always`, not `on-failure`.

For systemd, run `sudo systemctl edit <unit>` and add:

```ini
[Service]
Environment=OVERSEER_MANAGED=hub
Restart=always
```

Keep your data folder and service user as they are; nothing needs to move. Then turn on **Auto-update** in Settings → General.
