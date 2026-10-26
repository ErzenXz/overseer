# Overseer identity

The blue command-bracket design selected on 21 October 2026 is the product logo.
Keep the white mark, blue background, proportions and internal spacing unchanged.

## Assets

Both the app and marketing site ship identical files in `public/brand/`:

| File | Size | Use |
|---|---|---|
| `overseer.png` | 512×512 | Square app identity and mask-safe source |
| `overseer-1024.png` | 1024×1024 | High-resolution export |
| `overseer-rounded.png` | 512×512, transparent corners | Navigation, wordmarks and rounded app tiles |
| `overseer-circle.png` | 512×512, transparent corners | Circular avatars |
| `overseer-maskable.png` | 512×512, opaque | PWA installation icons; glyph fits inside the safe circle |

Use the shared `LogoMark` component for navigation and inline branding. `AppIcon`
preserves its existing size and rounded-corner behavior. The site hero reveals the
same approved image rather than drawing a different mark.

Each public root also contains a multi-resolution `favicon.ico` (16, 32, 48, 64,
128 and 256 pixels), 16/32-pixel PNG favicons and a self-contained SVG favicon.
The SVG embeds the exact approved image, so it does not approximate the design.
Apple touch icons are 180×180. PWA icons are 192×192 and 512×512, with a separate
maskable entry in the app manifest. Product Hunt uses the 240×240
`site/public/launch/thumbnail.png` export. The social preview is `site/public/og.jpg`.

Do not use the old Orbit sculpture, ring-and-satellite mark or rejected eye
concept as the product logo. Historical screenshots and changelog entries are
not branding sources.

## Generation provenance

Created with the built-in image generation tool, then resized and exported
without regenerating or changing the selected design. The selected generation
prompt was:

> Use case: logo-brand. Deliver ONE finished premium app logo, square 1024x1024
> full bleed, no text or wordmark, no presentation board or variations. Product:
> Overseer, the self-hosted control room for coding agents across multiple
> computers. Must look excellent at Product Hunt 40px thumbnail size: bold
> unmistakable silhouette, simple large graphic, optical balance and generous
> margin. Sophisticated identity quality, distinctive concept. Avoid eyes,
> pupils, generic robots, sparkles, fine circuit details, photorealism, sculpture,
> excessive gradients, small detail. Vivid electric cobalt blue background.
> Centered oversized white custom monogram, two bold opposing terminal angle
> brackets interlocked into a compact hexagonal O. Crisp diagonal cuts, subtle
> negative-space central command chevron. Extremely simple, hard-edged, confident
> software brand, no extra ornament.
