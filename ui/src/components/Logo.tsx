// Use the approved mark unchanged wherever the product needs its identity.
export function LogoMark({ size = 22, className = '' }: { size?: number; className?: string }) {
  return (
    <img src="/brand/overseer-rounded.png" width={size} height={size} alt="" aria-hidden="true" className={className} />
  )
}

// Keep the existing app-icon rounding at each requested size.
export function AppIcon({ size = 22, className = '' }: { size?: number; className?: string }) {
  return <img src="/brand/overseer-rounded.png" width={size} height={size} alt="" aria-hidden="true" className={className} style={{ borderRadius: size * 0.226 }} />
}
