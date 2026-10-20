import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/inter";
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "../index.css";
import { Footer } from "./Footer";
import { Nav, type Page } from "./Nav";

function Layout({ page, main, children }: { page: Page; main: boolean; children: ReactNode }) {
  return (
    <>
      <a href="#main" className="sr-only z-[60] rounded-lg bg-inverse px-4 py-2 text-on-inverse focus:not-sr-only focus:fixed focus:top-3 focus:left-3">Skip to content</a>
      <Nav page={page} />
      {main ? <main id="main">{children}</main> : children}
      <Footer />
    </>
  );
}

// mount renders one page of the site into #root. Pages that lay out their own
// <main> (the docs) pass { main: false }.
export function mount(page: Page, content: ReactNode, { main = true }: { main?: boolean } = {}) {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <Layout page={page} main={main}>{content}</Layout>
    </StrictMode>,
  );
}

// PageHeader is the framed title block at the top of inner pages.
export function PageHeader({ label, title, children, aside }: { label: string; title: ReactNode; children?: ReactNode; aside?: ReactNode }) {
  return (
    <section className="frame">
      <div className={`grid ${aside ? "lg:grid-cols-[1.1fr_1fr]" : ""}`}>
        <div className="section pb-14 sm:pb-16">
          <p className="label rise">{label}</p>
          <h1 className="h-display rise mt-5 text-[42px] sm:text-[60px]" style={{ animationDelay: "60ms" }}>{title}</h1>
          {children && <div className="lede rise mt-6 max-w-[56ch]" style={{ animationDelay: "120ms" }}>{children}</div>}
        </div>
        {aside && <div className="relative min-h-[260px] border-t border-line lg:border-t-0 lg:border-l">{aside}</div>}
      </div>
    </section>
  );
}
