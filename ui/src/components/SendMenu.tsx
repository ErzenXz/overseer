import { useState } from 'react'
import { agentInfo } from '../agents'
import { clock, fromLocalInput, inText, limitReset, type LaterChoice, toLocalInput, tomorrowAt, tonightAt, whenText } from '../schedule'
import { usePlanLimits } from '../usageLimits'
import { MenuItem, Submenu } from './Menu'
import Modal from './Modal'

// SendLaterItems is the "Send later" submenu in the composer's + menu: when the
// plan limit resets (only offered when it is high), or at a time.
export function SendLaterItems({ deviceId, agent, model, disabled, close, onLater, onPick }: {
  deviceId: string
  agent: string
  model?: string
  disabled?: boolean
  close: () => void
  onLater: (choice: LaterChoice) => void
  onPick: () => void
}) {
  const { accounts } = usePlanLimits()
  const reset = limitReset(accounts, deviceId, agent, model)
  if (disabled) return <MenuItem icon="clock" label="Send later" description="Write the message first" disabled />
  const tonight = tonightAt(1)
  const tomorrow = tomorrowAt(9)
  const tonightSec = Math.floor(tonight.getTime() / 1000)
  const tomorrowSec = Math.floor(tomorrow.getTime() / 1000)
  return (
    <Submenu icon="clock" label="Send later" width={300}>
      {reset && (
        <MenuItem
          icon="clock"
          label="When my limit resets"
          end={<span className="sc-menu-time">{inText(reset.resetsAt)}</span>}
          description={`${agentInfo(agent).name} ${reset.window.label.toLowerCase()} limit is at ${Math.round(reset.percent)}%`}
          onClick={() => { close(); onLater({ kind: 'limit_reset' }) }}
        />
      )}
      <MenuItem icon="clock" label={`Tonight at ${clock(tonight)}`} end={<span className="sc-menu-time">{inText(tonightSec)}</span>} onClick={() => { close(); onLater({ kind: 'time', at: tonightSec }) }} />
      <MenuItem icon="clock" label={`Tomorrow at ${clock(tomorrow)}`} end={<span className="sc-menu-time">{inText(tomorrowSec)}</span>} onClick={() => { close(); onLater({ kind: 'time', at: tomorrowSec }) }} />
      <MenuItem icon="calendar" label="Pick a date and time…" onClick={() => { close(); onPick() }} />
    </Submenu>
  )
}

export function PickTime({ onClose, onPick }: { onClose: () => void; onPick: (at: number) => void }) {
  const soonest = Math.floor(Date.now() / 1000) + 3600
  const [value, setValue] = useState(toLocalInput(soonest))
  const at = fromLocalInput(value)
  const past = at <= Math.floor(Date.now() / 1000)
  return (
    <Modal
      title="Schedule for"
      onClose={onClose}
      footer={(
        <>
          <button className="btn btn-outline" onClick={onClose}>Cancel</button>
          <button className="btn btn-dark" disabled={!at || past} onClick={() => onPick(at)}>Schedule</button>
        </>
      )}
    >
      <div>
        <label className="sc-field">
          <span>Start the session on</span>
          <input className="input" type="datetime-local" value={value} min={toLocalInput(Math.floor(Date.now() / 1000))} onChange={(event) => setValue(event.target.value)} autoFocus />
        </label>
        <p className="hint mt-2">{past ? 'Choose a time in the future.' : `Starts ${whenText(at).toLowerCase()} on the machine you picked.`}</p>
      </div>
    </Modal>
  )
}
