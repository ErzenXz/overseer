import { Fragment, type ReactNode } from "react";
import { Shot } from "../components/Shot";

// A small Markdown renderer for our own docs. The files are ours, so it covers
// exactly what they use: front matter, ## and ### headings (with anchors),
// paragraphs, - and 1. lists, fenced code, tables, > quotes and > [!TIP] /
// > [!WARNING] callouts, ![alt](shot:name) screenshots, and inline **bold**,
// *italic*, `code`, [links](url) and <kbd>keys</kbd>.

export interface Heading { id: string; text: string; level: 2 | 3 }

type Block =
  | { type: "h"; level: 2 | 3; text: string; id: string }
  | { type: "p"; text: string }
  | { type: "ul" | "ol"; items: string[] }
  | { type: "code"; lang: string; code: string }
  | { type: "table"; head: string[]; rows: string[][] }
  | { type: "quote"; kind: "" | "tip" | "warning"; text: string[] }
  | { type: "shot"; name: string; alt: string };

export const slugify = (text: string) =>
  text.toLowerCase().replace(/<[^>]+>|[`*]/g, "").replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export function parseDoc(source: string) {
  let body = source;
  const meta: Record<string, string> = {};
  const front = source.match(/^---\n([\s\S]*?)\n---\n/);
  if (front) {
    for (const line of front[1].split("\n")) {
      const at = line.indexOf(":");
      if (at > 0) meta[line.slice(0, at).trim()] = line.slice(at + 1).trim();
    }
    body = source.slice(front[0].length);
  }

  const blocks: Block[] = [];
  const lines = body.split("\n");
  const cells = (row: string) => row.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;

    const fence = line.match(/^```(\w*)/);
    if (fence) {
      const code: string[] = [];
      while (++i < lines.length && !lines[i].startsWith("```")) code.push(lines[i]);
      blocks.push({ type: "code", lang: fence[1] || "text", code: code.join("\n") });
      continue;
    }
    const heading = line.match(/^(##|###) (.+)$/);
    if (heading) {
      const text = heading[2].trim();
      blocks.push({ type: "h", level: heading[1].length as 2 | 3, text, id: slugify(text) });
      continue;
    }
    const shot = line.match(/^!\[([^\]]*)\]\(shot:([\w-]+)\)$/);
    if (shot) {
      blocks.push({ type: "shot", alt: shot[1], name: shot[2] });
      continue;
    }
    if (line.startsWith("|")) {
      const rows: string[][] = [];
      for (; i < lines.length && lines[i].startsWith("|"); i++) if (!/^\|[\s|:-]+\|$/.test(lines[i].trim())) rows.push(cells(lines[i]));
      i--;
      blocks.push({ type: "table", head: rows[0], rows: rows.slice(1) });
      continue;
    }
    if (line.startsWith(">")) {
      const text: string[] = [];
      for (; i < lines.length && lines[i].startsWith(">"); i++) text.push(lines[i].replace(/^>\s?/, ""));
      i--;
      const marker = text[0]?.match(/^\[!(TIP|WARNING)\]$/);
      blocks.push({ type: "quote", kind: marker ? (marker[1].toLowerCase() as "tip" | "warning") : "", text: (marker ? text.slice(1) : text).join(" ").split(/\s{2,}|\n/) });
      continue;
    }
    const bullet = /^(-|\d+\.) /;
    if (bullet.test(line)) {
      const ordered = /^\d/.test(line);
      const items: string[] = [];
      for (; i < lines.length; i++) {
        if (bullet.test(lines[i])) items.push(lines[i].replace(bullet, ""));
        else if (/^\s{2,}\S/.test(lines[i]) && items.length) items[items.length - 1] += ` ${lines[i].trim()}`;
        else break;
      }
      i--;
      blocks.push({ type: ordered ? "ol" : "ul", items });
      continue;
    }
    const para: string[] = [];
    for (; i < lines.length && lines[i].trim() && !/^(```|##|>|\||!\[|- |\d+\. )/.test(lines[i]); i++) para.push(lines[i].trim());
    i--;
    blocks.push({ type: "p", text: para.join(" ") });
  }

  const headings: Heading[] = blocks.flatMap((block) => (block.type === "h" ? [{ id: block.id, text: block.text, level: block.level }] : []));
  return { meta, blocks, headings };
}

// Inline marks. Links to /docs/ pages stay in the docs; others open a new tab.
export function inline(text: string): ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|<kbd>[^<]+<\/kbd>|\[[^\]]+\]\([^)]+\)|\*[^*\s][^*]*\*)/g);
  return parts.map((part, i) => {
    if (!part) return null;
    if (part.startsWith("**")) return <strong key={i}>{inline(part.slice(2, -2))}</strong>;
    if (part.startsWith("`")) return <code key={i}>{part.slice(1, -1)}</code>;
    if (part.startsWith("<kbd>")) return <kbd key={i}>{part.slice(5, -6)}</kbd>;
    const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link) {
      const external = /^https?:/.test(link[2]);
      return <a key={i} href={link[2]} {...(external ? { target: "_blank", rel: "noreferrer" } : {})}>{inline(link[1])}</a>;
    }
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) return <em key={i}>{part.slice(1, -1)}</em>;
    return <Fragment key={i}>{part}</Fragment>;
  });
}

// A light shell highlighter in the GitHub style: commands, flags, strings,
// <placeholders> and # comments.
const COMMANDS = /^(overseer|curl|claude|codex|git|irm|sudo|cd|make|go|npm|sh|env|powershell|x11vnc|wayvnc|df|tailscale)$/;
function highlight(code: string, lang: string): ReactNode {
  if (lang === "text") return code;
  return code.split("\n").map((line, n) => {
    const out: ReactNode[] = [];
    const comment = lang === "ini" ? -1 : line.search(/(^|\s)#\s/);
    const main = comment >= 0 ? line.slice(0, comment) : line;
    let command = true;
    main.split(/(\s+|"[^"]*"|'[^']*'|\|)/).forEach((token, i) => {
      if (!token) return;
      let cls = "";
      if (/^\s+$/.test(token)) { out.push(token); return; }
      if (token === "|" || token === "\\") { command = true; cls = "tok-op"; }
      else if (/^["']/.test(token)) cls = "tok-str";
      else if (/^<[^>]+>$/.test(token) || /^[A-Z][A-Z_]{3,}$/.test(token)) cls = "tok-ph";
      else if (lang === "ini" && /^\[.+\]$/.test(token)) cls = "tok-cmd";
      else if (command && (COMMANDS.test(token.split("/").pop() ?? "") || lang === "powershell")) { cls = "tok-cmd"; command = false; }
      else if (/^--?[\w-]+/.test(token)) cls = "tok-flag";
      else command = false;
      out.push(cls ? <span key={i} className={cls}>{token}</span> : token);
    });
    if (comment >= 0) out.push(<span key="c" className="tok-com">{line.slice(comment)}</span>);
    return <Fragment key={n}>{out}{"\n"}</Fragment>;
  });
}

const LANG_LABEL: Record<string, string> = { sh: "SH", powershell: "POWERSHELL", ini: "INI", text: "" };

export function renderBlocks(blocks: Block[]): ReactNode {
  return blocks.map((block, i) => {
    switch (block.type) {
      case "h": {
        const Tag = block.level === 2 ? "h2" : "h3";
        return (
          <Fragment key={i}>
            {block.level === 2 && <hr />}
            <Tag id={block.id}>
              <a className="header-anchor" href={`#${block.id}`} aria-label={`Link to ${block.text}`}>#</a>
              {inline(block.text)}
            </Tag>
          </Fragment>
        );
      }
      case "p":
        return <p key={i}>{inline(block.text)}</p>;
      case "ul":
        return <ul key={i}>{block.items.map((item, n) => <li key={n}>{inline(item)}</li>)}</ul>;
      case "ol":
        return <ol key={i}>{block.items.map((item, n) => <li key={n}>{inline(item)}</li>)}</ol>;
      case "code":
        return (
          <div key={i} className="doc-code">
            {LANG_LABEL[block.lang] !== "" && <span className="doc-code__lang">{LANG_LABEL[block.lang] ?? block.lang.toUpperCase()}</span>}
            <CopyButton code={block.code} />
            <pre><code>{highlight(block.code, block.lang)}</code></pre>
          </div>
        );
      case "table":
        return (
          <div key={i} className="doc-table">
            <table>
              <thead><tr>{block.head.map((cell, n) => <th key={n}>{inline(cell)}</th>)}</tr></thead>
              <tbody>{block.rows.map((row, r) => <tr key={r}>{row.map((cell, n) => <td key={n}>{inline(cell)}</td>)}</tr>)}</tbody>
            </table>
          </div>
        );
      case "quote":
        return block.kind ? (
          <div key={i} className={`callout callout--${block.kind}`}>
            <p className="callout__title">{block.kind === "tip" ? "Tip" : "Warning"}</p>
            {block.text.map((text, n) => <p key={n}>{inline(text)}</p>)}
          </div>
        ) : (
          <blockquote key={i}>{block.text.map((text, n) => <p key={n}>{inline(text)}</p>)}</blockquote>
        );
      case "shot":
        return (
          <figure key={i} className="doc-shot">
            <Shot theme="light" name={block.name} alt={block.alt} />
            <figcaption>{block.alt}</figcaption>
          </figure>
        );
    }
  });
}

function CopyButton({ code }: { code: string }) {
  return (
    <button
      type="button"
      className="doc-code__copy"
      aria-label="Copy code"
      onClick={(e) => {
        const button = e.currentTarget;
        navigator.clipboard?.writeText(code.replace(/\s+#\s.*$/gm, "")).then(() => {
          button.dataset.copied = "true";
          setTimeout(() => delete button.dataset.copied, 1400);
        }).catch(() => {});
      }}
    />
  );
}
