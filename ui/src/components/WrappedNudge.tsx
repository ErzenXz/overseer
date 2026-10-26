import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { usePref } from '../store'
import { compact, hasActivity, hours, isNudgeDay, weekKey, type WrappedStats } from '../wrapped'
import Icon from './Icon'

// On the first visit of a Monday, offer the recap of the week just gone.
// Dismissing it (or opening it) remembers this week, so it shows once.
export default function WrappedNudge() {
  const [seen, setSeen] = usePref('wrapped.seenWeek', '')
  const week = weekKey()
  const due = isNudgeDay() && seen !== week
  const [stats, setStats] = useState<WrappedStats | null>(null)

  useEffect(() => {
    if (!due) return
    let alive = true
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
    api.get<WrappedStats>(`/api/stats?range=week&tz=${encodeURIComponent(tz)}`).then((next) => { if (alive) setStats(next) }).catch(() => {})
    return () => { alive = false }
  }, [due])

  if (!due || !stats || !hasActivity(stats)) return null
  const h = hours(stats.agentMs)
  const bits = [
    `${h.value}${h.unit === 'min' ? ' min' : 'h'} of agent time`,
    stats.prs.opened ? `${stats.prs.opened} PR${stats.prs.opened === 1 ? '' : 's'}` : '',
    stats.lines.added + stats.lines.removed ? `${compact(stats.lines.added + stats.lines.removed)} lines` : '',
  ].filter(Boolean)
  return (
    <div className="wr-nudge" role="region" aria-label="Your week with agents">
      <Link to="/wrapped" className="wr-nudge-link" onClick={() => setSeen(week)}>
        <Icon name="sparkles" size={14} className="wr-nudge-icon" />
        <span className="wr-nudge-title">Your week with agents</span>
        <span className="wr-nudge-bits">{bits.join(' · ')}</span>
        <Icon name="chevron" size={13} className="wr-nudge-go" />
      </Link>
      <button className="wr-nudge-x" aria-label="Dismiss" onClick={() => setSeen(week)}><Icon name="close" size={13} /></button>
    </div>
  )
}
