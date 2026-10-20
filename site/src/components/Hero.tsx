import { ArrowRight, GithubLogo } from "@phosphor-icons/react";
import { REPO } from "../lib/site";
import { HeroInstall } from "./InstallCommand";
import { AppWindow } from "./mock/AppWindow";

export function Hero() {
  return (
    <section
      id="top"
      className="relative pt-28 sm:pt-32"
      aria-labelledby="hero-title"
    >
      {/* A soft wash behind the product, not a gradient headline. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[900px] bg-[radial-gradient(60%_50%_at_50%_0%,var(--subtle),transparent)]"
      />

      <div className="container-page flex flex-col items-center text-center">
        <a
          href={REPO}
          target="_blank"
          rel="noreferrer"
          className="hero-rise group inline-flex items-center gap-2 rounded-full border border-line bg-elev py-1 pr-3 pl-1.5 text-[13px] text-ink-2 shadow-[var(--shadow-card)] transition-colors hover:border-line-strong"
        >
          <span className="rounded-full bg-hover px-2 py-0.5 text-[12px] font-medium text-ink">
            Open source
          </span>
          Self-hosted, MIT licensed
          <ArrowRight
            size={13}
            className="text-ink-3 transition-transform group-hover:translate-x-0.5"
          />
        </a>

        <h1
          id="hero-title"
          className="hero-rise h-display mt-7 max-w-[13ch] text-[40px] sm:max-w-none sm:text-[64px] lg:text-[80px]"
          style={{ animationDelay: "60ms" }}
        >
          Every coding agent.
          <br className="hidden sm:block" /> Every machine. One tab.
        </h1>

        <p
          className="hero-rise lede mt-6 max-w-[60ch] text-[16px] sm:text-[19px]"
          style={{ animationDelay: "120ms" }}
        >
          Overseer is your own Devin, on your own machines. Run Claude Code,
          Codex, Gemini CLI and any ACP agent on your laptop, homelab and cloud
          boxes, then steer them all from one browser tab, at your desk or on
          your phone.
        </p>

        <div
          className="hero-rise mt-9 flex w-full flex-col items-center"
          style={{ animationDelay: "180ms" }}
        >
          <HeroInstall />
          <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5">
            <a href="#install" className="btn btn-dark">
              Get started
              <ArrowRight size={15} />
            </a>
            <a
              href={REPO}
              target="_blank"
              rel="noreferrer"
              className="btn btn-outline"
            >
              <GithubLogo size={16} />
              View on GitHub
            </a>
          </div>
          <p className="mt-5 text-[13px] text-ink-3">
            One binary · macOS, Linux, Windows · No inbound ports
          </p>
        </div>
      </div>

      <div
        className="hero-rise container-page mt-14 sm:mt-16"
        style={{ animationDelay: "260ms" }}
      >
        <AppWindow />
      </div>
    </section>
  );
}
