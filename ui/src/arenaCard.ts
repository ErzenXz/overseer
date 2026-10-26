import { agentLabel, clock, elapsedMs, modelLabel, verdict, type Arena } from './arena'

// The result card for "Share result": a 1200×630 picture drawn on a canvas, so
// it needs no libraries and works offline. Fixed light colours: it is meant to
// travel, whatever theme the app is in.

const W = 1200
const H = 630
const PAD = 56
const FONT = 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif'

const ink = '#16161a'
const soft = '#6b6b73'
const faint = '#a0a0a8'
const line = '#e7e7ea'
const blue = '#0b55ff'
const green = '#16a34a'
const red = '#d93644'

// Round badges in each agent's colour. The three best known get a simple
// drawing of their mark; any other agent gets its first letter.
const badge: Record<string, string> = { claude: '#D97757', codex: '#111114', gemini: '#ffffff', opencode: '#3a3a40', goose: '#3a3a40', copilot: '#24292f', cursor: '#24292f' }

function agentBadge(ctx: CanvasRenderingContext2D, agent: string, name: string, cx: number, cy: number) {
  ctx.save()
  ctx.fillStyle = badge[agent] ?? '#55555c'
  ctx.beginPath()
  ctx.arc(cx, cy, 18, 0, Math.PI * 2)
  ctx.fill()
  if (agent === 'gemini') {
    ctx.lineWidth = 1
    ctx.strokeStyle = line
    ctx.stroke()
    const g = ctx.createLinearGradient(cx - 11, cy - 11, cx + 11, cy + 11)
    g.addColorStop(0, '#4F8DF7')
    g.addColorStop(0.55, '#8E75B2')
    g.addColorStop(1, '#D96570')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.moveTo(cx, cy - 12)
    ctx.quadraticCurveTo(cx + 1.5, cy - 1.5, cx + 12, cy)
    ctx.quadraticCurveTo(cx + 1.5, cy + 1.5, cx, cy + 12)
    ctx.quadraticCurveTo(cx - 1.5, cy + 1.5, cx - 12, cy)
    ctx.quadraticCurveTo(cx - 1.5, cy - 1.5, cx, cy - 12)
    ctx.fill()
  } else if (agent === 'claude') {
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 2.6
    ctx.lineCap = 'round'
    ctx.beginPath()
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2
      ctx.moveTo(cx + Math.cos(a) * 3, cy + Math.sin(a) * 3)
      ctx.lineTo(cx + Math.cos(a) * 11, cy + Math.sin(a) * 11)
    }
    ctx.stroke()
  } else if (agent === 'codex') {
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 2
    for (let i = 0; i < 3; i++) {
      ctx.beginPath()
      ctx.ellipse(cx, cy, 11, 5, (i * Math.PI) / 3, 0, Math.PI * 2)
      ctx.stroke()
    }
  } else {
    ctx.fillStyle = '#ffffff'
    ctx.font = `600 18px ${FONT}`
    ctx.textAlign = 'center'
    ctx.fillText(name.charAt(0).toUpperCase(), cx, cy + 6.5)
  }
  ctx.restore()
}

let logo: Promise<HTMLImageElement | null> | null = null
function loadLogo(): Promise<HTMLImageElement | null> {
  logo ??= new Promise((resolve) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => resolve(null)
    image.src = '/brand/overseer-rounded.png'
  })
  return logo
}

function fit(ctx: CanvasRenderingContext2D, text: string, width: number): string {
  if (ctx.measureText(text).width <= width) return text
  let cut = text
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > width) cut = cut.slice(0, -1)
  return `${cut.trimEnd()}…`
}

// wrap breaks text into at most `lines` lines, ellipsising the last.
function wrap(ctx: CanvasRenderingContext2D, text: string, width: number, lines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  const out: string[] = []
  let current = ''
  for (let i = 0; i < words.length; i++) {
    const next = current ? `${current} ${words[i]}` : words[i]
    if (ctx.measureText(next).width <= width || !current) { current = next; continue }
    out.push(current)
    current = words[i]
    if (out.length === lines - 1) { current = words.slice(i).join(' '); break }
  }
  if (current) out.push(current)
  return out.map((row, i) => (i === lines - 1 ? fit(ctx, row, width) : row)).slice(0, lines)
}

function round(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, r)
}

function mark(ctx: CanvasRenderingContext2D, kind: '✓' | '✗' | '…', cx: number, cy: number) {
  ctx.save()
  ctx.lineWidth = 5
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.strokeStyle = kind === '✓' ? green : kind === '✗' ? red : faint
  ctx.beginPath()
  if (kind === '✓') { ctx.moveTo(cx - 10, cy + 1); ctx.lineTo(cx - 3, cy + 8); ctx.lineTo(cx + 11, cy - 8) }
  else if (kind === '✗') { ctx.moveTo(cx - 8, cy - 8); ctx.lineTo(cx + 8, cy + 8); ctx.moveTo(cx + 8, cy - 8); ctx.lineTo(cx - 8, cy + 8) }
  else { ctx.fillStyle = faint; [-10, 0, 10].forEach((dx) => { ctx.moveTo(cx + dx + 2, cy); ctx.arc(cx + dx, cy, 2, 0, Math.PI * 2) }) }
  ctx.stroke()
  ctx.restore()
}

export async function renderArenaCard(a: Arena, scale = 2): Promise<HTMLCanvasElement> {
  await Promise.all([
    document.fonts?.load(`600 24px Inter`).catch(() => {}),
    document.fonts?.load(`450 18px Inter`).catch(() => {}),
  ])
  const image = await loadLogo()
  const canvas = document.createElement('canvas')
  canvas.width = W * scale
  canvas.height = H * scale
  const ctx = canvas.getContext('2d')!
  ctx.scale(scale, scale)
  ctx.textBaseline = 'alphabetic'

  // Paper.
  ctx.fillStyle = '#fbfbfa'
  ctx.fillRect(0, 0, W, H)
  const glow = ctx.createRadialGradient(W - 120, -60, 20, W - 120, -60, 560)
  glow.addColorStop(0, 'rgba(11, 85, 255, 0.10)')
  glow.addColorStop(1, 'rgba(11, 85, 255, 0)')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, W, H)

  // Head: mark + name on the left, what ran on the right.
  if (image) ctx.drawImage(image, PAD, 44, 38, 38)
  ctx.fillStyle = ink
  ctx.font = `600 22px ${FONT}`
  ctx.fillText('Agent Arena', PAD + 50, 70)
  const repo = (a.repoRoot || a.cwd).replace(/[\\/]+$/, '').split(/[\\/]/).pop() || ''
  ctx.textAlign = 'right'
  ctx.fillStyle = soft
  ctx.font = `450 18px ${FONT}`
  ctx.fillText(fit(ctx, `${a.contestants.length} agents${repo ? ` · ${repo}` : ''}`, 420), W - PAD, 68)
  ctx.textAlign = 'left'

  // The task.
  ctx.fillStyle = ink
  ctx.font = `650 46px ${FONT}`
  const title = wrap(ctx, a.title, W - PAD * 2, 2)
  title.forEach((row, i) => ctx.fillText(row, PAD, 150 + i * 56))
  const top = 150 + (title.length - 1) * 56 + 46

  // One row per contestant.
  const now = Date.now()
  const rows = a.contestants.length
  const bottom = H - 96
  const gap = 12
  const rowH = Math.min(92, (bottom - top - gap * (rows - 1)) / rows)
  a.contestants.forEach((c, i) => {
    const y = top + i * (rowH + gap)
    const won = a.winner === c.n
    ctx.fillStyle = '#ffffff'
    round(ctx, PAD, y, W - PAD * 2, rowH, 16)
    ctx.fill()
    ctx.lineWidth = won ? 2 : 1
    ctx.strokeStyle = won ? blue : line
    ctx.stroke()

    const cy = y + rowH / 2
    agentBadge(ctx, c.agent, agentLabel(c.agent), PAD + 40, cy)

    const name = agentLabel(c.agent)
    const detail = modelLabel(c)
    ctx.fillStyle = ink
    ctx.font = `600 26px ${FONT}`
    const nameY = detail ? cy - 3 : cy + 9
    ctx.fillText(fit(ctx, name, 340), PAD + 74, nameY)
    const nameWidth = Math.min(ctx.measureText(name).width, 340)
    if (won) {
      ctx.font = `600 13px ${FONT}`
      const tag = 'WINNER'
      const tw = ctx.measureText(tag).width + 18
      ctx.fillStyle = blue
      round(ctx, PAD + 74 + nameWidth + 14, nameY - 19, tw, 24, 12)
      ctx.fill()
      ctx.fillStyle = '#fff'
      ctx.fillText(tag, PAD + 74 + nameWidth + 23, nameY - 2)
    }
    if (detail) {
      ctx.fillStyle = soft
      ctx.font = `450 17px ${FONT}`
      ctx.fillText(fit(ctx, detail, 380), PAD + 74, cy + 22)
    }

    // Right side: lines, time, verdict.
    const v = verdict(a, c)
    mark(ctx, v, W - PAD - 40, cy)
    ctx.textAlign = 'right'
    ctx.font = `600 26px ${FONT}`
    ctx.fillStyle = v === '✗' ? faint : ink
    ctx.fillText(v === '✓' ? clock(elapsedMs(c, now)) : v === '✗' ? (c.state === 'done' ? 'check failed' : 'no result') : 'running', W - PAD - 80, cy + 9)
    if (c.stats && c.stats.files > 0) {
      ctx.font = `450 20px ${FONT}`
      const dels = `−${c.stats.deletions}`
      const adds = `+${c.stats.additions}`
      ctx.fillStyle = red
      ctx.fillText(dels, W - PAD - 270, cy + 7)
      const dw = ctx.measureText(dels).width
      ctx.fillStyle = green
      ctx.fillText(adds, W - PAD - 270 - dw - 12, cy + 7)
      ctx.fillStyle = faint
      ctx.font = `450 15px ${FONT}`
      ctx.fillText(`${c.stats.files} file${c.stats.files === 1 ? '' : 's'}`, W - PAD - 270, cy - 18)
    }
    ctx.textAlign = 'left'
  })

  // Foot.
  ctx.fillStyle = faint
  ctx.font = `450 17px ${FONT}`
  ctx.fillText('Same prompt, same code, each agent in its own copy of the repo.', PAD, H - 40)
  ctx.textAlign = 'right'
  ctx.fillStyle = soft
  ctx.font = `600 18px ${FONT}`
  ctx.fillText('Overseer', W - PAD - 30, H - 39)
  if (image) ctx.drawImage(image, W - PAD - 22, H - 58, 22, 22)
  ctx.textAlign = 'left'
  return canvas
}

export function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not make the image'))), 'image/png'))
}
