import { hueOf, initials } from '../teams'

// A round badge with someone's initials. The colour comes from their id, so
// the same person looks the same everywhere.
export function Avatar({ id, name, size = 22, ring }: { id: string; name: string; size?: number; ring?: boolean }) {
  return (
    <span
      className={`tm-avatar ${ring ? 'tm-avatar-ring' : ''}`}
      style={{ width: size, height: size, fontSize: Math.max(9, Math.round(size * 0.42)), ['--tm-hue' as string]: hueOf(id) }}
      title={name}
      aria-label={name}
    >
      {initials(name)}
    </span>
  )
}

export interface Viewer { id: string; name: string }

// Who else has this session open right now, as a small overlapping stack.
export default function PresenceStack({ viewers, meId }: { viewers: Viewer[]; meId?: string }) {
  const others = viewers.filter((viewer) => viewer.id !== meId)
  if (others.length === 0) return null
  const shown = others.slice(0, 3)
  const more = others.length - shown.length
  const label = `${others.map((viewer) => viewer.name).join(', ')} ${others.length === 1 ? 'is' : 'are'} viewing`
  return (
    <span className="tm-stack" role="group" aria-label={label} title={label}>
      {shown.map((viewer) => <Avatar key={viewer.id} id={viewer.id} name={viewer.name} size={24} ring />)}
      {more > 0 && <span className="tm-avatar tm-avatar-more tm-avatar-ring" style={{ width: 24, height: 24 }}>+{more}</span>}
    </span>
  )
}

// Sidebar: show my sessions, or everyone's. Only rendered when there is more
// than one person on the hub.
export function ScopeToggle({ scope, onChange }: { scope: 'mine' | 'everyone'; onChange: (scope: 'mine' | 'everyone') => void }) {
  return (
    <div className="tm-scope" role="group" aria-label="Whose sessions">
      {(['mine', 'everyone'] as const).map((value) => (
        <button key={value} type="button" aria-pressed={scope === value} onClick={() => onChange(value)}>{value === 'mine' ? 'Mine' : 'Everyone'}</button>
      ))}
    </div>
  )
}
