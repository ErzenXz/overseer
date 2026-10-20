import { REPO } from "../lib/site";
import { LogoMark } from "./Logo";

export function Footer() {
  return (
    <footer className="site-footer">
      <div className="wrapper site-footer__inner">
        <span className="flex items-center gap-2">
          <LogoMark size={18} />
          <span className="font-medium">Overseer</span>
          <span className="muted">· every coding agent, on every machine</span>
        </span>
        <nav aria-label="Footer">
          <a href="/docs/">Docs</a>
          <a href="/features/">Features</a>
          <a href="/security/">Security</a>
          <a href="/changelog/">Changelog</a>
          <a href={REPO} target="_blank" rel="noreferrer">GitHub</a>
        </nav>
      </div>
    </footer>
  );
}
