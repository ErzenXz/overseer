import { Fragment, ReactNode } from 'react'

// A small, safe Markdown renderer for agent replies: paragraphs, headings,
// lists, block quotes, fenced code, inline code, bold, italic and links.
// It never injects HTML.
export default function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = []
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  let i = 0
  let key = 0
  while (i < lines.length) {
    const line = lines[i]
    const fence = line.match(/^\s*```(\S*)/)
    if (fence) {
      const body: string[] = []
      i++
      while (i < lines.length && !/^\s*```/.test(lines[i])) body.push(lines[i++])
      i++
      blocks.push(<pre key={key++}><code>{body.join('\n')}</code></pre>)
      continue
    }
    if (!line.trim()) { i++; continue }
    const heading = line.match(/^(#{1,3})\s+(.*)/)
    if (heading) {
      const Tag = (`h${heading[1].length}`) as 'h1' | 'h2' | 'h3'
      blocks.push(<Tag key={key++}>{inline(heading[2])}</Tag>)
      i++
      continue
    }
    if (/^\s*>/.test(line)) {
      const body: string[] = []
      while (i < lines.length && /^\s*>/.test(lines[i])) body.push(lines[i++].replace(/^\s*>\s?/, ''))
      blocks.push(<blockquote key={key++}>{inline(body.join(' '))}</blockquote>)
      continue
    }
    const bullet = /^\s*[-*+]\s+/
    const numbered = /^\s*\d+[.)]\s+/
    if (bullet.test(line) || numbered.test(line)) {
      const ordered = numbered.test(line)
      const pattern = ordered ? numbered : bullet
      const items: string[] = []
      while (i < lines.length && (pattern.test(lines[i]) || (/^\s{2,}\S/.test(lines[i]) && items.length))) {
        if (pattern.test(lines[i])) items.push(lines[i].replace(pattern, ''))
        else items[items.length - 1] += ` ${lines[i].trim()}`
        i++
      }
      const List = ordered ? 'ol' : 'ul'
      blocks.push(<List key={key++}>{items.map((item, index) => <li key={index}>{inline(item)}</li>)}</List>)
      continue
    }
    const para: string[] = []
    while (i < lines.length && lines[i].trim() && !/^\s*(```|#{1,3}\s|>|[-*+]\s|\d+[.)]\s)/.test(lines[i])) para.push(lines[i++])
    blocks.push(<p key={key++}>{inline(para.join('\n'))}</p>)
  }
  return <>{blocks}</>
}

const tokenPattern = /(`[^`]+`)|(\*\*[^*]+\*\*)|(__[^_]+__)|(\*[^*\s][^*]*\*)|(\[[^\]]+\]\([^)\s]+\))|(https?:\/\/[^\s)]+)/g

function inline(text: string): ReactNode {
  const out: ReactNode[] = []
  let last = 0
  let index = 0
  for (const match of text.matchAll(tokenPattern)) {
    const start = match.index ?? 0
    if (start > last) out.push(withBreaks(text.slice(last, start), index++))
    const token = match[0]
    if (token.startsWith('`')) out.push(<code key={index++}>{token.slice(1, -1)}</code>)
    else if (token.startsWith('**') || token.startsWith('__')) out.push(<strong key={index++}>{inline(token.slice(2, -2))}</strong>)
    else if (token.startsWith('*')) out.push(<em key={index++}>{token.slice(1, -1)}</em>)
    else if (token.startsWith('[')) {
      const [, label, href] = token.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/) ?? []
      out.push(safeHref(href) ? <a key={index++} href={href} target="_blank" rel="noreferrer">{label}</a> : <Fragment key={index++}>{label}</Fragment>)
    } else out.push(<a key={index++} href={token} target="_blank" rel="noreferrer">{token}</a>)
    last = start + token.length
  }
  if (last < text.length) out.push(withBreaks(text.slice(last), index++))
  return out
}

function withBreaks(text: string, key: number) {
  const parts = text.split('\n')
  return <Fragment key={key}>{parts.map((part, index) => <Fragment key={index}>{index > 0 && <br />}{part}</Fragment>)}</Fragment>
}

function safeHref(href = '') {
  return /^(https?:|mailto:|\/|#)/.test(href)
}
