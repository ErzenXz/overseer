import { agentInfo } from './agents'
import { marks } from './components/Icon'
import { change, compact, hours, hoursText, rangeLabel, weekday, withCommas, type StatsGroup, type WrappedStats } from './wrapped'

// Agent Wrapped cards, drawn straight onto a canvas so what the page shows is
// exactly what Download / Copy image / Post export. No dependencies: the
// canvas is 1080x1350 (4:5), the size social feeds crop least.

export const CARD_W = 1080
export const CARD_H = 1350
export type CardTheme = 'midnight' | 'paper'
export const CARDS = ['Overview', 'Crew', 'Highlights'] as const
export type CardKind = 0 | 1 | 2

interface Palette {
  bg: string
  ink: string
  dim: string
  faint: string
  surface: string
  border: string
  blue: string
  violet: string
  amber: string
  green: string
  red: string
  glow: [string, string, string] // rgb triples; alpha is set where drawn
  dark: boolean
}

const palettes: Record<CardTheme, Palette> = {
  midnight: {
    bg: '#0b0c0f', ink: '#f5f5f7', dim: 'rgba(245,245,247,0.56)', faint: 'rgba(245,245,247,0.09)', surface: 'rgba(255,255,255,0.04)', border: 'rgba(255,255,255,0.10)',
    blue: '#7cb4ff', violet: '#a78bfa', amber: '#f5b544', green: '#5ee08f', red: '#ff7a85',
    glow: ['79,140,255', '167,139,250', '245,181,68'], dark: true,
  },
  paper: {
    bg: '#fbfaf7', ink: '#141414', dim: 'rgba(20,20,20,0.56)', faint: 'rgba(20,20,20,0.07)', surface: 'rgba(0,0,0,0.03)', border: 'rgba(20,20,20,0.10)',
    blue: '#2563eb', violet: '#7c3aed', amber: '#c27c0e', green: '#15803d', red: '#c62d3b',
    glow: ['120,170,255', '190,170,255', '255,190,130'], dark: false,
  },
}

const FONT = "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
const MONO = "'SF Mono', ui-monospace, Menlo, monospace"
const M = 88 // outer margin

export interface Assets { logo: HTMLImageElement | null; grain: HTMLCanvasElement }

let assets: Promise<Assets> | null = null

// loadAssets waits for the webfont and the logo, and makes the grain tile.
export function loadAssets(): Promise<Assets> {
  assets ??= (async () => {
    try { await Promise.all([document.fonts.load('800 100px Inter'), document.fonts.load('600 40px Inter'), document.fonts.load('500 30px Inter')]) } catch { /* fall back to system fonts */ }
    const logo = await new Promise<HTMLImageElement | null>((resolve) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => resolve(null)
      img.src = '/brand/overseer-rounded.png'
    })
    const grain = document.createElement('canvas')
    grain.width = grain.height = 192
    const g = grain.getContext('2d')!
    const data = g.createImageData(192, 192)
    for (let i = 0; i < data.data.length; i += 4) {
      const v = Math.random() * 255
      data.data[i] = data.data[i + 1] = data.data[i + 2] = v
      data.data[i + 3] = 255
    }
    g.putImageData(data, 0, 0)
    return { logo, grain }
  })()
  return assets
}

// ---- drawing helpers ----

type Ctx = CanvasRenderingContext2D

function rr(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  const k = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + k, y)
  ctx.arcTo(x + w, y, x + w, y + h, k)
  ctx.arcTo(x + w, y + h, x, y + h, k)
  ctx.arcTo(x, y + h, x, y, k)
  ctx.arcTo(x, y, x + w, y, k)
  ctx.closePath()
}

interface TextOpts { size: number; weight?: number; color?: string | CanvasGradient; align?: CanvasTextAlign; spacing?: number; mono?: boolean; base?: CanvasTextBaseline }

function font(ctx: Ctx, o: TextOpts) {
  ctx.font = `${o.weight ?? 500} ${o.size}px ${o.mono ? MONO : FONT}`
  ctx.textAlign = o.align ?? 'left'
  ctx.textBaseline = o.base ?? 'alphabetic'
  if ('letterSpacing' in ctx) (ctx as Ctx & { letterSpacing: string }).letterSpacing = `${o.spacing ?? 0}px`
}

function text(ctx: Ctx, s: string, x: number, y: number, o: TextOpts): number {
  font(ctx, o)
  ctx.fillStyle = o.color ?? '#fff'
  ctx.fillText(s, x, y)
  return ctx.measureText(s).width
}

function width(ctx: Ctx, s: string, o: TextOpts): number {
  font(ctx, o)
  return ctx.measureText(s).width
}

// fit shrinks a size until the text fits max width.
function fit(ctx: Ctx, s: string, o: TextOpts, max: number, min = 20): number {
  let size = o.size
  while (size > min && width(ctx, s, { ...o, size }) > max) size -= 2
  return size
}

function wrap(ctx: Ctx, s: string, o: TextOpts, max: number, lines: number): string[] {
  font(ctx, o)
  const words = s.split(/\s+/).filter(Boolean)
  const out: string[] = []
  let line = ''
  for (let i = 0; i < words.length; i++) {
    const next = line ? `${line} ${words[i]}` : words[i]
    if (ctx.measureText(next).width <= max || !line) { line = next; continue }
    out.push(line)
    line = words[i]
    if (out.length === lines - 1) { line = words.slice(i).join(' '); break }
  }
  if (line) out.push(line)
  if (out.length > lines) out.length = lines
  const last = out.length - 1
  if (last >= 0) {
    let l = out[last]
    if (ctx.measureText(l).width > max || (out.length === lines && words.join(' ') !== out.join(' '))) {
      while (l.length > 1 && ctx.measureText(l + '…').width > max) l = l.slice(0, -1)
      out[last] = l.replace(/[\s,.;:-]+$/, '') + '…'
    }
  }
  return out
}

// A hairline across the card's text column.
function rule(ctx: Ctx, p: Palette, y: number) {
  ctx.fillStyle = p.border
  ctx.fillRect(M, Math.round(y), CARD_W - M * 2, 2)
}

const agentColors: Record<string, string> = { claude: '#D97757', codex: '#34d399', gemini: '#8e9bf7', opencode: '#9ca3af', goose: '#fbbf24', copilot: '#a78bfa', cursor: '#9ca3af' }
const agentColor = (id: string, p: Palette) => agentColors[id] ?? p.blue

// agentMark draws an agent's logo into a size-by-size box at x, y.
function agentMark(ctx: Ctx, p: Palette, agent: string, x: number, y: number, size: number) {
  ctx.save()
  ctx.translate(x, y)
  ctx.scale(size / 24, size / 24)
  const paths = marks as Record<string, string>
  switch (agent) {
    case 'claude': ctx.fillStyle = '#D97757'; ctx.fill(new Path2D(paths.claude)); break
    case 'codex': ctx.fillStyle = p.ink; ctx.fill(new Path2D(paths.openai)); break
    case 'copilot': ctx.fillStyle = p.ink; ctx.fill(new Path2D(paths.copilot)); break
    case 'cursor': ctx.fillStyle = p.ink; ctx.fill(new Path2D(paths.cursor)); break
    case 'gemini': {
      const g = ctx.createLinearGradient(0, 0, 24, 24)
      g.addColorStop(0, '#4F8DF7'); g.addColorStop(0.55, '#8E75B2'); g.addColorStop(1, '#D96570')
      ctx.fillStyle = g
      ctx.fill(new Path2D(paths.gemini))
      break
    }
    case 'opencode':
      ctx.strokeStyle = p.ink; ctx.lineWidth = 2.2
      ctx.strokeRect(4.5, 3, 15, 18)
      ctx.fillStyle = p.ink; ctx.fillRect(8.5, 11, 7, 6)
      break
    default: {
      // Anything else gets its initial in a ring.
      ctx.strokeStyle = p.ink; ctx.lineWidth = 1.8
      ctx.beginPath(); ctx.arc(12, 12, 10, 0, Math.PI * 2); ctx.stroke()
      const name = agentInfo(agent).name || agent
      text(ctx, name.charAt(0).toUpperCase(), 12, 16.6, { size: 13, weight: 700, color: p.ink, align: 'center' })
    }
  }
  ctx.restore()
}

// A small laptop for machines.
function machineMark(ctx: Ctx, p: Palette, x: number, y: number, size: number) {
  ctx.save()
  ctx.translate(x, y)
  ctx.scale(size / 24, size / 24)
  ctx.strokeStyle = p.ink; ctx.lineWidth = 1.8; ctx.lineJoin = 'round'; ctx.lineCap = 'round'
  rr(ctx, 4, 5, 16, 11, 1.8); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(2, 19.5); ctx.lineTo(22, 19.5); ctx.stroke()
  ctx.restore()
}

// One flat colour and a single soft light in a corner: calm, so the numbers lead.
function background(ctx: Ctx, p: Palette, seed: number) {
  ctx.fillStyle = p.bg
  ctx.fillRect(0, 0, CARD_W, CARD_H)
  const [x, y] = [[CARD_W, 0], [0, 0], [CARD_W, CARD_H]][seed % 3]
  const g = ctx.createRadialGradient(x, y, 0, x, y, 900)
  g.addColorStop(0, `rgba(${p.glow[0]},${p.dark ? 0.2 : 0.12})`)
  g.addColorStop(1, `rgba(${p.glow[0]},0)`)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, CARD_W, CARD_H)
}

function header(ctx: Ctx, p: Palette, a: Assets, stats: WrappedStats) {
  const y = M
  if (a.logo) {
    ctx.save()
    rr(ctx, M, y, 52, 52, 12)
    ctx.clip()
    ctx.drawImage(a.logo, M, y, 52, 52)
    ctx.restore()
  }
  text(ctx, 'Overseer', M + 70, y + 36, { size: 30, weight: 600, color: p.ink, spacing: -0.4 })
  text(ctx, rangeLabel(stats), CARD_W - M, y + 36, { size: 28, weight: 500, color: p.dim, align: 'right' })
}

function footer(ctx: Ctx, p: Palette, left: string) {
  text(ctx, left, M, CARD_H - M + 8, { size: 26, weight: 500, color: p.dim })
  text(ctx, 'overseer.sh', CARD_W - M, CARD_H - M + 8, { size: 26, weight: 600, color: p.ink, align: 'right' })
}

function label(ctx: Ctx, p: Palette, s: string, x: number, y: number, align: CanvasTextAlign = 'left') {
  text(ctx, s, x, y, { size: 30, weight: 500, color: p.dim, align })
}

// Plural helper for sub-lines.
const n = (count: number, one: string, many = `${one}s`) => `${withCommas(count)} ${count === 1 ? one : many}`
const periodWord = (stats: WrappedStats) => (stats.range === 'all' ? 'so far' : stats.range === 'month' ? 'this month' : 'this week')

// ---- card 1: the headline ----

function overview(ctx: Ctx, p: Palette, stats: WrappedStats) {
  label(ctx, p, `Your agents worked ${periodWord(stats)}`, M, 300)

  // The hero number with its unit beside it.
  const h = hours(stats.agentMs)
  const unit = h.unit === 'min' ? 'minutes' : 'hours'
  const size = fit(ctx, h.value, { size: 300, weight: 700, spacing: -12 }, CARD_W - M * 2 - 300, 120)
  const base = 330 + size * 0.76
  const numW = text(ctx, h.value, M - 8, base, { size, weight: 700, color: p.ink, spacing: -size * 0.04 })
  text(ctx, unit, M - 8 + numW + 24, base, { size: 64, weight: 500, color: p.dim, spacing: -1 })

  const crew = stats.agents.length
  const machines = stats.machines.length
  const where = [crew ? n(crew, 'agent') : '', machines ? `on ${n(machines, 'machine')}` : ''].filter(Boolean).join(' ')
  let x = M
  if (where) x += text(ctx, where, M, base + 70, { size: 34, weight: 500, color: p.ink })
  const delta = change(stats.agentMs, stats.previous?.agentMs)
  if (delta) text(ctx, `${where ? '   ' : ''}${delta.up ? '+' : '−'}${delta.pct}% vs ${stats.range === 'month' ? 'last month' : 'last week'}`, x, base + 70, { size: 34, weight: 500, color: delta.up ? p.green : p.red })

  // Three quiet rows.
  const rows: [string, string, string][] = [
    [String(stats.prs.opened), stats.prs.opened === 1 ? 'pull request' : 'pull requests', stats.prs.merged ? `${stats.prs.merged} merged` : ''],
    [compact(stats.lines.added + stats.lines.removed), 'lines changed', `+${compact(stats.lines.added)}  −${compact(stats.lines.removed)}`],
    [withCommas(stats.sessions.started), stats.sessions.started === 1 ? 'session' : 'sessions', n(stats.turns, 'prompt')],
  ]
  const top = 720
  const rowH = 104
  rows.forEach(([value, what, extra], i) => {
    const y = top + i * rowH
    rule(ctx, p, y)
    const baseY = y + 76
    const w = text(ctx, value, M, baseY, { size: 62, weight: 700, color: p.ink, spacing: -2 })
    text(ctx, what, M + w + 18, baseY, { size: 32, weight: 500, color: p.dim })
    if (extra) text(ctx, extra, CARD_W - M, baseY, { size: 30, weight: 500, color: p.dim, align: 'right' })
  })
  rule(ctx, p, top + rows.length * rowH)

  week(ctx, p, stats, M, 1060)
}

// The week as seven quiet bars; the busiest day in the accent colour.
function week(ctx: Ctx, p: Palette, stats: WrappedStats, x: number, y: number) {
  const days = stats.days.slice(-(stats.range === 'week' ? 7 : 30))
  if (!days.length) return
  const value = (d: (typeof days)[number]) => d.agentMs || d.turns * 120_000
  const max = Math.max(1, ...days.map(value))
  const total = CARD_W - M * 2
  const labelled = days.length <= 7
  const gap = labelled ? 18 : 6
  const bw = (total - gap * (days.length - 1)) / days.length
  const hMax = 64
  days.forEach((d, i) => {
    const bx = x + i * (bw + gap)
    const v = value(d)
    const bh = v === 0 ? 6 : Math.max(10, hMax * Math.sqrt(v / max))
    rr(ctx, bx, y + hMax - bh, bw, bh, Math.min(8, bw / 2))
    ctx.fillStyle = v === max ? p.blue : v === 0 ? p.faint : p.dark ? 'rgba(245,245,247,0.32)' : 'rgba(20,20,20,0.22)'
    ctx.fill()
    if (labelled) text(ctx, weekday(d.date, 'short').charAt(0), bx + bw / 2, y + hMax + 36, { size: 24, weight: 500, color: p.dim, align: 'center' })
  })
}

// ---- card 2: the crew ----

function crew(ctx: Ctx, p: Palette, stats: WrappedStats) {
  label(ctx, p, `Your crew ${periodWord(stats)}`, M, 300)
  const total = stats.agentMs
  const top = stats.agents[0]
  if (top) {
    agentMark(ctx, p, top.id, M, 340, 76)
    const name = agentInfo(top.id).name
    const size = fit(ctx, name, { size: 92, weight: 700, spacing: -3 }, CARD_W - M * 2 - 110, 48)
    text(ctx, name, M + 104, 340 + 66, { size, weight: 700, color: p.ink, spacing: -size * 0.03 })
    const share = total > 0 ? Math.round((top.agentMs / total) * 100) : 0
    text(ctx, `did the most: ${hoursText(top.agentMs)}${share ? `, ${share}% of the work` : ''}`, M, 340 + 76 + 60, { size: 34, weight: 500, color: p.dim })
  }

  const list = (title: string, y: number, rows: StatsGroup[], mark: (g: StatsGroup, x: number, y: number) => void, name: (g: StatsGroup) => string, color: (g: StatsGroup) => string) => {
    label(ctx, p, title, M, y)
    rule(ctx, p, y + 26)
    const maxMs = Math.max(1, ...rows.map((g) => g.agentMs))
    rows.forEach((g, i) => {
      const ry = y + 26 + i * 70
      mark(g, M, ry + 18)
      text(ctx, name(g), M + 58, ry + 48, { size: 32, weight: 550, color: p.ink })
      const bx = M + 360
      const bw = CARD_W - M - bx - 130
      rr(ctx, bx, ry + 32, bw, 8, 4); ctx.fillStyle = p.faint; ctx.fill()
      rr(ctx, bx, ry + 32, Math.max(8, bw * (g.agentMs / maxMs)), 8, 4); ctx.fillStyle = color(g); ctx.fill()
      text(ctx, hoursText(g.agentMs), CARD_W - M, ry + 48, { size: 30, weight: 600, color: p.ink, align: 'right' })
    })
  }
  const agents = stats.agents.slice(0, 4)
  const machines = stats.machines.slice(0, 3)
  list('Agents', 600, agents, (g, x, y) => agentMark(ctx, p, g.id, x, y, 38), (g) => agentInfo(g.id).name, (g) => agentColor(g.id, p))
  list('Machines', 600 + 26 + agents.length * 70 + 70, machines, (_g, x, y) => machineMark(ctx, p, x, y, 38), (g) => g.name || g.id, () => (p.dark ? 'rgba(245,245,247,0.55)' : 'rgba(20,20,20,0.45)'))
}

// ---- card 3: highlights ----

function highlights(ctx: Ctx, p: Palette, stats: WrappedStats) {
  label(ctx, p, `Highlights ${periodWord(stats)}`, M, 300)
  const top = stats.topSession
  if (top) {
    const lines = wrap(ctx, top.title, { size: 64, weight: 700, spacing: -1.8 }, CARD_W - M * 2, 2)
    lines.forEach((line, i) => text(ctx, line, M, 400 + i * 76, { size: 64, weight: 700, color: p.ink, spacing: -1.8 }))
    const metaY = 400 + lines.length * 76 + 6
    agentMark(ctx, p, top.agent, M, metaY - 30, 36)
    const meta = `${agentInfo(top.agent).name}${top.deviceName ? ` on ${top.deviceName}` : ''} · ${hoursText(top.agentMs)}`
    const w = text(ctx, meta, M + 50, metaY, { size: 30, weight: 500, color: p.dim })
    const a = text(ctx, `   +${withCommas(top.added)}`, M + 50 + w, metaY, { size: 30, weight: 600, color: p.green })
    text(ctx, ` −${withCommas(top.removed)}`, M + 50 + w + a, metaY, { size: 30, weight: 600, color: p.red })
  } else {
    text(ctx, 'No standout session yet.', M, 420, { size: 56, weight: 700, color: p.dim })
  }

  const busiest = stats.busiestDay
  const longest = stats.longestSession
  const cells: [string, string, string][] = [
    ['Busiest day', busiest ? weekday(busiest.date) : '—', busiest ? hoursText(busiest.agentMs) : ''],
    ['Longest run', longest ? hoursText(longest.agentMs) : '—', longest ? clipText(ctx, longest.title, 380) : ''],
    ['Active streak', n(stats.streak.current, 'day'), stats.streak.longest > stats.streak.current ? `best ${stats.streak.longest}` : ''],
    ['You stepped in', withCommas(stats.approvals), stats.approvals === 1 ? 'approval' : 'approvals'],
  ]
  const top0 = 640
  const colW = (CARD_W - M * 2) / 2
  const rowH = 196
  cells.forEach(([what, value, extra], i) => {
    const x = M + (i % 2) * colW
    const y = top0 + Math.floor(i / 2) * rowH
    if (i % 2 === 0) rule(ctx, p, y)
    label(ctx, p, what, x, y + 58)
    const size = fit(ctx, value, { size: 60, weight: 700, spacing: -2 }, colW - 40, 34)
    text(ctx, value, x, y + 58 + 14 + size * 0.8, { size, weight: 700, color: p.ink, spacing: -size * 0.03 })
    if (extra) text(ctx, extra, x, y + rowH - 26, { size: 26, weight: 500, color: p.dim })
  })
  rule(ctx, p, top0 + rowH * 2)

  if (stats.tokens.input + stats.tokens.output > 0 || stats.costUsd > 0) {
    const tokens = compact(stats.tokens.input + stats.tokens.output)
    const bits = [`${tokens} tokens`, stats.costUsd >= 1 ? `$${Math.round(stats.costUsd)} of model time` : ''].filter(Boolean)
    text(ctx, bits.join(' · '), M, top0 + rowH * 2 + 70, { size: 28, weight: 500, color: p.dim })
  }
}

function clipText(ctx: Ctx, s: string, max: number): string {
  font(ctx, { size: 25, weight: 500 })
  if (ctx.measureText(s).width <= max) return s
  let t = s
  while (t.length > 1 && ctx.measureText(t + '…').width > max) t = t.slice(0, -1)
  return t.trimEnd() + '…'
}

// ---- entry points ----

export function drawCard(canvas: HTMLCanvasElement, kind: CardKind, stats: WrappedStats, theme: CardTheme, a: Assets) {
  canvas.width = CARD_W
  canvas.height = CARD_H
  const ctx = canvas.getContext('2d')!
  const p = palettes[theme]
  ctx.clearRect(0, 0, CARD_W, CARD_H)
  background(ctx, p, kind)
  header(ctx, p, a, stats)
  if (kind === 0) overview(ctx, p, stats)
  else if (kind === 1) crew(ctx, p, stats)
  else highlights(ctx, p, stats)
  footer(ctx, p, 'Agent Wrapped')
}

export const canvasBlob = (canvas: HTMLCanvasElement) => new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not export the card'))), 'image/png'))

export const cardFileName = (kind: CardKind, stats: WrappedStats) => `overseer-wrapped-${CARDS[kind].toLowerCase()}-${stats.range}.png`
