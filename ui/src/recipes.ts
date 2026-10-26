import type { IconName } from './components/Icon'
import type { Automation } from './types'

// Automation recipes: a portable description of an automation that travels
// as a link. A recipe never carries a machine, a folder or a secret. Recipes
// from links are untrusted: the import page checks them strictly (the hub
// does the same on its side), shows the whole prompt, and never runs one.

export type RecipeMode = 'plan' | 'ask' | 'edits' | 'auto'

export interface Recipe {
  v: 1
  name: string
  description?: string
  schedule: string
  prompt: string
  agent?: 'claude' | 'codex' | 'gemini'
  model?: string
  effort?: string
  mode?: RecipeMode
  requires?: string[]
  tags?: string[]
}

export interface RecipeWarning { level: 'warn' | 'info'; text: string }

export const RECIPE_MAX_ENCODED = 16 * 1024
const MAX_PROMPT = 8000
const MAX_DESC = 500

// Same canonical key order as the hub, so links look alike everywhere.
export function canonicalRecipe(r: Recipe): Recipe {
  const out: Record<string, unknown> = { v: 1, name: r.name }
  if (r.description) out.description = r.description
  out.schedule = r.schedule
  out.prompt = r.prompt
  if (r.agent) out.agent = r.agent
  if (r.model) out.model = r.model
  if (r.effort) out.effort = r.effort
  if (r.mode) out.mode = r.mode
  if (r.requires?.length) out.requires = r.requires
  if (r.tags?.length) out.tags = r.tags
  return out as unknown as Recipe
}

export function encodeRecipe(r: Recipe): string {
  const json = JSON.stringify(canonicalRecipe(r))
  const bytes = new TextEncoder().encode(json)
  let binary = ''
  bytes.forEach((b) => { binary += String.fromCharCode(b) })
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function decodeRecipeJSON(encoded: string): unknown {
  const text = encoded.trim()
  if (!text) throw new Error('The link has no recipe in it.')
  if (text.length > RECIPE_MAX_ENCODED) throw new Error('The recipe is too large.')
  if (!/^[A-Za-z0-9_-]+=*$/.test(text)) throw new Error('The recipe in this link is damaged (not valid base64).')
  let binary: string
  try { binary = atob(text.replace(/-/g, '+').replace(/_/g, '/')) } catch { throw new Error('The recipe in this link is damaged (not valid base64).') }
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) } catch { throw new Error('The recipe is not valid JSON.') }
}

export const recipeLink = (r: Recipe, origin = location.origin) => `${origin}/automations/import#r=${encodeRecipe(r)}`
export const universalRecipeLink = (r: Recipe) => `https://overseer.sh/r#${encodeRecipe(r)}`

// The part of a pasted or opened link that holds the recipe. Accepts the
// whole link, "#r=…" or the bare text.
export function recipeDataFromLink(input: string): string {
  const text = input.trim()
  const hash = text.indexOf('#')
  const tail = hash >= 0 ? text.slice(hash + 1) : text
  const match = tail.match(/(?:^|&)r=([^&]+)/)
  return match ? match[1] : hash >= 0 ? '' : tail
}

// --- checking ---

const ALLOWED = new Set(['v', 'name', 'description', 'schedule', 'prompt', 'agent', 'model', 'effort', 'mode', 'requires', 'tags'])
const AGENTS = ['claude', 'codex', 'gemini']
const MODES = ['plan', 'ask', 'edits', 'auto']
const SECRET = /(ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|gh[ousr]_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,}|tskey-[A-Za-z0-9_-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.)/i

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/
// eslint-disable-next-line no-control-regex
const CONTROL_LINE = /[\u0000-\u001f\u007f]/

const MACROS = ['@yearly', '@annually', '@monthly', '@weekly', '@daily', '@midnight', '@hourly']
const NAMES: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12, sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 }

function cronField(field: string, lo: number, hi: number, label: string, names: boolean): string | null {
  const value = (s: string) => {
    if (names && NAMES[s.toLowerCase()] !== undefined) return NAMES[s.toLowerCase()]
    if (!/^\d+$/.test(s)) return NaN
    return Number(s)
  }
  for (const part of field.split(',')) {
    if (!part) return `${label}: empty list item`
    let range = part
    const slash = part.indexOf('/')
    if (slash >= 0) {
      const step = part.slice(slash + 1)
      if (!/^\d+$/.test(step) || Number(step) < 1) return `${label}: bad step in “${part}”`
      range = part.slice(0, slash)
    }
    const ends = range === '*' ? [] : range.split('-')
    if (ends.length > 2) return `${label}: bad range “${range}”`
    for (const end of ends) {
      const n = value(end)
      if (Number.isNaN(n)) return `${label}: bad value “${end}”`
      if (n < lo || n > hi) return `${label}: ${n} is out of range ${lo}-${hi}`
    }
    if (ends.length === 2 && value(ends[0]) > value(ends[1])) return `${label}: range “${range}” runs backwards`
  }
  return null
}

// cronProblem mirrors the hub's parser: null when the schedule is valid.
export function cronProblem(spec: string): string | null {
  const text = spec.trim()
  if (MACROS.includes(text.toLowerCase())) return null
  const f = text.split(/\s+/)
  if (f.length !== 5) return `Schedule needs 5 fields (minute hour day month weekday), got ${f.length}.`
  return cronField(f[0], 0, 59, 'minute', false) ?? cronField(f[1], 0, 23, 'hour', false) ?? cronField(f[2], 1, 31, 'day of month', false)
    ?? cronField(f[3], 1, 12, 'month', true) ?? cronField(f[4], 0, 7, 'weekday', true)
}

// checkRecipe validates untrusted JSON strictly and returns a clean recipe.
export function checkRecipe(raw: unknown): { recipe?: Recipe; error?: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'The recipe is not valid: expected an object.' }
  const input = raw as Record<string, unknown>
  for (const key of Object.keys(input)) {
    if (!ALLOWED.has(key)) return { error: `The recipe is not valid: it has a field “${key.slice(0, 30)}” this version doesn’t know. Recipes can’t carry machines, folders or access settings.` }
  }
  if (input.v !== 1) return { error: `This recipe is version ${String(input.v).slice(0, 10)}; this hub understands version 1.` }
  const text = (key: string, max: number, lines = false): string | { error: string } => {
    const value = input[key]
    if (value === undefined) return ''
    if (typeof value !== 'string') return { error: `${key} must be text.` }
    if ((lines ? CONTROL : CONTROL_LINE).test(value)) return { error: `${key} has control characters.` }
    if ([...value].length > max) return { error: `${key} is longer than ${max} characters.` }
    return value.trim()
  }
  const fields = {
    name: text('name', 120), description: text('description', MAX_DESC, true), schedule: text('schedule', 100),
    prompt: text('prompt', MAX_PROMPT, true), agent: text('agent', 20), model: text('model', 64), effort: text('effort', 12), mode: text('mode', 10),
  }
  for (const value of Object.values(fields)) if (typeof value === 'object') return { error: value.error }
  const f = fields as Record<keyof typeof fields, string>
  if (!f.name) return { error: 'Name must be 1-120 characters.' }
  if (!f.prompt) return { error: 'The recipe has no prompt.' }
  if (f.agent && !AGENTS.includes(f.agent)) return { error: 'Agent must be claude, codex or gemini.' }
  if (f.mode && !MODES.includes(f.mode)) return { error: 'Mode must be plan, ask, edits or auto.' }
  if (f.model && !/^[A-Za-z0-9][A-Za-z0-9._:/[\]-]{0,63}$/.test(f.model)) return { error: 'Model hint is invalid.' }
  if (f.effort && !/^[a-z]{2,12}$/.test(f.effort)) return { error: 'Effort hint is invalid.' }
  const list = (key: 'requires' | 'tags', max: number, re: RegExp): string[] | { error: string } => {
    const value = input[key]
    if (value === undefined) return []
    if (!Array.isArray(value) || value.length > max) return { error: `${key} must be a short list.` }
    for (const item of value) if (typeof item !== 'string' || !re.test(item)) return { error: `${key} has an invalid entry.` }
    return value as string[]
  }
  const requires = list('requires', 8, /^[a-z0-9][a-z0-9._+-]{0,31}$/)
  if (!Array.isArray(requires)) return { error: requires.error }
  const tags = list('tags', 6, /^[A-Za-z0-9][A-Za-z0-9 ._+-]{0,23}$/)
  if (!Array.isArray(tags)) return { error: tags.error }
  if (SECRET.test(f.prompt) || SECRET.test(f.description) || SECRET.test(f.name)) return { error: 'The recipe contains what looks like a secret (a key or token). Recipes must not carry secrets.' }
  const schedule = f.schedule.replace(/\s+/g, ' ')
  const problem = cronProblem(schedule)
  if (problem) return { error: `Schedule: ${problem}` }
  const recipe: Recipe = canonicalRecipe({
    v: 1, name: f.name, description: f.description || undefined, schedule, prompt: f.prompt,
    agent: (f.agent || undefined) as Recipe['agent'], model: f.model || undefined, effort: f.effort || undefined,
    mode: (f.mode || undefined) as RecipeMode | undefined, requires, tags,
  })
  return { recipe }
}

const RULES: Array<[RegExp, string]> = [
  [/\b(git push|push (it|them|the|a|your|changes|to|a fix|fixes)|force[- ]push|open (a |the )?(pull request|pr)\b|create (a |the )?(pull request|pr)\b|gh pr create|gh pr merge|merge (the |a )?(pull request|pr|branch)|publish|deploy|release it|tag a release)/i, 'Can push code, open pull requests or publish. Changes leave this machine.'],
  [/\b(edit|fix|rewrite|refactor|rename|bump|upgrade|apply|git commit|commit (it|them|the|your|these|those|changes)|modify|replace|update (the|all|every|dependencies|deps|versions?|docs?|readme|changelog|config)|write (it |them |.{0,30})?(to|into) |save (it |the |a )?(to|as)|create (a |the )?(file|branch))/i, 'Changes files in the folder you choose.'],
  [/(\brm -|\bdelete\b|\bdrop (table|database)\b|\bwipe\b|\bclear\b|\bclean (up|out)\b|\bremove (all|old|the files|files)\b|\bprune\b)/i, 'Deletes files or data.'],
  [/(\bcurl\b|\bwget\b|\bsudo\b|\bssh\b|\bdocker\b|\bnpm (i|install|exec)\b|\bpip install\b|\bbrew\b|\bapt(-get)?\b)/i, 'Runs shell commands that may install software or use the network.'],
]

// recipeWarnings is a heuristic aid for the person deciding; the full prompt
// is always shown beside it.
const READ_ONLY_INTENT = /(report only|read-only|changes? nothing|do not (edit|change|modify|delete|commit|push|comment|write)|don't (edit|change|modify|delete|commit|push)|without (editing|changing|committing)|never (edit|change|delete))/i

export function recipeWarnings(r: Recipe): RecipeWarning[] {
  const out: RecipeWarning[] = []
  // A prompt that says it changes nothing, in a mode that can't change
  // anything, isn't warned about editing, deleting or pushing.
  const readOnly = READ_ONLY_INTENT.test(r.prompt) && (r.mode === 'plan' || r.mode === 'ask')
  RULES.forEach(([re, text], index) => { if (!(readOnly && index < 3) && re.test(r.prompt)) out.push({ level: 'warn', text }) })
  if (r.mode === 'auto') out.push({ level: 'warn', text: 'Asks to run in Auto mode: nobody approves each step while it runs.' })
  else if (r.mode === 'edits') out.push({ level: 'warn', text: 'Asks to edit files without asking first.' })
  else if (r.mode === 'plan' || r.mode === 'ask') out.push({ level: 'info', text: 'Asks for a read-only or ask-first mode, so it changes nothing without approval.' })
  if (/https?:\/\//.test(r.prompt)) out.push({ level: 'warn', text: 'The prompt mentions web addresses. Check each one.' })
  if (/(^|[\s"'(])(\/Users\/[\w.-]+|\/home\/[\w.-]+|[A-Za-z]:\\Users\\)/.test(r.prompt)) out.push({ level: 'info', text: 'The prompt mentions a local path that may not exist on your machine.' })
  return out
}

export function recipeFromAutomation(a: Pick<Automation, 'name' | 'prompt' | 'schedule' | 'agent' | 'model' | 'effort' | 'access'>): Recipe {
  const mode: RecipeMode | undefined = a.access === 'ask' ? 'ask' : a.access === 'edits' ? 'edits' : a.access === 'auto' ? 'auto' : undefined
  return canonicalRecipe({
    v: 1, name: a.name, schedule: a.schedule, prompt: a.prompt,
    agent: (['claude', 'codex', 'gemini'].includes(a.agent) ? a.agent : undefined) as Recipe['agent'],
    model: a.model && /^[A-Za-z0-9][A-Za-z0-9._:/[\]-]{0,63}$/.test(a.model) ? a.model : undefined,
    effort: a.effort && /^[a-z]{2,12}$/.test(a.effort) ? a.effort : undefined,
    mode,
  })
}

// --- the built-in gallery ---

export type TemplateCategory = 'Maintenance' | 'CI/CD & Release' | 'Security' | 'Fleet'

export interface RecipeTemplate {
  name: string
  description: string
  prompt: string
  schedule: string
  category: TemplateCategory
  icon: IconName
  tags: string[]
}

// What the original templates need and how they should run. Looked up by name.
export const templateHints: Record<string, { requires?: string[]; mode: RecipeMode }> = {
  'Fix CI failures': { requires: ['gh', 'git'], mode: 'auto' },
  'Weekly dependency update': { requires: ['gh', 'git'], mode: 'auto' },
  'Morning repo digest': { requires: ['gh', 'git'], mode: 'plan' },
  'Security audit': { requires: ['gh', 'git'], mode: 'auto' },
  'Secret scan': { requires: ['git'], mode: 'plan' },
  'Clean disk space': { mode: 'auto' },
  'Update coding agents': { mode: 'auto' },
  'Keep the README honest': { requires: ['gh', 'git'], mode: 'auto' },
  'Release notes draft': { requires: ['gh', 'git'], mode: 'edits' },
}

export const extraTemplates: RecipeTemplate[] = [
  { name: 'Triage new issues', category: 'Maintenance', icon: 'github', tags: ['GitHub'], schedule: '0 9 * * 1-5',
    description: 'Each weekday, Overseer reads new issues and drafts labels, priority and where in the code to look. It changes nothing on GitHub.',
    prompt: 'List the GitHub issues opened in the last 24 hours (gh issue list --state open --json number,title,body,labels,createdAt). For each one, read it and the code it points at, then suggest: labels, a priority (P0-P3), the area of the code involved, and whether it needs more information from the reporter. Flag likely duplicates. Do not comment on, label or close anything: write the suggestions as a short summary for me.' },
  { name: 'Weekly changelog draft', category: 'CI/CD & Release', icon: 'git-commit', tags: ['Git'], schedule: '0 16 * * 5',
    description: 'Every Friday, Overseer drafts a changelog entry from the commits and merged pull requests since the last release.',
    prompt: 'Draft a changelog entry from the commits and merged pull requests since the latest release tag. Group the changes under Added, Changed and Fixed, one plain sentence each, and leave out internal chores. Write it under an "Unreleased" heading at the top of CHANGELOG.md, matching the style already in that file. Do not commit.' },
  { name: 'Dead code sweep', category: 'Maintenance', icon: 'code', tags: ['Git'], schedule: '0 6 * * 6',
    description: 'Weekly, Overseer looks for unused files, exports and dependencies and reports them with how sure it is. It deletes nothing.',
    prompt: 'Find dead code in this repository: unused files, exports, functions and dependencies. Use the tools the project already has (for example knip, ts-prune, depcheck, go vet, deadcode, cargo udeps); if there are none, search by hand. For each finding give the path, why you think it is unused, and a confidence of high, medium or low. Report only. Do not edit or delete anything.' },
  { name: 'Bump Node/Go version', category: 'Maintenance', icon: 'arrow-up', tags: ['Git', 'GitHub'], schedule: '0 9 1 * *',
    description: 'Monthly, Overseer checks for a newer Node or Go release and, if there is one, bumps it everywhere and opens a pull request.',
    prompt: 'Check whether a newer supported release exists for the runtime this project pins (Node LTS via .nvmrc, .node-version, package.json engines and CI; Go via go.mod and CI; also Dockerfiles). If one does, update every place that pins it, run the tests, and open a pull request that lists each file changed and any breaking changes in the release notes. If nothing is newer, say so and stop.' },
  { name: 'Flaky test hunter', category: 'CI/CD & Release', icon: 'activity', tags: ['Git'], schedule: '0 2 * * *',
    description: 'Nightly, Overseer runs the tests several times and reports the ones that pass and fail at random, with a likely cause.',
    prompt: 'Run this project\'s test suite five times in a row. Find tests that pass in some runs and fail in others. For each flaky test, give its name, how often it failed, the error, and your best guess at the cause (timing, shared state, ordering, network, randomness). Do not change any code; write a short report.' },
  { name: 'Docs drift check', category: 'Maintenance', icon: 'book', tags: ['Git'], schedule: '0 10 * * 3',
    description: 'Weekly, Overseer compares the docs with the code and lists where they disagree: flags, config keys, routes, examples.',
    prompt: 'Compare the documentation (README, docs/, comments in examples) with the current code. Look for command-line flags, config keys, environment variables, API routes and code examples that no longer match. List each mismatch with the doc file and line, what the code actually does, and the fix you would make. Report only; do not edit files.' },
  { name: 'License/header check', category: 'Security', icon: 'file', tags: ['Git'], schedule: '0 5 * * 1',
    description: 'Weekly, Overseer checks source files for the required license header and dependencies for incompatible licenses.',
    prompt: 'Check that source files carry the license header this project requires (see LICENSE and CONTRIBUTING; if there is no stated requirement, say so). List files that lack it. Then check the licenses of direct dependencies with the tools for this ecosystem (license-checker, go-licenses, cargo deny, pip-licenses) and flag any that conflict with this project\'s license. Report only; do not edit files.' },
  { name: 'Upgrade lint rules', category: 'Maintenance', icon: 'wrench', tags: ['Git', 'GitHub'], schedule: '0 9 * * 2',
    description: 'Weekly, Overseer turns on newly recommended lint rules that are cheap to adopt and opens a pull request.',
    prompt: 'Look at this project\'s linter configuration and the rules its linter now recommends. Enable recommended rules that are not on yet, but only those whose violations you can fix automatically or in a few lines. Fix the violations, run the linter and the tests, and open a pull request that lists each rule turned on. List the rules you skipped and why.' },
]

const requiresOf = (name: string, text: string): string[] => {
  const hint = templateHints[name]?.requires
  if (hint) return hint
  const found: string[] = []
  if (/\bgh\b|pull request|github/i.test(text)) found.push('gh')
  if (/\bgit\b|commit|repository|repo\b/i.test(text)) found.push('git')
  return [...new Set(found)]
}

export const extraHints: Record<string, { requires?: string[]; mode: RecipeMode }> = {
  'Triage new issues': { requires: ['gh'], mode: 'plan' },
  'Weekly changelog draft': { requires: ['git'], mode: 'edits' },
  'Dead code sweep': { requires: ['git'], mode: 'plan' },
  'Bump Node/Go version': { requires: ['gh', 'git'], mode: 'auto' },
  'Flaky test hunter': { requires: ['git'], mode: 'auto' },
  'Docs drift check': { requires: ['git'], mode: 'plan' },
  'License/header check': { requires: ['git'], mode: 'plan' },
  'Upgrade lint rules': { requires: ['gh', 'git'], mode: 'auto' },
}

export function templateRecipe(t: RecipeTemplate): Recipe {
  const hint = templateHints[t.name] ?? extraHints[t.name]
  const requires = hint?.requires ?? requiresOf(t.name, `${t.prompt} ${t.tags.join(' ')}`)
  return canonicalRecipe({
    v: 1, name: t.name, description: t.description, schedule: t.schedule, prompt: t.prompt,
    mode: hint?.mode, requires, tags: t.tags.filter((tag) => /^[A-Za-z0-9][A-Za-z0-9 ._+-]{0,23}$/.test(tag)).slice(0, 6),
  })
}
