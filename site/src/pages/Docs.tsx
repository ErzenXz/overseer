import { useEffect, useMemo, useState, type MouseEvent } from "react";
import { ArrowLeft, ArrowRight, List, PencilSimple, X } from "@phosphor-icons/react";
import { mount } from "../components/Layout";
import { DOC_GROUPS, DOC_PAGES, docHref } from "../docs/nav";
import { parseDoc, renderBlocks } from "../docs/markdown";
import { REPO } from "../lib/site";

// The docs: a sidebar of pages, the article, and an "On this page" list.
// Every page has its own static HTML entry (written by vite.config.ts), and
// moving between pages swaps the article in place, so it feels instant.

const SOURCES = import.meta.glob("../content/docs/*.md", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const sourceFor = (slug: string) => SOURCES[`../content/docs/${slug || "index"}.md`] ?? "";

const slugFromPath = (path: string) => {
  const slug = path.replace(/^\/docs\/?/, "").replace(/\/$/, "");
  return DOC_PAGES.some((page) => page.slug === slug) ? slug : "";
};

function useScrollSpy(ids: string[]) {
  const [active, setActive] = useState("");
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      let current = ids[0] ?? "";
      for (const id of ids) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top < 130) current = id;
      }
      // At the very bottom, the last heading wins even if it's short.
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) current = ids[ids.length - 1] ?? current;
      setActive(current);
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(update); };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => { window.removeEventListener("scroll", onScroll); window.removeEventListener("resize", onScroll); cancelAnimationFrame(frame); };
  }, [ids]);
  return active;
}

function Docs() {
  const [slug, setSlug] = useState(() => slugFromPath(window.location.pathname));
  const [menu, setMenu] = useState(false);
  const index = DOC_PAGES.findIndex((page) => page.slug === slug);
  const page = DOC_PAGES[index];
  const prev = DOC_PAGES[index - 1];
  const next = DOC_PAGES[index + 1];
  const doc = useMemo(() => parseDoc(sourceFor(slug)), [slug]);
  const ids = useMemo(() => doc.headings.map((h) => h.id), [doc]);
  const active = useScrollSpy(ids);

  useEffect(() => {
    document.title = slug ? `${page.title} · Overseer Docs` : "Overseer Docs";
  }, [slug, page]);

  useEffect(() => {
    const onPop = () => { setSlug(slugFromPath(window.location.pathname)); setMenu(false); };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // Land on the #anchor once the article for this page is in the DOM.
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    const el = id && document.getElementById(id);
    if (el) {
      el.scrollIntoView();
      // Again once the web fonts are in, since they change the layout above.
      document.fonts?.ready.then(() => el.scrollIntoView());
    } else window.scrollTo(0, 0);
  }, [slug]);

  useEffect(() => {
    document.body.style.overflow = menu ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [menu]);

  // Links to other docs pages swap the article instead of loading a page.
  const onClick = (e: MouseEvent) => {
    const link = (e.target as HTMLElement).closest("a");
    if (!link || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || link.target) return;
    const url = new URL(link.href, window.location.href);
    if (url.origin !== window.location.origin || !url.pathname.startsWith("/docs")) return;
    const target = slugFromPath(url.pathname);
    e.preventDefault();
    setMenu(false);
    if (target === slug) {
      history.pushState(null, "", url.pathname + url.hash);
      const el = url.hash && document.getElementById(decodeURIComponent(url.hash.slice(1)));
      if (el) el.scrollIntoView({ behavior: "smooth" });
      else window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    history.pushState(null, "", url.pathname + url.hash);
    setSlug(target);
  };

  const file = `site/src/content/docs/${slug || "index"}.md`;

  return (
    <div className="docs" onClick={onClick}>
      <div className="docs-bar">
        <button type="button" className="docs-bar__menu" onClick={() => setMenu(true)} aria-expanded={menu} aria-controls="docs-nav">
          <List size={16} /> Menu
        </button>
        <span className="docs-bar__crumb">{page.group} <span aria-hidden="true">›</span> <b>{page.title}</b></span>
      </div>

      {menu && <div className="docs-scrim" onClick={() => setMenu(false)} />}
      <aside id="docs-nav" className={`docs-nav ${menu ? "is-open" : ""}`} aria-label="Docs">
        <button type="button" className="docs-nav__close" onClick={() => setMenu(false)} aria-label="Close menu"><X size={18} /></button>
        {DOC_GROUPS.map((group) => (
          <div key={group.title} className="docs-nav__group">
            <p className="docs-nav__title">{group.title}</p>
            {group.pages.map((item) => (
              <a key={item.slug} href={docHref(item.slug)} aria-current={item.slug === slug ? "page" : undefined}>{item.title}</a>
            ))}
          </div>
        ))}
      </aside>

      <main id="main" className="docs-main">
        <article className="docs-article" key={slug}>
          <p className="eyebrow">{page.group}</p>
          <h1>{page.title}</h1>
          {doc.meta.lead && <p className="docs-lead">{doc.meta.lead}</p>}
          {renderBlocks(doc.blocks)}

          <div className="docs-edit">
            <a href={`${REPO}/blob/main/${file}`} target="_blank" rel="noreferrer"><PencilSimple size={14} /> Edit this page on GitHub</a>
          </div>
          <nav className="docs-pager" aria-label="More docs">
            {prev ? (
              <a href={docHref(prev.slug)} className="docs-pager__link docs-pager__link--prev">
                <span className="docs-pager__label"><ArrowLeft size={13} /> Previous</span>
                <span className="docs-pager__title">{prev.title}</span>
              </a>
            ) : <span />}
            {next && (
              <a href={docHref(next.slug)} className="docs-pager__link docs-pager__link--next">
                <span className="docs-pager__label">Next <ArrowRight size={13} /></span>
                <span className="docs-pager__title">{next.title}</span>
              </a>
            )}
          </nav>
        </article>
      </main>

      <aside className="docs-toc" aria-label="On this page">
        {doc.headings.length > 0 && (
          <>
            <p className="docs-toc__title">On this page</p>
            <nav>
              {doc.headings.map((h) => (
                <a key={h.id} href={`#${h.id}`} className={`${h.level === 3 ? "is-sub" : ""} ${active === h.id ? "is-active" : ""}`}>{h.text.replace(/`/g, "")}</a>
              ))}
            </nav>
          </>
        )}
      </aside>
    </div>
  );
}

mount("docs", <Docs />, { main: false });
