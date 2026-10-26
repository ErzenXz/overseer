import type { PortInfo, PreviewConfig } from './types'

// Demo-only live previews: a sample school website stands in for a Vite dev
// server on the Studio machine. Real hubs proxy the machine's port instead.

let config: PreviewConfig = { domain: 'example.com', source: 'derived', hubHost: 'overseer.example.com', secure: true }
let siteUrl = ''

const site = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Northside High School</title>
<style>
  :root { --ink:#101828; --muted:#566074; --line:#e7eaf0; --navy:#0c2340; --gold:#e8a317; --sky:#eaf1fb; --paper:#fbfaf7; }
  * { box-sizing: border-box; }
  html { scroll-behavior: smooth; }
  body { margin:0; font: 16px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, system-ui, sans-serif; color: var(--ink); background:#fff; -webkit-font-smoothing: antialiased; }
  h1,h2,h3 { font-family: Georgia, "Iowan Old Style", "Times New Roman", serif; font-weight: 700; letter-spacing: -.015em; margin: 0; }
  a { color: inherit; }
  .top { background: var(--navy); color: #cfd9e8; font-size: 13px; }
  .top div { display:flex; justify-content:space-between; gap:16px; padding: 8px 6vw; flex-wrap: wrap; }
  .top a { color:#fff; text-decoration:none; margin-left: 18px; }
  header { position: sticky; top: 0; z-index: 5; display:flex; align-items:center; justify-content:space-between; gap:24px; padding: 14px 6vw; background: rgba(255,255,255,.92); backdrop-filter: blur(10px); border-bottom: 1px solid var(--line); }
  .logo { display:flex; align-items:center; gap:12px; text-decoration:none; }
  .crest { display:grid; place-items:center; width:40px; height:40px; border-radius: 10px; background: var(--navy); color: var(--gold); font: 700 20px Georgia, serif; }
  .logo b { display:block; font: 700 18px/1.1 Georgia, serif; color: var(--navy); }
  .logo small { display:block; color: var(--muted); font-size: 12px; letter-spacing:.08em; text-transform: uppercase; }
  nav { display:flex; align-items:center; gap: 26px; font-size: 15px; font-weight: 500; flex-wrap: wrap; }
  nav a { text-decoration:none; color:#2c3649; } nav a:hover { color: var(--navy); }
  .cta { display:inline-block; padding: 11px 20px; border-radius: 999px; background: var(--gold); color: #1a1405; font-weight: 700; text-decoration:none; font-size: 15px; }
  .cta.dark { background: var(--navy); color:#fff; } .cta.ghost { background: transparent; border: 1px solid rgba(255,255,255,.5); color:#fff; }
  .hero { position: relative; overflow: hidden; background: linear-gradient(135deg, #0c2340 0%, #16457a 55%, #2d6bb0 100%); color:#fff; }
  .hero-in { position: relative; z-index: 2; display:grid; grid-template-columns: minmax(0,1.1fr) minmax(0,.9fr); gap: 40px; align-items: center; padding: 84px 6vw 96px; }
  .eyebrow { display:inline-flex; align-items:center; gap:8px; padding: 6px 12px; border-radius:999px; background: rgba(255,255,255,.12); font-size: 13px; letter-spacing:.04em; }
  .eyebrow i { width:8px; height:8px; border-radius:50%; background: var(--gold); }
  .hero h1 { margin: 18px 0 16px; font-size: clamp(36px, 5.2vw, 62px); line-height: 1.04; max-width: 15ch; }
  .hero p { margin: 0 0 28px; max-width: 50ch; color: #d6e2f3; font-size: 18px; }
  .hero .row { display:flex; gap:12px; flex-wrap: wrap; }
  .campus { position:absolute; right:-4%; bottom:-2px; width: 62%; max-width: 760px; opacity:.9; z-index:1; }
  .card-photo { justify-self: end; width: min(100%, 380px); aspect-ratio: 4/5; border-radius: 22px; overflow:hidden; position:relative; box-shadow: 0 30px 60px rgba(4,12,28,.45); background: linear-gradient(160deg,#f6c453,#e8793a 55%,#b5452b); }
  .card-photo svg { position:absolute; inset:0; width:100%; height:100%; }
  .card-photo figcaption { position:absolute; left:14px; right:14px; bottom:14px; padding: 12px 14px; border-radius: 14px; background: rgba(255,255,255,.94); color: var(--ink); font-size: 14px; }
  .card-photo figcaption b { display:block; font-family: Georgia, serif; font-size: 16px; }
  .stats { position: relative; z-index:3; margin: -44px 6vw 0; display:grid; grid-template-columns: repeat(4,1fr); background:#fff; border: 1px solid var(--line); border-radius: 18px; box-shadow: 0 18px 40px rgba(16,24,40,.08); }
  .stats div { padding: 24px 26px; border-left: 1px solid var(--line); } .stats div:first-child { border-left: 0; }
  .stats strong { display:block; font: 700 34px/1 Georgia, serif; color: var(--navy); } .stats span { color: var(--muted); font-size: 14px; }
  section { padding: 76px 6vw 0; }
  .kicker { color:#a86f00; font-weight: 700; font-size: 13px; letter-spacing: .1em; text-transform: uppercase; }
  h2 { font-size: clamp(28px, 3.4vw, 40px); margin: 8px 0 12px; color: var(--navy); }
  .lead { color: var(--muted); max-width: 60ch; margin: 0 0 30px; font-size: 17px; }
  .programs { display:grid; grid-template-columns: repeat(auto-fit,minmax(230px,1fr)); gap: 18px; }
  .program { border: 1px solid var(--line); border-radius: 18px; padding: 22px; background: #fff; transition: transform .2s, box-shadow .2s; }
  .program:hover { transform: translateY(-3px); box-shadow: 0 16px 34px rgba(16,24,40,.09); }
  .ico { display:grid; place-items:center; width:46px; height:46px; border-radius: 12px; font-size: 22px; margin-bottom: 14px; }
  .program h3 { font-size: 20px; margin-bottom: 6px; color: var(--navy); } .program p { margin:0; color: var(--muted); font-size: 15px; }
  .split { display:grid; grid-template-columns: minmax(0,1fr) minmax(0,1fr); gap: 22px; }
  .events { background: var(--sky); border-radius: 22px; padding: 28px; }
  .event { display:flex; gap:16px; padding: 14px 0; border-top: 1px solid rgba(12,35,64,.1); } .event:first-of-type { border-top:0; }
  .date { flex: 0 0 56px; text-align:center; border-radius: 12px; background:#fff; padding: 6px 0; line-height:1.1; font-weight:700; color: var(--navy); }
  .date small { display:block; font-size: 11px; letter-spacing:.08em; color:#a86f00; text-transform: uppercase; } .date span { font: 700 24px Georgia, serif; }
  .event b { display:block; } .event p { margin: 2px 0 0; color: var(--muted); font-size: 14px; }
  .quote { border-radius: 22px; padding: 32px; background: var(--paper); border: 1px solid var(--line); display:flex; flex-direction:column; justify-content:space-between; }
  .quote blockquote { margin:0; font: 600 23px/1.4 Georgia, serif; color: var(--navy); }
  .quote footer { display:flex; align-items:center; gap:12px; margin-top: 22px; color: var(--muted); font-size: 14px; }
  .avatar { width:42px; height:42px; border-radius:50%; background: linear-gradient(135deg,#f6c453,#e8793a); }
  .band { margin: 76px 6vw 0; padding: 40px 44px; border-radius: 24px; background: linear-gradient(120deg,#0c2340,#1d5a9a); color:#fff; display:flex; align-items:center; justify-content:space-between; gap: 24px; flex-wrap: wrap; }
  .band h2 { color:#fff; margin:0 0 6px; } .band p { margin:0; color:#cfe0f5; }
  footer.site { margin-top: 76px; padding: 36px 6vw; border-top: 1px solid var(--line); color: var(--muted); font-size: 14px; display:flex; justify-content:space-between; gap:16px; flex-wrap: wrap; }
  @media (max-width: 880px) {
    .hero-in, .split { grid-template-columns: 1fr; }
    .hero-in { padding: 44px 6vw 72px; gap: 28px; }
    .card-photo { justify-self: stretch; width: 100%; aspect-ratio: 16/8; border-radius: 18px; }
    .card-photo figcaption { left: 10px; right: 10px; bottom: 10px; padding: 9px 12px; font-size: 13px; }
    .stats { grid-template-columns: 1fr 1fr; margin-top: -36px; }
    .stats div { padding: 16px 20px; } .stats div:nth-child(3) { border-left: 0; } .stats div:nth-child(n+3) { border-top: 1px solid var(--line); }
    .stats strong { font-size: 28px; }
    nav a:not(.cta) { display:none; } .top div > span:last-child { display:none; } .campus { display:none; }
    section { padding-top: 52px; }
  }
</style></head>
<body>
  <div class="top"><div><span>400 Elm Street · (555) 010-2040 · Open 7:30–4:30</span><span><a href="#">Parents</a><a href="#">Staff</a><a href="#">Alumni</a></span></div></div>
  <header>
    <a class="logo" href="#"><span class="crest">N</span><span><b>Northside High</b><small>Home of the Herons</small></span></a>
    <nav><a href="#">About</a><a href="#">Academics</a><a href="#">Athletics</a><a href="#">Arts</a><a href="#">Calendar</a><a class="cta dark" href="#">Apply for 2027</a></nav>
  </header>
  <div class="hero">
    <svg class="campus" viewBox="0 0 760 260" fill="none" aria-hidden="true"><path d="M0 260V176l70-26 70 26 40-34h120l30-60 60-34 60 34 30 60h120l40 34 70-26 70 26v84z" fill="#0a1d36" opacity=".55"/><path d="M180 260V150h110v110zM470 260V150h110v110z" fill="#0f2c52" opacity=".7"/><g fill="#e8a317" opacity=".85"><rect x="200" y="170" width="18" height="24" rx="3"/><rect x="232" y="170" width="18" height="24" rx="3"/><rect x="264" y="170" width="14" height="24" rx="3"/><rect x="492" y="170" width="18" height="24" rx="3"/><rect x="524" y="170" width="18" height="24" rx="3"/><rect x="556" y="170" width="14" height="24" rx="3"/></g></svg>
    <div class="hero-in">
      <div>
        <span class="eyebrow"><i></i>Now enrolling for fall 2027</span>
        <h1>Learning that goes further.</h1>
        <p>Northside is a public high school of 1,200 students, with strong arts, a nationally ranked robotics team and a debate program that has won three state titles in a row.</p>
        <div class="row"><a class="cta" href="#">Plan a visit</a><a class="cta ghost" href="#">Download the course guide</a></div>
      </div>
      <figure class="card-photo" style="margin:0">
        <svg viewBox="0 0 380 475" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><circle cx="270" cy="120" r="64" fill="#fff6d6" opacity=".85"/><path d="M0 330c60-50 120-44 190-12s130 20 190-22v179H0z" fill="#8a2f1f" opacity=".55"/><path d="M0 380c70-34 140-26 200 0s120 12 180-18v113H0z" fill="#5a1d13" opacity=".7"/><g fill="#2b1410"><circle cx="120" cy="262" r="26"/><rect x="92" y="286" width="56" height="130" rx="26"/><circle cx="214" cy="274" r="23"/><rect x="190" y="296" width="48" height="120" rx="23"/><circle cx="294" cy="268" r="25"/><rect x="268" y="292" width="52" height="124" rx="25"/></g></svg>
        <figcaption><b>Robotics team wins regionals</b>Third title in four years, and on to nationals in April.</figcaption>
      </figure>
    </div>
  </div>
  <div class="stats"><div><strong>96%</strong><span>graduate on time</span></div><div><strong>28</strong><span>AP and honors courses</span></div><div><strong>14:1</strong><span>students per teacher</span></div><div><strong>40+</strong><span>clubs and teams</span></div></div>

  <section>
    <div class="kicker">Programs</div><h2>Find the path that fits you</h2>
    <p class="lead">Four pathways, one community. Every student builds a portfolio and graduates with real projects behind them.</p>
    <div class="programs">
      <div class="program"><div class="ico" style="background:#e8f0fe">🧪</div><h3>STEM Academy</h3><p>Engineering, computer science and lab sciences with university partners.</p></div>
      <div class="program"><div class="ico" style="background:#fdf0d5">🎭</div><h3>Arts &amp; Media</h3><p>Theatre, studio art, film and a 200-seat black-box stage of our own.</p></div>
      <div class="program"><div class="ico" style="background:#e3f6ec">🌱</div><h3>Environmental Studies</h3><p>Field research, a working school garden and a solar-powered greenhouse.</p></div>
      <div class="program"><div class="ico" style="background:#fde8e8">⚖️</div><h3>Law &amp; Debate</h3><p>Mock trial, public speaking and a three-time state champion team.</p></div>
    </div>
  </section>

  <section>
    <div class="split">
      <div class="events">
        <div class="kicker">Coming up</div><h2 style="margin-bottom:10px">On the calendar</h2>
        <div class="event"><div class="date"><small>Oct</small><span>24</span></div><div><b>Fall open house</b><p>Tour classrooms and meet teachers, 6–8 pm.</p></div></div>
        <div class="event"><div class="date"><small>Nov</small><span>02</span></div><div><b>Robotics regional</b><p>Our team defends last year’s title at the Civic Arena.</p></div></div>
        <div class="event"><div class="date"><small>Nov</small><span>14</span></div><div><b>Winter concert</b><p>Choir, band and orchestra in the main hall.</p></div></div>
      </div>
      <div class="quote">
        <blockquote>“The teachers here treat you like a colleague. I built a working rover in my junior year and my physics teacher drove it across the gym.”</blockquote>
        <footer><span class="avatar"></span><span><b style="color:var(--ink)">Maya Okafor</b><br>Class of 2026, now at Georgia Tech</span></footer>
      </div>
    </div>
  </section>

  <div class="band"><div><h2>Come and see it for yourself</h2><p>Tours run every Tuesday and Thursday at 9 am. No sign-up needed.</p></div><a class="cta" href="#">Book a tour</a></div>
  <footer class="site"><span>© 2026 Northside High School · 400 Elm Street</span><span>Privacy · Accessibility · Contact</span></footer>
</body></html>`

function siteBlob() {
  if (!siteUrl) siteUrl = URL.createObjectURL(new Blob([site], { type: 'text/html' }))
  return siteUrl
}

function portsFor(deviceId: string): PortInfo[] {
  if (deviceId !== 'studio') return []
  const preview = (port: number) => config.domain ? siteBlob() + `#${port}` : ''
  return [
    { port: 5173, address: '127.0.0.1', pid: 48211, process: 'node', command: 'vite --port 5173', cwd: '~/Projects/codex-harness', http: true, title: 'Northside High School', previewUrl: preview(5173) },
    { port: 6006, address: '0.0.0.0', pid: 48302, process: 'node', command: 'storybook dev -p 6006', cwd: '~/Projects/codex-harness', http: true, title: 'Storybook', previewUrl: preview(6006) },
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
