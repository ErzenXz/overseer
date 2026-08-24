import { Eye, GithubLogo } from "@phosphor-icons/react";
import { DOCS, RELEASES, REPO } from "../lib/site";

const LINKS = [
  { label: "Documentation", href: DOCS },
  { label: "Releases", href: RELEASES },
  { label: "Design spec", href: `${REPO}/tree/main/docs/superpowers/specs` },
  { label: "License", href: `${REPO}/blob/main/LICENSE` },
];

export function Footer() {
  return (
    <footer className="border-t border-line py-12">
      <div className="mx-auto flex max-w-[1240px] flex-col gap-8 px-5 sm:flex-row sm:items-center sm:justify-between lg:px-8">
        <div className="flex items-center gap-2.5">
          <Eye size={18} weight="regular" className="text-beacon" />
          <span className="text-[14.5px] font-semibold tracking-tight">
            Overseer
          </span>
          <span className="text-[13.5px] text-fg-dim">MIT licensed</span>
        </div>

        <nav className="flex flex-wrap items-center gap-x-6 gap-y-3">
          {LINKS.map((l) => (
            <a
              key={l.label}
              href={l.href}
              target="_blank"
              rel="noreferrer"
              className="text-[13.5px] text-fg-muted transition-colors hover:text-fg"
            >
              {l.label}
            </a>
          ))}
          <a
            href={REPO}
            target="_blank"
            rel="noreferrer"
            aria-label="Overseer on GitHub"
            className="text-fg-muted transition-colors hover:text-fg"
          >
            <GithubLogo size={18} weight="regular" />
          </a>
        </nav>
      </div>
    </footer>
  );
}
