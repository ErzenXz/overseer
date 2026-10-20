import { useId } from 'react'

// LogoMark is the Orbit glyph without its app-icon plate: a ring around the
// hub with one live agent (blue) in orbit. The ring follows the text colour;
// the satellite is cut out of it with a mask so it reads on any background.
// The full app icon lives in public/icon.svg.
export function LogoMark({ size = 22, className = '' }: { size?: number; className?: string }) {
  const mask = useId()
  return (
    <svg width={size} height={size} viewBox="196 188 640 640" aria-hidden="true" className={className}>
      <defs>
        <mask id={mask}>
          <rect x="196" y="188" width="640" height="640" fill="#fff" />
          <circle cx="724" cy="300" r="114" fill="#000" />
        </mask>
      </defs>
      <g mask={`url(#${mask})`} fill="currentColor">
        <circle cx="500" cy="524" r="270" fill="none" stroke="currentColor" strokeWidth="68" />
        <circle cx="500" cy="524" r="104" />
      </g>
      <circle cx="724" cy="300" r="74" fill="#3b82f6" />
    </svg>
  )
}

// AppIcon is the full icon with its dark rounded plate.
export function AppIcon({ size = 22, className = '' }: { size?: number; className?: string }) {
  return <img src="/icon.svg" width={size} height={size} alt="" aria-hidden="true" className={className} style={{ borderRadius: size * 0.226 }} />
}
