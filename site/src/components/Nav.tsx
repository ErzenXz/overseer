import { useEffect, useState } from "react";
import { GithubLogo, List, X } from "@phosphor-icons/react";
import { DOCS, REPO } from "../lib/site";
import { Logo } from "./Logo";

export type Page = "home" | "features" | "download" | "security" | "changelog";

const LINKS: { id: Page | "docs"; label: string; href: string; external?: boolean }[] = [
  { id: "features", label: "Features", href: "/features/" },
  { id: "download", label: "Download", href: "/download/" },
  { id: "security", label: "Security", href: "/security/" },
  { id: "changelog", label: "Changelog", href: "/changelog/" },
  { id: "docs", label: "Docs", href: DOCS, external: true },
];

export function Nav({ page }: { page: Page }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <header className="nav">
      <nav aria-label="Main" className="frame flex h-14 items-center gap-6 border-y-0 px-4 sm:px-6">
        <a href="/" aria-label="Overseer home" className="rounded-md"><Logo /></a>
        <div className="hidden items-center gap-0.5 md:flex">
          {LINKS.map((l) => (
            <a key={l.id} href={l.href} className="nav-link" aria-current={l.id === page ? "page" : undefined} {...(l.external ? { target: "_blank", rel: "noreferrer" } : {})}>
              {l.label}
            </a>
          ))}
        </div>
        <div className="ml-auto hidden items-center gap-2 md:flex">
          <a href={REPO} target="_blank" rel="noreferrer" className="btn btn-sm btn-ghost"><GithubLogo size={16} />GitHub</a>
          <a href="/download/" className="btn btn-sm btn-dark">Get Overseer</a>
        </div>
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-controls="mobile-menu" aria-label={open ? "Close menu" : "Open menu"} className="-mr-2 ml-auto grid size-10 place-items-center rounded-lg text-ink-2 hover:bg-hover md:hidden">
          {open ? <X size={20} /> : <List size={20} />}
        </button>
      </nav>
      {open && (
        <div id="mobile-menu" className="border-t border-line md:hidden">
          <div className="frame flex flex-col border-y-0 px-4 py-3">
            {LINKS.map((l) => (
              <a key={l.id} href={l.href} onClick={() => setOpen(false)} className="rounded-lg px-2 py-3 text-[16px] text-ink-2 hover:bg-hover" aria-current={l.id === page ? "page" : undefined} {...(l.external ? { target: "_blank", rel: "noreferrer" } : {})}>{l.label}</a>
            ))}
            <a href={REPO} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-lg px-2 py-3 text-[16px] text-ink-2 hover:bg-hover"><GithubLogo size={18} /> GitHub</a>
            <a href="/download/" className="btn btn-dark mt-2 w-full">Get Overseer</a>
          </div>
        </div>
      )}
    </header>
  );
}
