import { ArrowRight, GithubLogo } from "@phosphor-icons/react";
import { REPO } from "../lib/site";
import { Screenshot } from "./Screenshot";

export function Hero() {
  return (
    <section id="top" className="relative overflow-hidden pt-24 pb-20">
      {/* Structure, not decoration: the grid matches the page's 80px rhythm and
          fades out before it reaches the content. */}
      <div
        aria-hidden
        className="grid-field pointer-events-none absolute inset-0 opacity-60 [mask-image:radial-gradient(ellipse_75%_55%_at_50%_0%,black,transparent)]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 left-1/2 h-[420px] w-[820px] -translate-x-1/2 rounded-full bg-beacon/[0.07] blur-[120px]"
      />

      <div className="relative mx-auto grid max-w-[1240px] grid-cols-1 items-center gap-14 px-5 lg:grid-cols-12 lg:gap-10 lg:px-8">
        <div className="lg:col-span-6">
          <h1 className="hero-rise text-[2.5rem] leading-[1.06] font-semibold tracking-tight sm:text-[2.9rem] lg:text-[3.1rem]">
            Every machine you own.
            <br />
            <span className="text-beacon">One browser tab.</span>
          </h1>

          <p
            className="hero-rise mt-6 max-w-[46ch] text-[16.5px] leading-relaxed text-fg-muted"
            style={{ animationDelay: "0.09s" }}
          >
            Install the hub once, paste one command per device. Live terminals
            and coding agents across your whole fleet.
          </p>

          <div
            className="hero-rise mt-9 flex flex-wrap items-center gap-3"
            style={{ animationDelay: "0.18s" }}
          >
            <a
              href="#install"
              className="group flex items-center gap-2 rounded-control bg-beacon px-5 py-3 text-[14.5px] font-semibold whitespace-nowrap text-ink-950 transition-all duration-150 hover:bg-[#ffc04d] active:scale-[0.98]"
            >
              Install the hub
              <ArrowRight
                size={17}
                weight="bold"
                className="transition-transform duration-200 group-hover:translate-x-0.5"
              />
            </a>
            <a
              href={REPO}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2 rounded-control border border-line bg-ink-900 px-5 py-3 text-[14.5px] font-medium whitespace-nowrap text-fg transition-colors duration-150 hover:border-fg-dim hover:bg-ink-850 active:scale-[0.98]"
            >
              <GithubLogo size={17} weight="regular" />
              Source
            </a>
          </div>
        </div>

        <div
          className="hero-rise lg:col-span-6"
          style={{ animationDelay: "0.24s" }}
        >
          <figure className="relative">
            <div
              aria-hidden
              className="absolute -inset-6 rounded-[24px] bg-gradient-to-br from-beacon/12 via-transparent to-transparent blur-2xl"
            />
            <Screenshot
              src="/shots/dashboard.png"
              alt="The Overseer fleet dashboard showing a connected device with live CPU, memory and disk readings."
              width={1440}
              height={900}
              eager
              className="relative w-full rounded-panel border border-line shadow-[0_30px_80px_-20px_rgba(0,0,0,0.8)]"
            />
          </figure>
        </div>
      </div>
    </section>
  );
}
