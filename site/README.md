# Overseer marketing site

The public landing page for Overseer, deployed on Vercel at
[overseer.sh](https://overseer.sh). It also serves
the hub installers from `public/` (`install.sh`, `install-macos.sh`,
`install.ps1`). This is a standalone app: it is not the hub UI in
[`../ui`](../ui) and is never compiled into the `overseer` binary.

React 19 + Vite 8 + Tailwind v4. Geist / Geist Mono are self-hosted through
Fontsource, so the page makes no third-party requests at runtime.

```sh
npm install
npm run dev      # http://localhost:5173
npm run build    # -> dist/
```

## Design notes

- The palette mirrors the product (`ui/src/index.css`): near-monochrome,
  hairline borders, a dark primary button, light and dark themes via
  `prefers-color-scheme`. Status colours (green, purple, amber, red) only
  appear inside product recreations, where the app uses them.
- The product shots are HTML/CSS recreations in `src/components/mock/`, not
  screenshots, so they stay crisp, theme-aware and easy to keep in sync with
  the app. The hero plays one short sequence on load and then holds;
  reduced-motion readers get the final frame.
- The logo lives only in `src/components/Logo.tsx` (plus `public/favicon.svg`).
- Scroll reveals are CSS-only and opt-in: content is visible unless JS runs and
  the reader has not asked for reduced motion.
