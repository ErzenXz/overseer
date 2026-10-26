---
lead: The same overseer binary that runs the hub is also a command-line client. List your machines, start sessions, type into them, read their output, forward ports and watch your whole fleet, from any shell or script.
---

## Sign in

Create an API token in **Settings → API tokens**, then on any computer with the `overseer` binary:

```sh
overseer fleet login --hub https://overseer.example.com --token YOUR_API_TOKEN
```

The hub address and token are saved for the commands below. Machines you added already have the binary at `~/.overseer/bin/overseer`.

## Targets

Most commands take a **machine** and a **session**:

- A machine is its name (any case) or its ID, as `overseer fleet devices` prints them.
- A session is the name you gave it with `overseer fleet new`.

## Machines and sessions

```sh
overseer fleet devices                         # every machine and its status
overseer fleet sessions                        # every session on every machine
overseer fleet sessions studio                 # only the sessions on studio
overseer fleet new studio build --cwd ~/app    # start a shell session
overseer fleet new studio fix --cmd claude     # start one running a command
overseer fleet kill studio build               # end a session
```

`overseer fleet new` options:

| Flag | Meaning |
| --- | --- |
| `--cwd <dir>` | Start in this folder |
| `--cmd <command>` | Run this command in the session, such as `claude` or `codex` |

## Typing and reading

```sh
overseer fleet send studio fix "run the auth tests"     # type text and press Enter
overseer fleet read studio fix                          # recent output
overseer fleet read studio fix --lines 200              # more of it
```

`send` presses <kbd>Enter</kbd> after the text, so it works for shells and agent prompts alike.

## Run a command

Run one command on a machine and print what it outputs:

```sh
overseer fleet run homelab -- git status
overseer fleet run homelab -- df -h /
```

Everything after `--` is the command.

## Forward a port

Open a machine's `localhost` port on your own computer, for example a dev server an agent started:

```sh
overseer forward studio 5173                  # http://localhost:5173 here
overseer forward studio 5173 --local 8080     # http://localhost:8080 here
```

| Flag | Meaning |
| --- | --- |
| `--local <port>` | The port on this computer (default: the same port, or the next free one) |
| `--hub <url>` | Use a different hub than the one you signed in to |

Press <kbd>Ctrl</kbd> <kbd>C</kbd> to stop forwarding. Traffic goes through the machine's existing connection to the hub, so nothing is opened on the machine.

## Watch everything with `top`

```sh
overseer top
```

`overseer top` is a live, full-screen view of your fleet, like `htop` for agents. At the top are your machines with their CPU, memory and session counts. Below are the agent sessions, with the ones waiting for you first, then the ones working, then recent ones, each with the step it's on. It uses the hub and token you saved with `overseer fleet login`.

| Key | What it does |
| --- | --- |
| <kbd>↑</kbd> <kbd>↓</kbd> or <kbd>j</kbd> <kbd>k</kbd> | Select a session. <kbd>PgUp</kbd> and <kbd>PgDn</kbd> move a page, <kbd>g</kbd> and <kbd>G</kbd> jump to the start and end |
| <kbd>Enter</kbd> | Details: recent steps and the last reply. Scroll with <kbd>↑</kbd> <kbd>↓</kbd>; <kbd>Enter</kbd> or <kbd>Esc</kbd> goes back |
| <kbd>a</kbd> | Answer a waiting approval: pick an option, such as **Allow once** or **Reject**, with the arrow keys or its number, then <kbd>Enter</kbd> |
| <kbd>s</kbd> | Steer: type a message and send it to the session |
| <kbd>x</kbd> | Stop the session's current turn. It asks first; press <kbd>y</kbd> to confirm |
| <kbd>/</kbd> | Filter by title, agent, machine, folder or state |
| <kbd>o</kbd> | Open the session in your browser. Use this to answer an agent's questions |
| <kbd>r</kbd> | Refresh now |
| <kbd>?</kbd> | Show the key list |
| <kbd>q</kbd> or <kbd>Ctrl</kbd> <kbd>C</kbd> | Quit |

| Flag | Meaning |
| --- | --- |
| `--interval <duration>` | How often to refresh (default `1.5s`, at least `500ms`) |
| `--plain` | Print a plain table once and exit |
| `--no-color` | Turn colours off. `NO_COLOR` is honoured too |

When the output isn't a terminal, for example `overseer top | less`, it prints the plain table once.

## Check in with `status`

`overseer status` prints a one-time summary: your machines, and the sessions that need you.

```sh
overseer status                 # a readable summary
overseer status --short         # one line of counts, for a shell prompt
overseer status --json          # for scripts
```

| Flag | Meaning |
| --- | --- |
| `--short` | One line like `●1 ◐2`: sessions waiting, working and failed. Parts at zero are left out, and a lone ✓ means all quiet |
| `--json` | Machines, sessions and the ids of sessions waiting on you |
| `--no-color` | Turn colours off |

It exits with status 0 whenever the hub answers, so a quiet fleet and a busy one look the same to a script. Read the counts or the JSON to decide what to do.

## Run the hub and machines

| Command | What it does |
| --- | --- |
| `overseer serve` | Run the hub (web app and API) on `:4200` |
| `overseer serve --tls-domain d.com --tls-email you@d.com` | Run the hub with automatic HTTPS |
| `overseer serve --preview-domain example.com` | Serve previews at `{port}-{machine}.example.com` |
| `overseer agent enroll --hub URL --token TOKEN` | Enroll this computer with a hub |
| `overseer agent install-service` | Install and start the machine service |
| `overseer agent run` | Run the machine agent in the foreground |
| `overseer agent uninstall` | Stop and remove the machine service |
| `overseer top` | Live view of every machine and agent session |
| `overseer status` | One-time summary of machines and sessions that need you |
| `overseer mcp` | Run the MCP server for coding agents |
| `overseer update [--check]` | Install or check for the newest verified release |
| `overseer rollback` | Go back to the previous verified version |
| `overseer version` | Print the version |

`overseer serve` also takes `--addr` (default `:4200`) and `--data-dir` (default `~/.overseer`).
