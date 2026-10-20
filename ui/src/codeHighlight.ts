import type { CodeHighlighterPlugin } from 'streamdown'
import { createHighlighterCore, type HighlighterCore, type LanguageRegistration, type TokensResult } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'

// Syntax highlighting for code in agent replies. Streamdown's stock plugin
// bundles every grammar Shiki has (~10 MB inside the overseer binary); this
// one ships the languages agents actually write, each loaded on first use.
type Grammar = () => Promise<{ default: LanguageRegistration[] }>
const grammars: Record<string, Grammar> = {
  bash: () => import('@shikijs/langs/bash'),
  c: () => import('@shikijs/langs/c'),
  cpp: () => import('@shikijs/langs/cpp'),
  csharp: () => import('@shikijs/langs/csharp'),
  css: () => import('@shikijs/langs/css'),
  diff: () => import('@shikijs/langs/diff'),
  docker: () => import('@shikijs/langs/docker'),
  go: () => import('@shikijs/langs/go'),
  graphql: () => import('@shikijs/langs/graphql'),
  html: () => import('@shikijs/langs/html'),
  ini: () => import('@shikijs/langs/ini'),
  java: () => import('@shikijs/langs/java'),
  javascript: () => import('@shikijs/langs/javascript'),
  json: () => import('@shikijs/langs/json'),
  jsx: () => import('@shikijs/langs/jsx'),
  kotlin: () => import('@shikijs/langs/kotlin'),
  lua: () => import('@shikijs/langs/lua'),
  make: () => import('@shikijs/langs/make'),
  markdown: () => import('@shikijs/langs/markdown'),
  php: () => import('@shikijs/langs/php'),
  powershell: () => import('@shikijs/langs/powershell'),
  python: () => import('@shikijs/langs/python'),
  ruby: () => import('@shikijs/langs/ruby'),
  rust: () => import('@shikijs/langs/rust'),
  scss: () => import('@shikijs/langs/scss'),
  sql: () => import('@shikijs/langs/sql'),
  swift: () => import('@shikijs/langs/swift'),
  toml: () => import('@shikijs/langs/toml'),
  tsx: () => import('@shikijs/langs/tsx'),
  typescript: () => import('@shikijs/langs/typescript'),
  xml: () => import('@shikijs/langs/xml'),
  yaml: () => import('@shikijs/langs/yaml'),
}
const aliases: Record<string, string> = {
  sh: 'bash', shell: 'bash', zsh: 'bash', console: 'bash', shellscript: 'bash',
  'c++': 'cpp', cs: 'csharp', 'c#': 'csharp', dockerfile: 'docker', golang: 'go',
  htm: 'html', js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsonc: 'json', json5: 'json',
  kt: 'kotlin', makefile: 'make', md: 'markdown', ps1: 'powershell', pwsh: 'powershell',
  py: 'python', rb: 'ruby', rs: 'rust', ts: 'typescript', mts: 'typescript', yml: 'yaml', svg: 'xml',
}
const themes: [string, string] = ['github-light', 'github-dark']

const resolve = (language: string) => {
  const name = language.trim().toLowerCase()
  return grammars[name] ? name : aliases[name] ?? ''
}

let highlighter: Promise<HighlighterCore> | null = null
const getHighlighter = () => highlighter ??= createHighlighterCore({
  themes: [import('@shikijs/themes/github-light'), import('@shikijs/themes/github-dark')],
  langs: [],
  engine: createJavaScriptRegexEngine({ forgiving: true }),
})
const loading = new Map<string, Promise<void>>()
const loadLanguage = (core: HighlighterCore, name: string) => {
  if (!loading.has(name)) loading.set(name, grammars[name]().then((mod) => core.loadLanguage(mod.default)))
  return loading.get(name)!
}

// Finished blocks are cached; a block still streaming is re-highlighted as it grows.
const cache = new Map<string, TokensResult>()
const remember = (key: string, value: TokensResult) => {
  cache.set(key, value)
  if (cache.size > 300) cache.delete(cache.keys().next().value!)
}

export const code: CodeHighlighterPlugin = {
  name: 'shiki',
  type: 'code-highlighter',
  supportsLanguage: (language) => !!resolve(language),
  getSupportedLanguages: () => [...Object.keys(grammars), ...Object.keys(aliases)] as ReturnType<CodeHighlighterPlugin['getSupportedLanguages']>,
  getThemes: () => themes,
  highlight({ code: source, language, isIncomplete = false }, callback) {
    const name = resolve(language) || 'text'
    const key = `${name}\n${source}`
    const hit = cache.get(key)
    if (hit) return hit
    getHighlighter()
      .then(async (core) => {
        if (name !== 'text') await loadLanguage(core, name)
        const result = core.codeToTokens(source, { lang: name, themes: { light: themes[0], dark: themes[1] } })
        if (!isIncomplete) remember(key, result)
        callback?.(result)
      })
      .catch(() => { /* leave the block plain */ })
    return null
  },
}
