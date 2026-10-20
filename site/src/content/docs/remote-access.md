---
lead: The hub listens on port 4200 over plain HTTP, which is fine on a network you trust. To reach it from anywhere else, put it behind encryption first. Here are three ways.
---

## On your own network

Out of the box the hub binds to `0.0.0.0:4200`. Open `http://<hub address>:4200` from any device on the same network.

> [!WARNING]
> Never put plain HTTP on the internet. The hub can run commands on all your machines, so anyone who can read its traffic could take them over.

## Tailscale

[Tailscale](https://tailscale.com) is the easiest choice when you don't have a domain, and the one we recommend. Put the hub and your laptop or phone on the same tailnet and the hub stays private to it: no open ports, no router changes.

Open **Machines → Setup** and Overseer can install and connect Tailscale on Linux, macOS and Windows, then set up **Tailscale Serve** to give the hub a private HTTPS address.

## Built-in HTTPS

If you have a domain, the hub can get and renew its own certificate from Let's Encrypt.

1. Point the domain's DNS at the hub's computer.
2. Open ports 80 and 443.
3. Start the hub with your domain and email:

```sh
overseer serve --tls-domain overseer.example.com --tls-email you@example.com
```

Or set it up at install time:

```sh
curl -fsSL https://overseer.sh/install.sh \
  | env OVERSEER_TLS_DOMAIN=overseer.example.com OVERSEER_TLS_EMAIL=you@example.com sh
```

Built-in HTTPS, or any other real certificate, is required for [remote MCP](/docs/mcp/#remote-mcp) clients like ChatGPT.

## A reverse proxy or tunnel

Already run Caddy, nginx, Traefik or Cloudflare Tunnel? Point it at the hub's single port, `http://localhost:4200`. Overseer works behind proxies that rewrite the `Host` header.

For live previews behind a tunnel, add a wildcard hostname too. See [Live previews](/docs/workspace/#set-up-preview-addresses).

## Signing in

- A new hub can only be claimed with the one-time **setup code** printed by the installer.
- Sign-in is rate limited.
- Changes made with your login cookie must come from the hub's own pages, which blocks cross-site requests.
- API tokens for the [CLI](/docs/cli/) and [MCP](/docs/mcp/) are created and revoked in **Settings → API tokens**.
