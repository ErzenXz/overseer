import { useEffect, useState } from "react";
import { GithubLogo, List, X } from "@phosphor-icons/react";
import { DOCS, REPO } from "../lib/site";
import { Logo } from "./Logo";

// Absolute paths so the links work from /changelog/ too.
const LINKS = [
  { label: "Features", href: "/#features" },
  { label: "How it works", href: "/#how" },
  { label: "Changelog", href: "/changelog/" },
  { label: "Docs", href: DOCS, external: true },
];

export function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const sentinel = document.getElementById("nav-sentinel");
    if (!sentinel) return;
    const io = new IntersectionObserver(([e]) =>
      setScrolled(!e.isIntersecting),
    );
    io.observe(sentinel);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <div
        id="nav-sentinel"
        aria-hidden="true"
        className="absolute top-0 h-2 w-full"
      />
      <header
        className={`fixed inset-x-0 top-0 z-50 border-b transition-[background-color,border-color] duration-300 ${
          open
            ? "border-line bg-page"
            : scrolled
              ? "border-line bg-page/80 backdrop-blur-xl backdrop-saturate-150"
              : "border-transparent bg-page/0"
        }`}
      >
        <nav
          aria-label="Main"
          className="container-page flex h-14 items-center gap-8"
        >
          <a href="/" aria-label="Overseer home" className="rounded-md">
            <Logo />
          </a>

          <div className="hidden items-center gap-1 md:flex">
            {LINKS.map((l) => (
              <a
                key={l.label}
                href={l.href}
                {...(l.external ? { target: "_blank", rel: "noreferrer" } : {})}
                className="rounded-lg px-3 py-1.5 text-[14px] text-ink-3 transition-colors hover:text-ink"
              >
                {l.label}
              </a>
            ))}
          </div>

          <div className="ml-auto hidden items-center gap-2 md:flex">
            <a
              href={REPO}
              target="_blank"
              rel="noreferrer"
              className="btn btn-sm btn-ghost"
            >
              <GithubLogo size={16} />
              GitHub
            </a>
            <a href="/#install" className="btn btn-sm btn-dark">
              Get started
            </a>
          </div>

          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls="mobile-menu"
            aria-label={open ? "Close menu" : "Open menu"}
            className="-mr-2 ml-auto grid size-10 place-items-center rounded-lg text-ink-2 hover:bg-hover md:hidden"
          >
            {open ? <X size={20} /> : <List size={20} />}
          </button>
        </nav>

        {open && (
          <div id="mobile-menu" className="border-t border-line md:hidden">
            <div className="container-page flex flex-col py-3">
              {LINKS.map((l) => (
                <a
                  key={l.label}
                  href={l.href}
                  onClick={() => setOpen(false)}
                  {...(l.external
                    ? { target: "_blank", rel: "noreferrer" }
                    : {})}
                  className="rounded-lg px-2 py-3 text-[16px] text-ink-2 hover:bg-hover"
                >
                  {l.label}
                </a>
              ))}
              <a
                href={REPO}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-2 rounded-lg px-2 py-3 text-[16px] text-ink-2 hover:bg-hover"
              >
                <GithubLogo size={18} /> GitHub
              </a>
              <a
                href="/#install"
                onClick={() => setOpen(false)}
                className="btn btn-dark mt-2 w-full"
              >
                Get started
              </a>
            </div>
          </div>
        )}
      </header>
    </>
  );
}
