import { useEffect, useState } from "react";
import { GithubLogo, List, X, Eye } from "@phosphor-icons/react";
import { REPO } from "../lib/site";

const LINKS = [
  { label: "How it works", href: "#how" },
  { label: "Fleet agents", href: "#agents" },
  { label: "Overseer Code", href: "#code" },
];

export function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  // IntersectionObserver on a sentinel instead of a scroll listener, so this
  // costs nothing per frame.
  useEffect(() => {
    const sentinel = document.getElementById("nav-sentinel");
    if (!sentinel) return;
    const io = new IntersectionObserver(
      ([entry]) => setScrolled(!entry.isIntersecting),
      { rootMargin: "0px" },
    );
    io.observe(sentinel);
    return () => io.disconnect();
  }, []);

  return (
    <>
      <div id="nav-sentinel" aria-hidden className="absolute top-0 h-px w-full" />
      <header
        className={`fixed inset-x-0 top-0 z-40 transition-colors duration-300 ${
          scrolled
            ? "border-b border-line bg-ink-950/80 backdrop-blur-xl"
            : "border-b border-transparent"
        }`}
      >
        <nav className="mx-auto flex h-16 max-w-[1240px] items-center gap-8 px-5 lg:px-8">
          <a href="#top" className="flex shrink-0 items-center gap-2.5">
            <Eye size={20} weight="regular" className="text-beacon" />
            <span className="text-[15px] font-semibold tracking-tight">
              Overseer
            </span>
          </a>

          <div className="hidden flex-1 items-center gap-7 md:flex">
            {LINKS.map((l) => (
              <a
                key={l.href}
                href={l.href}
                className="text-[13.5px] text-fg-muted transition-colors hover:text-fg"
              >
                {l.label}
              </a>
            ))}
          </div>

          <div className="ml-auto hidden items-center gap-3 md:flex">
            <a
              href={REPO}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2 rounded-control px-3 py-2 text-[13.5px] text-fg-muted transition-colors hover:bg-ink-850 hover:text-fg"
            >
              <GithubLogo size={17} weight="regular" />
              Source
            </a>
            <a
              href="#install"
              className="rounded-control bg-beacon px-4 py-2 text-[13.5px] font-semibold text-ink-950 transition-transform duration-150 hover:bg-[#ffc04d] active:scale-[0.98]"
            >
              Install the hub
            </a>
          </div>

          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-label={open ? "Close menu" : "Open menu"}
            className="ml-auto rounded-control p-2 text-fg-muted transition-colors hover:text-fg md:hidden"
          >
            {open ? <X size={20} /> : <List size={20} />}
          </button>
        </nav>

        {open && (
          <div className="border-t border-line bg-ink-950/95 px-5 py-4 backdrop-blur-xl md:hidden">
            <div className="flex flex-col gap-1">
              {LINKS.map((l) => (
                <a
                  key={l.href}
                  href={l.href}
                  onClick={() => setOpen(false)}
                  className="rounded-control px-2 py-3 text-[15px] text-fg-muted hover:bg-ink-850 hover:text-fg"
                >
                  {l.label}
                </a>
              ))}
              <a
                href={REPO}
                target="_blank"
                rel="noreferrer"
                className="rounded-control px-2 py-3 text-[15px] text-fg-muted hover:bg-ink-850 hover:text-fg"
              >
                Source
              </a>
              <a
                href="#install"
                onClick={() => setOpen(false)}
                className="mt-2 rounded-control bg-beacon px-4 py-2.5 text-center text-[15px] font-semibold text-ink-950"
              >
                Install the hub
              </a>
            </div>
          </div>
        )}
      </header>
    </>
  );
}
