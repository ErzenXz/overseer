import { GithubLogo } from "@phosphor-icons/react";
import { DOCS, ISSUES, LICENSE, RELEASES, REPO } from "../lib/site";
import { Logo } from "./Logo";

const COLUMNS = [
  { title: "Product", links: [
    { label: "Features", href: "/features/" },
    { label: "Download", href: "/download/" },
    { label: "Security", href: "/security/" },
    { label: "Changelog", href: "/changelog/" },
  ] },
  { title: "Resources", links: [
    { label: "Guide", href: DOCS, external: true },
    { label: "Releases", href: RELEASES, external: true },
    { label: "Report an issue", href: ISSUES, external: true },
    { label: "MIT License", href: LICENSE, external: true },
  ] },
];

export function Footer() {
  return (
    <footer>
      <div className="rule" />
      <div className="frame">
        <div className="cells grid-cols-2 sm:grid-cols-4">
          <div className="cell col-span-2">
            <Logo />
            <p className="mt-3 max-w-[34ch] text-[14px] leading-relaxed text-ink-3">Your coding agents, on all your computers, in one browser tab. Self-hosted and open source.</p>
          </div>
          {COLUMNS.map((c) => (
            <nav key={c.title} aria-label={c.title} className="cell">
              <h2 className="label">{c.title}</h2>
              <ul className="mt-4 space-y-2.5">
                {c.links.map((l) => (
                  <li key={l.label}><a href={l.href} {...("external" in l && l.external ? { target: "_blank", rel: "noreferrer" } : {})} className="text-[14px] text-ink-3 transition-colors hover:text-ink">{l.label}</a></li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
      </div>
      <div className="rule" />
      <div className="frame flex flex-wrap items-center justify-between gap-3 px-6 py-5 text-[13px] text-ink-3 sm:px-9">
        <span>Open source under the MIT license.</span>
        <a href={REPO} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 hover:text-ink"><GithubLogo size={15} /> ErzenXz/overseer</a>
      </div>
    </footer>
  );
}
