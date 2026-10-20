import type { PortInfo, PreviewConfig } from './types'

// Demo-only live previews: a sample school website stands in for a Vite dev
// server on the Studio machine. Real hubs proxy the machine's port instead.

let config: PreviewConfig = { domain: 'example.com', source: 'derived', hubHost: 'overseer.example.com', secure: true }
let siteUrl = ''

const site = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Northside High School</title>
<style>
  :root { --ink:#13233a; --muted:#5b6b80; --brand:#1d4ed8; --soft:#eef3fb; }
  * { box-sizing: border-box; } body { margin:0; font: 16px/1.55 system-ui, -apple-system, Segoe UI, sans-serif; color: var(--ink); }
  header { display:flex; align-items:center; justify-content:space-between; gap:16px; padding:16px 6vw; border-bottom:1px solid #e6ebf2; position:sticky; top:0; background:#fff; }
  .logo { display:flex; align-items:center; gap:10px; font-weight:700; } .logo span { display:grid; place-items:center; width:34px; height:34px; border-radius:9px; background:var(--brand); color:#fff; }
  nav { display:flex; gap:18px; flex-wrap:wrap; font-size:15px; } nav a { color:var(--muted); text-decoration:none; } nav a:hover { color:var(--ink); }
  .hero { padding:72px 6vw 56px; background:linear-gradient(180deg,var(--soft),#fff); }
  .hero h1 { margin:0 0 12px; font-size:clamp(30px,5vw,52px); line-height:1.08; letter-spacing:-.02em; max-width:14ch; }
  .hero p { margin:0 0 24px; max-width:52ch; color:var(--muted); font-size:18px; }
  .btn { display:inline-block; padding:11px 18px; border-radius:10px; background:var(--brand); color:#fff; text-decoration:none; font-weight:600; margin-right:8px; }
  .btn.alt { background:#fff; color:var(--ink); border:1px solid #d7dee8; }
  section { padding:40px 6vw; } h2 { margin:0 0 18px; font-size:24px; }
  .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:16px; }
  .card { border:1px solid #e6ebf2; border-radius:14px; padding:18px; background:#fff; }
  .card b { display:block; margin-bottom:4px; } .date { color:var(--brand); font-size:13px; font-weight:600; text-transform:uppercase; letter-spacing:.04em; }
  footer { padding:28px 6vw; color:var(--muted); font-size:14px; border-top:1px solid #e6ebf2; }
</style></head>
<body>
  <header><div class="logo"><span>N</span>Northside High</div>
    <nav><a href="#">About</a><a href="#">Academics</a><a href="#">Athletics</a><a href="#">Calendar</a><a href="#">Contact</a></nav></header>
  <div class="hero"><h1>Learning that goes further.</h1>
    <p>Northside is a public high school of 1,200 students, with strong arts, robotics and a championship debate team.</p>
    <a class="btn" href="#">Plan a visit</a><a class="btn alt" href="#">Apply for 2027</a></div>
  <section><h2>Coming up</h2><div class="grid">
    <div class="card"><div class="date">Oct 24</div><b>Fall open house</b>Tour classrooms and meet teachers, 6–8 pm.</div>
    <div class="card"><div class="date">Nov 2</div><b>Robotics regional</b>Our team defends last year’s title.</div>
    <div class="card"><div class="date">Nov 14</div><b>Winter concert</b>Choir, band and orchestra in the main hall.</div>
  </div></section>
  <footer>Northside High School · 400 Elm Street · (555) 010-2040</footer>
</body></html>`

function siteBlob() {
  if (!siteUrl) siteUrl = URL.createObjectURL(new Blob([site], { type: 'text/html' }))
  return siteUrl
}

function portsFor(deviceId: string): PortInfo[] {
  if (deviceId !== 'studio') return []
  const preview = (port: number) => config.domain ? siteBlob() + `#${port}` : ''
  return [
    { port: 5173, address: '127.0.0.1', pid: 48211, process: 'node', command: 'vite --port 5173', cwd: '/home/erzen/Projects/school-site', http: true, title: 'Northside High School', previewUrl: preview(5173) },
    { port: 6006, address: '0.0.0.0', pid: 48302, process: 'node', command: 'storybook dev -p 6006', cwd: '/home/erzen/Projects/school-site', http: true, title: 'Storybook', previewUrl: preview(6006) },
    { port: 5432, address: '127.0.0.1', pid: 912, process: 'postgres', http: false, previewUrl: '' },
  ]
}

export function previewRoute(method: string, path: string, body: Record<string, unknown>): Response | null {
  const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
  if (path === '/api/previews/config') {
    if (method === 'PUT') {
      const domain = String(body.domain ?? '').trim().toLowerCase()
      if (domain && !/^([a-z0-9-]+\.)+[a-z]{2,}$|^localhost$/.test(domain)) return json({ error: 'enter a domain like example.com' }, 400)
      config = domain ? { ...config, domain, source: 'setting' } : { ...config, domain: 'example.com', source: 'derived' }
    }
    return json(config)
  }
  const match = path.match(/^\/api\/devices\/([^/]+)\/ports$/)
  if (match && method === 'GET') return json(portsFor(decodeURIComponent(match[1])))
  return null
}
