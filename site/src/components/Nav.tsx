import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, GithubLogo, List, MagnifyingGlass, X } from "@phosphor-icons/react";
import { DOCS, INSTALL, REPO } from "../lib/site";
import { LogoMark } from "./Logo";

export type Page = "home" | "features" | "download" | "security" | "changelog";

const LINKS: { id: Page | "docs"; label: string; href: string; external?: boolean }[] = [
  { id: "docs", label: "Docs", href: DOCS, external: true },
  { id: "features", label: "Features", href: "/features/" },
  { id: "security", label: "Security", href: "/security/" },
  { id: "changelog", label: "Changelog", href: "/changelog/" },
  { id: "download", label: "Download", href: "/download/" },
];

// Everything the ⌘K box can jump to: pages, sections and install commands.
const TARGETS = [
  { label: "Download Overseer", hint: "Page", href: "/download/" },
  { label: "Features: every screen", hint: "Page", href: "/features/" },
  { label: "Sessions and approvals", hint: "Features", href: "/features/#sessions" },
  { label: "Live preview, shell, desktop", hint: "Features", href: "/features/#workspace" },
  { label: "Skills & plugins", hint: "Features", href: "/features/#agents" },
  { label: "Machines and fleet", hint: "Features", href: "/features/#fleet" },
  { label: "Automations and review", hint: "Features", href: "/features/#automate" },
  { label: "Security", hint: "Page", href: "/security/" },
  { label: "Changelog", hint: "Page", href: "/changelog/" },
  { label: "Install guide", hint: "Docs", href: DOCS, external: true },
  { label: "Source on GitHub", hint: "GitHub", href: REPO, external: true },
  ...Object.values(INSTALL).map((item) => ({ label: `Install on ${item.label}`, hint: "Copy command", copy: item.command })),
];

function Palette({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [copied, setCopied] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const results = useMemo(() => TARGETS.filter((t) => `${t.label} ${t.hint}`.toLowerCase().includes(query.toLowerCase())), [query]);
  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => setActive(0), [query]);
  const choose = (target: (typeof TARGETS)[number]) => {
    if ("copy" in target && target.copy) {
      navigator.clipboard?.writeText(target.copy).then(() => setCopied(target.label)).catch(() => {});
      return;
    }
    if ("href" in target && target.href) {
      if ("external" in target && target.external) window.open(target.href, "_blank", "noreferrer");
      else window.location.href = target.href;
      onClose();
    }
  };
  return (
    <div className="palette-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette" role="dialog" aria-label="Jump to">
        <input
          ref={input}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search pages, features, install…"
          aria-label="Search"
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
            if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(results.length - 1, a + 1)); }
            if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
            if (e.key === "Enter" && results[active]) choose(results[active]);
          }}
        />
        <div className="max-h-[50vh] overflow-y-auto py-2">
          {results.map((target, i) => (
            <button key={target.label} type="button" className={`palette-item ${i === active ? "is-active" : ""}`} onMouseEnter={() => setActive(i)} onClick={() => choose(target)}>
              <span className="min-w-0 flex-1 truncate">{copied === target.label ? "Copied to clipboard" : target.label}</span>
              <span className="font-mono text-[11.5px] text-ink-4">{target.hint}</span>
            </button>
          ))}
          {results.length === 0 && <p className="px-[18px] py-3 text-[14px] text-ink-4">Nothing found.</p>}
        </div>
      </div>
    </div>
  );
}

export function Nav({ page }: { page: Page }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setSearch((s) => !s); }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <header className="site-header">
      <div className="wrapper site-header__inner">
        <a href="/" aria-label="Overseer home" className="flex items-center gap-2">
          <LogoMark size={22} />
          <span className="font-[family-name:var(--font-display)] text-[19px] font-semibold tracking-[-0.04em]">Overseer<span className="text-accent">.</span></span>
        </a>
        <nav aria-label="Main" className="site-nav hidden md:flex">
          {LINKS.map((l) => (
            <a key={l.id} href={l.href} aria-current={l.id === page ? "page" : undefined} {...(l.external ? { target: "_blank", rel: "noreferrer" } : {})}>{l.label}</a>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <button type="button" className="search-button hidden sm:inline-flex" onClick={() => setSearch(true)}>
            <MagnifyingGlass size={14} /> Search…
            <kbd>⌘K</kbd>
          </button>
          <a href={REPO} target="_blank" rel="noreferrer" aria-label="Overseer on GitHub" className="grid size-8 place-items-center rounded-lg text-ink-2 hover:text-ink"><GithubLogo size={20} /></a>
          <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-label={open ? "Close menu" : "Open menu"} className="-mr-2 grid size-10 place-items-center rounded-lg text-ink-2 md:hidden">
            {open ? <X size={20} /> : <List size={20} />}
          </button>
        </div>
      </div>
      {open && (
        <div className="border-t border-line md:hidden">
          <div className="wrapper flex flex-col py-3">
            {LINKS.map((l) => <a key={l.id} href={l.href} onClick={() => setOpen(false)} className="rounded-lg px-1 py-3 text-[16px] text-ink-2" {...(l.external ? { target: "_blank", rel: "noreferrer" } : {})}>{l.label}</a>)}
            <a href="/download/" className="button button--primary mt-2 w-full">Get Started<ArrowRight size={15} /></a>
          </div>
        </div>
      )}
      {search && <Palette onClose={() => setSearch(false)} />}
    </header>
  );
}
