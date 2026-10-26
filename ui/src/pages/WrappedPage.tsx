import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import Icon from '../components/Icon'
import { useShell } from '../shell'
import { usePref } from '../store'
import { CARDS, CARD_H, CARD_W, canvasBlob, cardFileName, drawCard, loadAssets, type CardKind, type CardTheme } from '../wrappedCanvas'
import { compact, hasActivity, hoursText, rangeLabel, shareText, tweetUrl, useStats, type StatsRange } from '../wrapped'

const ranges: { id: StatsRange; label: string }[] = [
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
  { id: 'all', label: 'All time' },
]

// Agent Wrapped: a recap of what your agents did, as a set of cards you can
// post. The cards are canvases, so Download and Copy export exactly this.
export default function WrappedPage() {
  const { toast } = useShell()
  const [range, setRange] = usePref<StatsRange>('wrapped.range', 'week')
  const [theme, setTheme] = usePref<CardTheme>('wrapped.theme', 'midnight')
  const [card, setCard] = useState<CardKind>(0)
  const { stats, error } = useStats(range)
  const canvases = useRef<(HTMLCanvasElement | null)[]>([])
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState('')

  useEffect(() => {
    if (!stats || !hasActivity(stats)) return
    let alive = true
    loadAssets().then((assets) => {
      if (!alive) return
      canvases.current.forEach((canvas, kind) => { if (canvas) drawCard(canvas, kind as CardKind, stats, theme, assets) })
      setReady(true)
    })
    return () => { alive = false }
  }, [stats, theme])

  const current = () => canvases.current[card]
  const download = useCallback(async () => {
    const canvas = current()
    if (!canvas || !stats) return
    const url = URL.createObjectURL(await canvasBlob(canvas))
    const link = document.createElement('a')
    link.href = url
    link.download = cardFileName(card, stats)
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 2000)
  }, [card, stats]) // eslint-disable-line react-hooks/exhaustive-deps

  const copy = async () => {
    const canvas = current()
    if (!canvas) return
    setBusy('copy')
    try {
      // Safari only accepts the clipboard write when the blob is a promise.
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': canvasBlob(canvas) })])
      toast('Image copied')
    } catch {
      toast('Could not copy the image. Use Download instead.')
    } finally { setBusy('') }
  }

  const post = () => { if (stats) window.open(tweetUrl(shareText(stats)), '_blank', 'noopener,noreferrer') }

  const empty = stats && !hasActivity(stats)
  return (
    <div className="main-scroll">
      <div className="page wr-page">
        <div className="wr-head">
          <div>
            <h1 className="page-title">Agent Wrapped</h1>
            <p className="page-sub">{stats ? `${rangeLabel(stats)} · what your agents got done` : 'What your agents got done'}</p>
          </div>
          <div className="pill-tabs" role="tablist" aria-label="Range">
            {ranges.map((item) => (
              <button key={item.id} role="tab" className="pill-tab" aria-selected={range === item.id} onClick={() => setRange(item.id)}>{item.label}</button>
            ))}
          </div>
        </div>

        {error && !stats && <p className="wr-note">{error}</p>}
        {!stats && !error && <div className="wr-loading"><span className="spinner" /></div>}
        {empty && (
          <div className="wr-empty">
            <p className="wr-empty-title">Nothing to show for this {range === 'all' ? 'time' : range} yet</p>
            <p className="wr-note">Start a session and your first recap appears here.</p>
            <Link to="/" className="btn btn-dark">New session</Link>
          </div>
        )}

        {stats && !empty && (
          <div className="wr-stage">
            <div className="wr-view">
              <div className="wr-card-frame" data-ready={ready}>
                {CARDS.map((name, kind) => (
                  <canvas
                    key={name}
                    ref={(node) => { canvases.current[kind] = node }}
                    width={CARD_W}
                    height={CARD_H}
                    className="wr-canvas"
                    data-active={card === kind}
                    role="img"
                    aria-label={`${name} card: ${shareText(stats)}`}
                    aria-hidden={card !== kind}
                  />
                ))}
              </div>
            </div>
            <div className="wr-side">
              <div className="wr-picker" role="tablist" aria-label="Cards">
                {CARDS.map((name, kind) => (
                  <button key={name} role="tab" className="wr-thumb" aria-selected={card === kind} onClick={() => setCard(kind as CardKind)}>
                    <ThumbOf source={canvases.current[kind]} version={`${ready}-${theme}-${range}-${stats.end}`} />
                    <span>{name}</span>
                  </button>
                ))}
              </div>
              <div className="wr-actions">
                <button className="btn btn-dark btn-lg" onClick={download} disabled={!ready}><Icon name="download" size={17} />Download PNG</button>
                <button className="btn btn-outline btn-lg" onClick={copy} disabled={!ready || busy === 'copy'}><Icon name="copy" size={17} />Copy image</button>
                <button className="btn btn-outline btn-lg" onClick={post}><XMark />Post on X</button>
              </div>
              <div className="wr-theme">
                <span>Style</span>
                <div className="seg" role="group" aria-label="Card style">
                  <button aria-pressed={theme === 'midnight'} onClick={() => setTheme('midnight')}>Midnight</button>
                  <button aria-pressed={theme === 'paper'} onClick={() => setTheme('paper')}>Paper</button>
                </div>
              </div>
              <p className="wr-caption">“{shareText(stats)}”</p>
              <dl className="wr-facts">
                <div><dt>Agent time</dt><dd>{hoursText(stats.agentMs)}</dd></div>
                <div><dt>Prompts</dt><dd>{compact(stats.turns)}</dd></div>
                <div><dt>Sessions</dt><dd>{compact(stats.sessions.started)}</dd></div>
              </dl>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// A scaled copy of a card canvas for the picker.
function ThumbOf({ source, version }: { source: HTMLCanvasElement | null; version: string }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const target = ref.current
    if (!target || !source || !source.width) return
    target.width = 216
    target.height = 270
    const ctx = target.getContext('2d')
    ctx?.drawImage(source, 0, 0, 216, 270)
  }, [source, version])
  return <canvas ref={ref} width={216} height={270} aria-hidden="true" />
}

function XMark() {
  return <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" /></svg>
}
