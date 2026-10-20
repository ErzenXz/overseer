import type { CatalogPlugin, ExtItem } from './types'

// Demo-only Skills & plugins data: a realistic mix across Claude Code, Codex
// and Devin on one machine, with a skill they share.

const home = '/Users/you'
let items: ExtItem[] = [
  { key: 's1', agent: 'codex', kind: 'skill', name: 'release-notes', qualifiedName: 'release-notes', description: 'Write release notes from merged PRs in our house style', scope: 'user', path: `${home}/.agents/skills/release-notes/SKILL.md`, enabled: true, invocation: { user: true, model: true }, sharedWith: ['claude', 'devin'], usage: { count: 14 } },
  { key: 's2', agent: 'claude', kind: 'skill', name: 'nextjs', qualifiedName: 'vercel:nextjs', description: 'Next.js App Router patterns, caching and deployment on Vercel', scope: 'plugin', parentId: 'vercel@claude-plugins-official', path: `${home}/.claude/plugins/cache/vercel/skills/nextjs/SKILL.md`, enabled: true, lockedBy: 'plugin', invocation: { user: true, model: true }, cost: { alwaysOnTokens: 48, onInvokeTokens: 2100 } },
  { key: 's3', agent: 'claude', kind: 'skill', name: 'pdf', qualifiedName: 'pdf', description: 'Read, fill and create PDF documents', scope: 'user', path: `${home}/.claude/skills/pdf/SKILL.md`, enabled: false, invocation: { user: true, model: true } },
  { key: 's4', agent: 'codex', kind: 'skill', name: 'skill-creator', qualifiedName: 'skill-creator', description: 'Guide for creating new skills', scope: 'system', enabled: true, invocation: { user: true, model: true } },
  { key: 's5', agent: 'devin', kind: 'skill', name: 'db-migrations', qualifiedName: 'db-migrations', description: 'Write and check Postgres migrations safely', scope: 'project', projectPath: `${home}/Projects/school-site`, path: `${home}/Projects/school-site/.devin/skills/db-migrations/SKILL.md`, enabled: true },
  { key: 'p1', agent: 'claude', kind: 'plugin', name: 'vercel', qualifiedName: 'vercel@claude-plugins-official', description: 'Deploy and manage Vercel projects, with Next.js and AI SDK skills', scope: 'user', version: '0.42.0', enabled: true, source: { type: 'github', repo: 'vercel/vercel-plugin' } },
  { key: 'p2', agent: 'claude', kind: 'plugin', name: 'github', qualifiedName: 'github@claude-plugins-official', description: 'GitHub issues, pull requests and reviews', scope: 'user', version: '1.3.1', enabled: false },
  { key: 'p3', agent: 'codex', kind: 'plugin', name: 'linear', qualifiedName: 'linear@openai-curated', description: 'Plan and track work in Linear', scope: 'user', enabled: true },
  { key: 'm1', agent: 'claude', kind: 'marketplace', name: 'claude-plugins-official', qualifiedName: 'claude-plugins-official', description: 'Anthropic’s official plugin marketplace', scope: 'user', enabled: null, source: { type: 'github', repo: 'anthropics/claude-plugins-official' } },
  { key: 'c1', agent: 'claude', kind: 'command', name: 'review', qualifiedName: 'review', description: 'Review the current branch against main', scope: 'user', path: `${home}/.claude/commands/review.md`, enabled: null, invocation: { user: true, model: false, argumentHint: '[branch]' } },
  { key: 'c2', agent: 'claude', kind: 'output_style', name: 'Explanatory', qualifiedName: 'explanatory', description: 'Explains its choices as it works', scope: 'builtin', enabled: null },
  { key: 'a1', agent: 'claude', kind: 'subagent', name: 'code-reviewer', qualifiedName: 'code-reviewer', description: 'Reviews diffs for bugs and missing tests', scope: 'user', path: `${home}/.claude/agents/code-reviewer.md`, enabled: null },
  { key: 'r1', agent: 'claude', kind: 'rule', name: 'CLAUDE.md', qualifiedName: 'CLAUDE.md', description: 'Your global instructions', scope: 'user', path: `${home}/.claude/CLAUDE.md`, enabled: null },
  { key: 'r2', agent: 'codex', kind: 'rule', name: 'AGENTS.md', qualifiedName: 'AGENTS.md', description: 'Project instructions', scope: 'project', projectPath: `${home}/Projects/school-site`, path: `${home}/Projects/school-site/AGENTS.md`, enabled: null, sharedWith: ['devin'] },
  { key: 'h1', agent: 'claude', kind: 'hook', name: 'format on save', qualifiedName: 'PostToolUse', scope: 'user', enabled: null, hook: { event: 'PostToolUse', matcher: 'Edit|Write', handlerType: 'command', command: 'npx prettier --write "$FILE"' } },
  { key: 'h2', agent: 'codex', kind: 'hook', name: 'block secrets', qualifiedName: 'PreToolUse', scope: 'user', enabled: true, state: 'untrusted', hook: { event: 'PreToolUse', handlerType: 'command', command: '~/.codex/hooks/no-secrets.sh', trust: 'untrusted' } },
  { key: 'mc1', agent: 'claude', kind: 'mcp_server', name: 'linear', qualifiedName: 'linear', scope: 'user', enabled: true, mcp: { transport: 'http', url: 'https://mcp.linear.app/mcp', authStatus: 'connected', toolCount: 23 } },
  { key: 'mc2', agent: 'codex', kind: 'mcp_server', name: 'playwright', qualifiedName: 'playwright', scope: 'user', enabled: true, mcp: { transport: 'stdio', command: 'npx @playwright/mcp@latest', toolCount: 21 } },
  { key: 'mc3', agent: 'devin', kind: 'mcp_server', name: 'sentry', qualifiedName: 'sentry', scope: 'user', enabled: false, mcp: { transport: 'http', url: 'https://mcp.sentry.dev/mcp', authStatus: 'needs login' } },
]

const content: Record<string, string> = {
  s1: '---\nname: release-notes\ndescription: Write release notes from merged PRs in our house style\n---\n\n## When to use this\n\nWhen asked for release notes, a changelog entry or “what shipped”.\n\n## How to do it\n\n1. List PRs merged since the last tag with `gh pr list --state merged`.\n2. Group them as **New**, **Improved** and **Fixed**.\n3. Write one plain sentence per change, for users, not developers.\n',
  a1: '---\nname: code-reviewer\ndescription: Reviews diffs for bugs and missing tests\ntools: Read, Grep, Bash\n---\n\nYou review the current diff. Look for bugs first, then missing tests, then style.\n',
  r1: '# Global instructions\n\n- Prefer pnpm.\n- Never commit without asking.\n',
}

const catalog: CatalogPlugin[] = [
  { id: 'vercel@claude-plugins-official', name: 'vercel', description: 'Deploy and manage Vercel projects, with Next.js and AI SDK skills', marketplace: 'claude-plugins-official', installCount: 48211, installed: true, hasSkills: true, hasMcp: true },
  { id: 'github@claude-plugins-official', name: 'github', description: 'Issues, pull requests and code review on GitHub', marketplace: 'claude-plugins-official', installCount: 91233, installed: true, hasMcp: true },
  { id: 'frontend-design@claude-plugins-official', name: 'frontend-design', description: 'Distinctive, production-grade interfaces that avoid generic AI aesthetics', marketplace: 'claude-plugins-official', installCount: 120554, installed: false, hasSkills: true },
  { id: 'security-guidance@claude-plugins-official', name: 'security-guidance', description: 'Warns about risky patterns while editing', marketplace: 'claude-plugins-official', installCount: 30512, installed: false, hasHooks: true },
  { id: 'supabase@claude-plugins-official', name: 'supabase', description: 'Database, auth and storage with Supabase', marketplace: 'claude-plugins-official', installCount: 22014, installed: false, hasMcp: true, hasSkills: true },
  { id: 'playwright@community', name: 'playwright', description: 'Browser automation and end-to-end tests', marketplace: 'community', installCount: 18770, installed: false, hasMcp: true },
]
const codexCatalog: CatalogPlugin[] = [
  { id: 'linear@openai-curated', name: 'Linear', description: 'Plan and track work in Linear', marketplace: 'openai-curated', installed: true, hasMcp: true },
  { id: 'figma@openai-curated', name: 'Figma', description: 'Read designs and turn them into code', marketplace: 'openai-curated', installed: false, hasMcp: true, hasSkills: true },
  { id: 'notion@openai-curated', name: 'Notion', description: 'Search and update your Notion workspace', marketplace: 'openai-curated', installed: false, hasMcp: true },
]

export function skillsRoute(method: string, path: string, search: URLSearchParams, body: Record<string, unknown>): Response | null {
  const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
  const match = path.match(/^\/api\/devices\/([^/]+)\/(extensions(?:\/item|\/toggle|\/uninstall|\/install|\/catalog)?|skills(?:\/share)?)$/)
  if (!match) return null
  const action = match[2]
  const cwd = search.get('cwd') ?? ''
  if (action === 'extensions' && method === 'GET') {
    const shown = items.filter((item) => !item.projectPath || item.projectPath === cwd)
    return json({ items: shown, agents: [{ agent: 'claude', ok: true, version: '2.1.4' }, { agent: 'codex', ok: true, version: '0.61.0' }, { agent: 'devin', ok: true, version: '3000.11.3' }], fetchedAt: Math.floor(Date.now() / 1000) - 3 })
  }
  if (action === 'extensions/item') {
    const item = items.find((entry) => entry.key === search.get('key'))
    return item ? json({ item, content: content[item.key] ?? (item.path ? `# ${item.name}\n\n${item.description ?? ''}\n` : undefined) }) : json({ error: 'not found' }, 404)
  }
  if (action === 'extensions/toggle') {
    items = items.map((item) => item.key === body.key ? { ...item, enabled: !!body.enabled } : item)
    return json({ item: items.find((item) => item.key === body.key), note: 'Takes effect in new sessions' })
  }
  if (action === 'extensions/uninstall') {
    const item = items.find((entry) => entry.key === body.key)
    items = items.filter((entry) => entry.key !== body.key)
    return json({ ok: true, note: item?.kind === 'skill' ? 'Moved to the trash' : 'Uninstalled' })
  }
  if (action === 'extensions/catalog') return json({ entries: search.get('agent') === 'codex' ? codexCatalog : catalog })
  if (action === 'extensions/install') {
    const list = body.agent === 'codex' ? codexCatalog : catalog
    const entry = list.find((item) => item.id === body.id)
    if (!entry) return json({ error: 'not in the marketplace' }, 404)
    if (entry.id.endsWith('@community') && !body.acceptCommand) return json({ needsApproval: { command: 'npx -y @playwright/mcp-installer', sha: 'demo-sha' } })
    entry.installed = true
    const item: ExtItem = { key: `p-${entry.id}`, agent: String(body.agent), kind: 'plugin', name: entry.name, qualifiedName: entry.id, description: entry.description, scope: body.scope === 'project' ? 'project' : 'user', enabled: true }
    items = [...items, item]
    return json({ item, note: 'Installed. New sessions pick it up.' })
  }
  if (action === 'skills' && method === 'POST') {
    const name = String(body.name ?? '')
    if (!/^[a-z0-9-]{1,64}$/.test(name)) return json({ error: 'name must be lowercase letters, numbers and dashes' }, 400)
    if (items.some((item) => item.kind === 'skill' && item.name === name)) return json({ error: `a skill named ${name} already exists` }, 409)
    const agents = (body.agents as string[]) ?? []
    const project = body.scope === 'project'
    const item: ExtItem = { key: `s-${name}`, agent: agents.includes('codex') ? 'codex' : agents[0] ?? 'codex', kind: 'skill', name, qualifiedName: name, description: String(body.description ?? ''), scope: project ? 'project' : 'user', projectPath: project ? String(body.cwd) : undefined, path: `${project ? body.cwd : home}/.agents/skills/${name}/SKILL.md`, enabled: true, invocation: { user: true, model: true }, sharedWith: agents.filter((agent) => agent !== (agents.includes('codex') ? 'codex' : agents[0])) }
    content[item.key] = `---\nname: ${name}\ndescription: ${item.description}\n---\n\n${body.body ?? ''}`
    items = [item, ...items]
    return json({ item })
  }
  if (action === 'skills/share') {
    items = items.map((item) => item.key === body.key ? { ...item, sharedWith: [...new Set([...(item.sharedWith ?? []), ...((body.agents as string[]) ?? [])])] } : item)
    return json({ item: items.find((item) => item.key === body.key) })
  }
  return null
}
