# Overseer marketing site

The public landing page for Overseer, and the announcement surface for
**Overseer Code**. This is a standalone app: it is not the hub UI in
[`../ui`](../ui) and is never compiled into the `overseer` binary.

React 19 + Vite 8 + Tailwind v4 + Motion. Geist / Geist Mono are self-hosted
through Fontsource, so the page makes no third-party requests at runtime.

```sh
npm install
npm run dev      # http://localhost:5173
npm run build    # -> dist/
```

## Product screenshots

Three slots read from `public/shots/`:

| File            | What to capture                                         |
| --------------- | ------------------------------------------------------- |
| `dashboard.png` | The fleet dashboard with at least one device connected  |
| `terminal.png`  | A live browser terminal attached to a session           |
| `files.png`     | The file browser listing a directory on a device        |

Until a file exists, its slot renders a labelled placeholder rather than a
broken image, so the page is presentable with none, some, or all of them
present. To capture:

```sh
../overseer serve --addr :4277 --data-dir /tmp/overseer-shots
```

Open `http://localhost:4277`, set an admin password, and screenshot at a
1440x900 viewport. The hub machine registers itself as the first device, so the
dashboard has real data immediately. Launch a session from the device page to
fill the terminal shot.

## Overseer Code waitlist

The Overseer Code section ships with a **Watch releases** link by default,
which is a real, working way to be notified.

If you want to collect emails instead, set an endpoint and the section swaps in
an email form with validation, sending, success, and error states:

```sh
echo 'VITE_WAITLIST_ENDPOINT=https://your-endpoint' > .env.local
```

It POSTs `{ "email": "..." }` as JSON. With no endpoint set, the form is not
rendered at all, so there is never a control that silently goes nowhere.

## Design notes

- The page is deliberately dark-only. Every screenshot on it is a dark product
  surface, and a light variant would only ever be a worse version of the page.
- One accent (`--color-beacon`, amber) across the whole page.
- Two radii, applied consistently: `rounded-panel` (10px) for surfaces,
  `rounded-control` (8px) for buttons, inputs, and tabs.
- All motion is gated behind `prefers-reduced-motion` and driven by Motion's
  viewport hooks. There are no scroll event listeners.
