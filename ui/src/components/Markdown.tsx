import { memo, useEffect, useMemo, useState } from 'react'
import { Streamdown, type PluginConfig } from 'streamdown'
import 'streamdown/styles.css'
import { localTarget, usePreviewLink } from '../previews'

// Agent replies render with Streamdown: GitHub-flavoured Markdown (tables,
// task lists, strikethrough, footnotes), unfinished syntax repaired while the
// reply streams, and links hardened. Raw HTML is never rendered.
//
// The heavy extras load only when a reply needs them: Shiki for fenced code,
// KaTeX for $$ math, Mermaid for diagrams.
type PluginName = 'code' | 'math' | 'mermaid'

const loaded: PluginConfig = {}
const loading = new Map<PluginName, Promise<void>>()
const listeners = new Set<() => void>()

function load(name: PluginName) {
  if (loaded[name] || loading.has(name)) return
  const task = (async () => {
    if (name === 'code') loaded.code = (await import('../codeHighlight')).code
    if (name === 'math') {
      await import('katex/dist/katex.min.css')
      loaded.math = (await import('@streamdown/math')).math
    }
    if (name === 'mermaid') loaded.mermaid = (await import('@streamdown/mermaid')).mermaid
  })()
    .catch(() => { /* render without it; plain code blocks still work */ })
    .finally(() => listeners.forEach((listener) => listener()))
  loading.set(name, task)
}

function needs(text: string): PluginName[] {
  const out: PluginName[] = []
  if (/```|~~~/.test(text)) out.push('code')
  if (/\$\$|\\\(|\\\[/.test(text)) out.push('math')
  if (/```\s*mermaid/i.test(text)) out.push('mermaid')
  return out
}

function usePlugins(text: string): PluginConfig {
  const [, bump] = useState(0)
  const wanted = needs(text)
  useEffect(() => {
    const listener = () => bump((value) => value + 1)
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  }, [])
  useEffect(() => { wanted.forEach(load) }, [wanted.join()]) // eslint-disable-line react-hooks/exhaustive-deps
  const ready = wanted.filter((name) => loaded[name]).join()
  return useMemo(() => {
    const config: PluginConfig = {}
    for (const name of ready.split(',').filter(Boolean) as PluginName[]) (config as Record<string, unknown>)[name] = loaded[name]
    return config
  }, [ready])
}

// Stable props, so streaming updates only re-render the blocks that changed.
const animation = { animation: 'fadeIn', duration: 160, sep: 'word' } as const
const themes: ['github-light', 'github-dark'] = ['github-light', 'github-dark']
const linkSafety = { enabled: false }
// Inline diagrams must not swallow the wheel; fullscreen still zooms.
const controls = { mermaid: { panZoom: false } }
const lightDiagrams = { config: { theme: 'neutral' as const } }
const darkDiagrams = { config: { theme: 'dark' as const } }
const isDark = () => {
  const forced = document.documentElement.dataset.theme
  return forced ? forced === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches
}

// Links to a dev server on the agent's machine open in the Preview panel
// (localhost there is not localhost here).
function LocalLink({ href, children, node: _node, ...rest }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { node?: unknown }) {
  const open = usePreviewLink()
  const target = localTarget(href)
  if (open && target) {
    return (
      <a {...rest} href={href} data-streamdown="link" title={`Open port ${target.port} in the preview`} onClick={(event) => { event.preventDefault(); open(target.port, target.path) }}>
        {children}
      </a>
    )
  }
  return <a {...rest} href={href} data-streamdown="link" target="_blank" rel="noreferrer">{children}</a>
}
const components = { a: LocalLink }

function Markdown({ text, streaming = false }: { text: string; streaming?: boolean }) {
  const plugins = usePlugins(text)
  return (
    <Streamdown
      className="md"
      mode={streaming ? 'streaming' : 'static'}
      isAnimating={streaming}
      animated={streaming ? animation : false}
      caret={streaming ? 'block' : undefined}
      plugins={plugins}
      shikiTheme={themes}
      lineNumbers={false}
      linkSafety={linkSafety}
      controls={controls}
      mermaid={isDark() ? darkDiagrams : lightDiagrams}
      components={components}
      codeBlockMaxHeight={480}
      tableMaxHeight={420}
    >
      {text}
    </Streamdown>
  )
}

export default memo(Markdown)
