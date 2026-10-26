import { useMemo, useState } from 'react'
import { api } from '../api'
import { relativeTime } from '../agents'
import { useShots, type ShotsReply, type ThreadShot } from '../autopilot'
import { useShell } from '../shell'
import { usePref } from '../store'
import Icon from './Icon'
import { Menu, MenuItem, MenuLabel, MenuSeparator, Switch } from './Menu'

type Form = 'desktop' | 'phone'
type Mode = 'side' | 'slider'

// BeforeAfter shows what the session's web page looked like before the agent
// started and after its last turn: side by side, or with a slider to wipe
// between them. The hub takes the pictures by itself when a dev server runs in
// the session's folder; the menu is for taking one by hand and for the switches.
export default function BeforeAfter({ threadId, running }: { threadId: string; running: boolean }) {
  const { reply, setReply, reload } = useShots(threadId, running)
  const [form, setForm] = useState<Form>('desktop')
  const [mode, setMode] = usePref<Mode>('shots.mode', 'side')
  const [busy, setBusy] = useState('')
  const { toast } = useShell()

  const pick = (kind: 'before' | 'after', which: Form) => reply?.shots.find((shot) => shot.kind === kind && shot.form === which)
  const hasPhone = !!reply?.shots.some((shot) => shot.form === 'phone')
  const shown = hasPhone ? form : 'desktop'
  const before = pick('before', shown)
  const after = pick('after', shown)

  const capture = async (kind: 'before' | 'after') => {
    setBusy(kind)
    try {
      const next = await api.post<ShotsReply>(`/api/threads/${encodeURIComponent(threadId)}/shots`, { kind }, 90_000)
      setReply(next)
      if (next.info.note && !next.shots.some((shot) => shot.kind === kind)) toast(next.info.note)
    } catch (cause) { toast(cause instanceof Error ? cause.message : 'Could not take a screenshot') }
    setBusy('')
  }
  const clear = async () => {
    if (!confirm('Delete this session’s screenshots?')) return
    await api.del(`/api/threads/${encodeURIComponent(threadId)}/shots`).catch(() => {})
    reload()
  }
  const configure = async (patch: Partial<ShotsReply['config']>) => {
    try {
      await api.put('/api/shots/config', patch)
      reload()
    } catch (cause) { toast(cause instanceof Error ? cause.message : 'Could not save') }
  }

  const config = reply?.config
  const note = useMemo(() => before?.note ?? '', [before])
  if (!reply || !config) return null
  const empty = reply.shots.length === 0

  return (
    <section className="ap-shots" aria-label="Before and after">
      <div className="ap-shots-head">
        <span className="ap-shots-title"><Icon name="image" size={15} />Before / after</span>
        {!empty && (
          <div className="ap-seg" role="group" aria-label="View">
            <button type="button" aria-pressed={mode === 'side'} onClick={() => setMode('side')}>Side by side</button>
            <button type="button" aria-pressed={mode === 'slider'} onClick={() => setMode('slider')}>Slider</button>
          </div>
        )}
        {hasPhone && (
          <div className="ap-seg" role="group" aria-label="Screen size">
            <button type="button" aria-pressed={shown === 'desktop'} onClick={() => setForm('desktop')}>Desktop</button>
            <button type="button" aria-pressed={shown === 'phone'} onClick={() => setForm('phone')}>Phone</button>
          </div>
        )}
        <span className="grow" />
        <Menu
          placement="bottom-end"
          width={270}
          trigger={<button type="button" className="icon-btn icon-btn-sm" aria-label="Screenshot options">{busy ? <span className="spinner" /> : <Icon name="more" size={16} />}</button>}
        >
          {(close) => (
            <>
              <MenuItem icon="image" label="Take “before” now" description="Replaces the first picture" disabled={!config.enabled || !!busy} onClick={() => { close(); capture('before') }} />
              <MenuItem icon="image" label="Take “after” now" disabled={!config.enabled || !!busy} onClick={() => { close(); capture('after') }} />
              <MenuItem icon="trash" label="Delete these pictures" disabled={empty} danger onClick={() => { close(); clear() }} />
              <MenuSeparator />
              <MenuLabel>For every session</MenuLabel>
              <ShotSwitch label="Take screenshots" hint="Needs Chrome, Chromium or Edge on the machine" value={config.enabled} onChange={(value) => configure({ enabled: value })} />
              <ShotSwitch label="Phone size too" value={config.phone} disabled={!config.enabled} onChange={(value) => configure({ phone: value })} />
              <ShotSwitch label="Add to pull requests" hint="Only when this hub has a public https address" value={config.prComment} disabled={!config.enabled} onChange={(value) => configure({ prComment: value })} />
            </>
          )}
        </Menu>
      </div>

      {!config.enabled ? (
        <p className="ap-shots-note">Screenshots are off. <button type="button" className="link" onClick={() => configure({ enabled: true })}>Turn them on</button></p>
      ) : empty ? (
        <p className="ap-shots-note">
          {reply.info.note || (running ? 'When a dev server starts in this session’s folder, Overseer takes a “before” picture of it.' : 'No pictures yet. They are taken when a dev server runs in this session’s folder.')}
          {' '}<button type="button" className="link" disabled={!!busy} onClick={() => capture('after')}>{busy ? 'Taking one…' : 'Take one now'}</button>
        </p>
      ) : (
        <>
          {mode === 'slider' && before && after ? <Slider before={before} after={after} phone={shown === 'phone'} /> : (
            <div className={`ap-pair ${shown === 'phone' ? 'is-phone' : ''}`}>
              <Figure label="Before" shot={before} />
              <Figure label="After" shot={after} />
            </div>
          )}
          {note && <p className="ap-shots-note">{note}</p>}
          {reply.info.note && <p className="ap-shots-note">{reply.info.note}</p>}
          <PRLine reply={reply} />
        </>
      )}
    </section>
  )
}

function ShotSwitch({ label, hint, value, disabled, onChange }: { label: string; hint?: string; value: boolean; disabled?: boolean; onChange: (value: boolean) => void }) {
  return (
    <div className="ap-switch-row">
      <span className="min-w-0 flex-1"><span className="block">{label}</span>{hint && <span className="ap-switch-hint">{hint}</span>}</span>
      <Switch checked={value} label={label} disabled={disabled} onChange={onChange} />
    </div>
  )
}

function Figure({ label, shot }: { label: string; shot?: ThreadShot }) {
  return (
    <figure className="ap-fig">
      <figcaption><strong>{label}</strong>{shot && <span>{relativeTime(shot.createdAt)}</span>}</figcaption>
      {shot ? (
        <a href={shot.url} target="_blank" rel="noreferrer" title="Open full size"><img src={shot.url} alt={`${label} screenshot`} loading="lazy" /></a>
      ) : <div className="ap-fig-empty">{label === 'Before' ? 'Not taken' : 'Not taken yet'}</div>}
    </figure>
  )
}

// Slider wipes from the "before" picture (left) to the "after" (right).
function Slider({ before, after, phone }: { before: ThreadShot; after: ThreadShot; phone: boolean }) {
  const [pos, setPos] = useState(50)
  const ratio = before.width && before.height ? `${before.width} / ${before.height}` : phone ? '390 / 844' : '1440 / 900'
  return (
    <div className={`ap-slider ${phone ? 'is-phone' : ''}`} style={{ aspectRatio: ratio }}>
      <img className="ap-slide-after" src={after.url} alt="After screenshot" draggable={false} />
      <img className="ap-slide-before" src={before.url} alt="Before screenshot" draggable={false} style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }} />
      <span className="ap-slide-tag ap-slide-tag-l">Before</span>
      <span className="ap-slide-tag ap-slide-tag-r">After</span>
      <span className="ap-slide-line" style={{ left: `${pos}%` }}><span className="ap-slide-knob"><Icon name="chevrons-up-down" size={14} className="rotate-90" /></span></span>
      <input type="range" min={0} max={100} value={pos} aria-label="Compare before and after" onChange={(event) => setPos(Number(event.target.value))} />
    </div>
  )
}

// PRLine says what happened to the pull request comment, or why not.
function PRLine({ reply }: { reply: ShotsReply }) {
  const pr = reply.info.pr
  if (pr.state === 'commented') {
    return <p className="ap-shots-note ap-ok"><Icon name="check" size={13} />Added to the pull request{pr.url ? <> · <a className="link" href={pr.url} target="_blank" rel="noreferrer">open</a></> : null}.</p>
  }
  if (pr.state === 'skipped' || pr.state === 'failed') {
    return <p className="ap-shots-note">Not added to the pull request: {pr.reason || 'unknown reason'}</p>
  }
  if (!reply.publicBase && reply.config.prComment && reply.publicReason) {
    return <p className="ap-shots-note">If a pull request is opened, these will not be added to it. {reply.publicReason}</p>
  }
  return null
}
