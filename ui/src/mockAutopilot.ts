// DEV-ONLY MOCK (see mock.ts): the issue autopilot with three handled issues
// (one working, one with a pull request, one failed) and a session with
// before/after screenshots.

import type { AutopilotRepo, AutopilotRun, CloneInfo, ShotsReply, ThreadShot } from './autopilot'

const now = () => Math.floor(Date.now() / 1000)
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })

let repos: AutopilotRepo[] = [
  {
    id: 'apr_web', repo: 'acme-labs/web', enabled: true, label: 'overseer', agent: 'claude', model: 'sonnet', mode: 'auto', access: 'auto',
    deviceId: '', ghDeviceId: 'macbook', maxConcurrent: 2, trust: 'writers', comment: true, footer: true,
    createdAt: now() - 86400 * 6, lastPollAt: now() - 74, active: 1,
  },
]

let runs: AutopilotRun[] = [
  {
    id: 'apn_212', repoId: 'apr_web', repo: 'acme-labs/web', number: 212, title: 'Hero heading is cut off on small screens',
    url: 'https://github.com/acme-labs/web/issues/212', author: 'priya-s', labeller: 'dan-w', status: 'working', deviceId: 'studio', deviceName: 'Studio',
    threadId: 'th_archive', branch: 'overseer/issue-212-hero-heading-is-cut-off-on-small-screens', attempt: 1,
    createdAt: now() - 60 * 11, updatedAt: now() - 40, startedAt: now() - 60 * 10, threadStatus: 'working',
  },
  {
    id: 'apn_207', repoId: 'apr_web', repo: 'acme-labs/web', number: 207, title: 'Add a dark mode toggle to the header',
    url: 'https://github.com/acme-labs/web/issues/207', author: 'dan-w', labeller: 'dan-w', status: 'pr_open', deviceId: 'macbook', deviceName: 'MacBook Pro',
    threadId: 'th_ui', branch: 'overseer/issue-207-add-a-dark-mode-toggle-to-the-header', prNumber: 241, prUrl: 'https://github.com/acme-labs/web/pull/241', attempt: 1,
    createdAt: now() - 3600 * 5, updatedAt: now() - 3600 * 4, startedAt: now() - 3600 * 5, finishedAt: now() - 3600 * 4,
  },
  {
    id: 'apn_203', repoId: 'apr_web', repo: 'acme-labs/web', number: 203, title: 'Migrate the newsletter form to the new mailing API',
    url: 'https://github.com/acme-labs/web/issues/203', author: 'priya-s', labeller: 'dan-w', status: 'failed', deviceId: 'studio', deviceName: 'Studio',
    threadId: 'th_store', branch: 'overseer/issue-203-migrate-the-newsletter-form-to-the-new-mailing-api', attempt: 1,
    detail: 'The agent finished without changing any files, so there is nothing to propose.\n\nWhat it said: The new API needs a key that is not in the repo or its .env.example. Add MAILING_API_KEY to the project settings and label this issue again.',
    createdAt: now() - 86400, updatedAt: now() - 86400 + 60 * 9, startedAt: now() - 86400, finishedAt: now() - 86400 + 60 * 9,
  },
]

// ---- pictures: a small made-up site, before and after the change ----

const svg = (body: string, w: number, h: number) => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" font-family="Inter, system-ui, sans-serif">${body}</svg>`)}`

function desktop(after: boolean) {
  const brand = after ? '#1d4ed8' : '#475569'
  return svg(`
    <rect width="1440" height="900" fill="#f8fafc"/>
    <rect width="1440" height="72" fill="#fff"/><rect y="71" width="1440" height="1" fill="#e2e8f0"/>
    <rect x="64" y="22" width="30" height="30" rx="8" fill="${brand}"/><text x="108" y="44" font-size="20" font-weight="700" fill="#0f172a">Northside High</text>
    <g font-size="16" fill="#64748b"><text x="860" y="42">About</text><text x="936" y="42">Academics</text><text x="1050" y="42">Athletics</text><text x="1150" y="42">Calendar</text></g>
    ${after ? '<rect x="1262" y="20" width="114" height="34" rx="17" fill="#1d4ed8"/><text x="1286" y="42" font-size="15" font-weight="600" fill="#fff">Visit us</text>' : ''}
    <text x="64" y="${after ? 210 : 200}" font-size="${after ? 68 : 58}" font-weight="700" fill="#0f172a" letter-spacing="-1.5">Learning that</text>
    <text x="64" y="${after ? 288 : 270}" font-size="${after ? 68 : 58}" font-weight="700" fill="${after ? '#1d4ed8' : '#0f172a'}" letter-spacing="-1.5">goes further.</text>
    <text x="64" y="${after ? 352 : 330}" font-size="20" fill="#64748b">A public high school of 1,200 students, with strong arts,</text>
    <text x="64" y="${after ? 382 : 360}" font-size="20" fill="#64748b">robotics and a championship debate team.</text>
    <rect x="64" y="${after ? 420 : 398}" width="160" height="48" rx="10" fill="${brand}"/><text x="94" y="${after ? 451 : 429}" font-size="17" font-weight="600" fill="#fff">Plan a visit</text>
    <rect x="236" y="${after ? 420 : 398}" width="170" height="48" rx="10" fill="#fff" stroke="#cbd5e1"/><text x="268" y="${after ? 451 : 429}" font-size="17" font-weight="600" fill="#0f172a">Apply for 2027</text>
    <g transform="translate(0 ${after ? 120 : 100})">
      <rect x="64" y="440" width="410" height="170" rx="14" fill="#fff" stroke="#e2e8f0"/><rect x="515" y="440" width="410" height="170" rx="14" fill="#fff" stroke="#e2e8f0"/><rect x="966" y="440" width="410" height="170" rx="14" fill="#fff" stroke="#e2e8f0"/>
      <g font-size="13" font-weight="700" fill="${brand}"><text x="88" y="476">OCT 24</text><text x="539" y="476">NOV 2</text><text x="990" y="476">NOV 14</text></g>
      <g font-size="19" font-weight="600" fill="#0f172a"><text x="88" y="508">Fall open house</text><text x="539" y="508">Robotics regional</text><text x="990" y="508">Winter concert</text></g>
      <g font-size="15" fill="#64748b"><text x="88" y="538">Tour classrooms, 6 to 8 pm.</text><text x="539" y="538">We defend last year's title.</text><text x="990" y="538">Choir, band and orchestra.</text></g>
    </g>`, 1440, 900)
}

function phone(after: boolean) {
  const brand = after ? '#1d4ed8' : '#475569'
  return svg(`
    <rect width="390" height="844" fill="#f8fafc"/>
    <rect width="390" height="64" fill="#fff"/><rect y="63" width="390" height="1" fill="#e2e8f0"/>
    <rect x="20" y="17" width="30" height="30" rx="8" fill="${brand}"/><text x="60" y="38" font-size="18" font-weight="700" fill="#0f172a">Northside High</text>
    <g stroke="#0f172a" stroke-width="2" stroke-linecap="round"><path d="M340 24h22M340 32h22M340 40h22"/></g>
    ${after
      ? '<text x="20" y="150" font-size="38" font-weight="700" fill="#0f172a" letter-spacing="-1">Learning that</text><text x="20" y="196" font-size="38" font-weight="700" fill="#1d4ed8" letter-spacing="-1">goes further.</text>'
      : '<text x="20" y="150" font-size="38" font-weight="700" fill="#0f172a" letter-spacing="-1">Learning that go</text>'}
    <text x="20" y="${after ? 240 : 190}" font-size="16" fill="#64748b">A public high school of 1,200</text>
    <text x="20" y="${after ? 264 : 214}" font-size="16" fill="#64748b">students, with strong arts.</text>
    <rect x="20" y="${after ? 290 : 240}" width="150" height="46" rx="10" fill="${brand}"/><text x="46" y="${after ? 319 : 269}" font-size="16" font-weight="600" fill="#fff">Plan a visit</text>
    <rect x="20" y="${after ? 380 : 330}" width="350" height="120" rx="14" fill="#fff" stroke="#e2e8f0"/>
    <text x="40" y="${after ? 414 : 364}" font-size="12" font-weight="700" fill="${brand}">OCT 24</text><text x="40" y="${after ? 442 : 392}" font-size="18" font-weight="600" fill="#0f172a">Fall open house</text><text x="40" y="${after ? 468 : 418}" font-size="14" fill="#64748b">Tour classrooms, 6 to 8 pm.</text>
  `, 390, 844)
}

const shot = (threadId: string, kind: ThreadShot['kind'], form: ThreadShot['form'], note?: string): ThreadShot => ({
  id: `shot_${threadId}_${kind}_${form}`, threadId, kind, form, port: 5173, mime: 'image/svg+xml', width: form === 'phone' ? 390 : 1440, height: form === 'phone' ? 844 : 900,
  size: 18_000, createdAt: now() - (kind === 'before' ? 60 * 9 : 60 * 2), url: kind === 'before' ? (form === 'phone' ? phone(false) : desktop(false)) : (form === 'phone' ? phone(true) : desktop(true)), note,
})

const shotsByThread: Record<string, ThreadShot[]> = {
  th_archive: [
    shot('th_archive', 'before', 'desktop', 'Taken when the preview first appeared. 2 files had already changed.'),
    shot('th_archive', 'after', 'desktop'),
    shot('th_archive', 'before', 'phone'),
    shot('th_archive', 'after', 'phone'),
  ],
}
const prInfo: Record<string, ShotsReply['info']['pr']> = {
  th_archive: { state: 'skipped', reason: 'This hub is reached over http, so GitHub could not load pictures from it. It needs a public https address.' },
}
let shotsConfig = { enabled: true, phone: true, prComment: true }

function shotsReply(threadId: string): ShotsReply {
  return {
    shots: shotsByThread[threadId] ?? [],
    info: { pr: prInfo[threadId] ?? {} },
    config: shotsConfig,
    publicReason: 'This hub is reached over http, so GitHub could not load pictures from it. It needs a public https address.',
  }
}

const clones: CloneInfo[] = [
  { deviceId: 'homelab', name: 'Homelab', hasClone: false, busy: 0 },
  { deviceId: 'macbook', name: 'MacBook Pro', hasClone: true, path: '~/Projects/web', busy: 1 },
  { deviceId: 'studio', name: 'Studio', hasClone: true, path: '~/code/web', busy: 2 },
]

export function autopilotRoute(method: string, path: string, body: Record<string, unknown>): Response | null {
  if (method === 'GET' && path === '/api/autopilot') {
    const active = runs.filter((run) => run.status === 'working' || run.status === 'preparing' || run.status === 'finishing').length
    return json({ repos: repos.map((repo) => ({ ...repo, active: repo.id === 'apr_web' ? active : 0 })), runs: [...runs].sort((a, b) => b.updatedAt - a.updatedAt) })
  }
  if (method === 'GET' && path === '/api/autopilot/clones') return json(clones)
  if (method === 'POST' && path === '/api/autopilot/repos') {
    if (!body.acknowledge) return json({ error: 'confirm that you understand issues are untrusted input before turning this on' }, 400)
    const name = String(body.repo ?? '')
    if (!/^[\w.-]+\/[\w.-]+$/.test(name)) return json({ error: 'repo must be owner/name' }, 400)
    if (repos.some((repo) => repo.repo.toLowerCase() === name.toLowerCase())) return json({ error: `${name} is already set up` }, 409)
    const repo: AutopilotRepo = {
      id: `apr_${Math.random().toString(36).slice(2, 8)}`, repo: name, enabled: true, label: String(body.label || 'overseer'), agent: String(body.agent || 'claude'),
      model: String(body.model ?? ''), effort: String(body.effort ?? ''), mode: String(body.mode ?? ''), access: String(body.access || 'auto'),
      deviceId: String(body.deviceId ?? ''), ghDeviceId: String(body.ghDeviceId ?? 'macbook'), maxConcurrent: Number(body.maxConcurrent || 1),
      trust: body.trust === 'me' ? 'me' : 'writers', comment: body.comment !== false, footer: body.footer !== false, createdAt: now(), lastPollAt: 0, active: 0,
    }
    repos = [...repos, repo]
    return json(repo)
  }
  const repoMatch = path.match(/^\/api\/autopilot\/repos\/([^/]+)(\/poll)?$/)
  if (repoMatch) {
    const id = repoMatch[1]
    if (repoMatch[2] && method === 'POST') { repos = repos.map((repo) => repo.id === id ? { ...repo, lastPollAt: now() } : repo); return json({ ok: true }) }
    if (method === 'PATCH') {
      repos = repos.map((repo) => repo.id === id ? { ...repo, ...body, id } as AutopilotRepo : repo)
      return json(repos.find((repo) => repo.id === id))
    }
    if (method === 'DELETE') { repos = repos.filter((repo) => repo.id !== id); return json({ ok: true }) }
  }
  const runMatch = path.match(/^\/api\/autopilot\/runs\/([^/]+)\/(retry|approve|stop)$/)
  if (runMatch && method === 'POST') {
    const [, id, action] = runMatch
    runs = runs.map((run) => {
      if (run.id !== id) return run
      if (action === 'retry') return { ...run, status: 'queued', detail: '', attempt: run.attempt + 1, updatedAt: now() }
      if (action === 'approve') return { ...run, status: 'queued', detail: '', approved: true, updatedAt: now() }
      return { ...run, status: 'failed', detail: 'Stopped by you.', updatedAt: now() }
    })
    return json(runs.find((run) => run.id === id))
  }
  const byThread = path.match(/^\/api\/autopilot\/by-thread\/([^/]+)$/)
  if (byThread && method === 'GET') return json({ run: runs.find((run) => run.threadId === byThread[1]) ?? null })

  if (path === '/api/shots/config') {
    if (method === 'PUT') shotsConfig = { ...shotsConfig, ...(body as Partial<typeof shotsConfig>) }
    return json({ config: shotsConfig, publicReason: shotsReply('').publicReason })
  }
  const shotsMatch = path.match(/^\/api\/threads\/([^/]+)\/shots$/)
  if (shotsMatch) {
    const id = decodeURIComponent(shotsMatch[1])
    if (method === 'GET') return json(shotsReply(id))
    if (method === 'DELETE') { delete shotsByThread[id]; return json({ ok: true }) }
    if (method === 'POST') {
      const kind = body.kind === 'before' ? 'before' : 'after'
      const list = (shotsByThread[id] ?? []).filter((item) => !(item.kind === kind && item.form === 'desktop'))
      shotsByThread[id] = [...list, shot(id, kind, 'desktop')]
      return json(shotsReply(id))
    }
  }
  return null
}
