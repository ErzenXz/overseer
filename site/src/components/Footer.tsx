import { ArrowRight, GithubLogo } from "@phosphor-icons/react";
import { DOCS, ISSUES, LICENSE, RELEASES, REPO } from "../lib/site";
import { Logo, LogoMark } from "./Logo";

const COLUMNS: {
  title: string;
  links: { label: string; href: string; external?: boolean }[];
}[] = [
  {
    title: "Product",
    links: [
      { label: "Features", href: "/#features" },
      { label: "How it works", href: "/#how" },
      { label: "Security", href: "/#security" },
      { label: "Install", href: "/#install" },
      { label: "Changelog", href: "/changelog/" },
    ],
  },
  {
    title: "Resources",
    links: [
      { label: "Documentation", href: DOCS, external: true },
      { label: "Releases", href: RELEASES, external: true },
      { label: "Report an issue", href: ISSUES, external: true },
      { label: "MIT License", href: LICENSE, external: true },
    ],
  },
];

export function ClosingCTA() {
  return (
    <section aria-labelledby="cta-title" className="border-t border-line">
      <div className="container-page flex flex-col items-center py-24 text-center sm:py-32">
        <LogoMark size={36} />
        <h2 id="cta-title" className="h-section mt-8 max-w-[18ch]">
          Put every agent you have to work.
        </h2>
        <p className="lede mt-5 max-w-[48ch]">
          One hub, one command per machine, one tab for all of it.
        </p>
        <div className="mt-9 flex flex-wrap justify-center gap-2.5">
          <a href="/#install" className="btn btn-dark">
            Install Overseer <ArrowRight size={15} />
          </a>
          <a
            href={REPO}
            target="_blank"
            rel="noreferrer"
            className="btn btn-outline"
          >
            <GithubLogo size={16} /> GitHub
          </a>
        </div>
      </div>
    </section>
  );
}

export function Footer() {
  return (
    <footer className="border-t border-line">
      <div className="container-page grid grid-cols-2 gap-10 py-14 sm:grid-cols-4">
        <div className="col-span-2">
          <Logo />
          <p className="mt-3 max-w-[34ch] text-[14px] leading-relaxed text-ink-3">
            The self-hosted control plane for every coding agent on every
            machine you own.
          </p>
        </div>
        {COLUMNS.map((c) => (
          <nav key={c.title} aria-label={c.title}>
            <h2 className="text-[13px] font-medium text-ink">{c.title}</h2>
            <ul className="mt-3 space-y-2">
              {c.links.map((l) => (
                <li key={l.label}>
                  <a
                    href={l.href}
                    {...(l.external
                      ? { target: "_blank", rel: "noreferrer" }
                      : {})}
                    className="text-[14px] text-ink-3 transition-colors hover:text-ink"
                  >
                    {l.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="container-page">
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line py-6 text-[13px] text-ink-3">
          <span>Open source under the MIT license.</span>
          <a
            href={REPO}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 hover:text-ink"
          >
            <GithubLogo size={15} /> ErzenXz/overseer
          </a>
        </div>
      </div>
    </footer>
  );
}
