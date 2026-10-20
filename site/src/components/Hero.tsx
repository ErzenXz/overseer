import { useRef, type PointerEvent } from "react";
import { ArrowRight, GithubLogo } from "@phosphor-icons/react";
import { REPO } from "../lib/site";
import { FleetField } from "./FleetField";
import { HeroInstall } from "./InstallCommand";
import { AppWindow } from "./mock/AppWindow";

export function Hero() {
  const stage = useRef<HTMLDivElement>(null);
  const room = useRef<HTMLDivElement>(null);
  // The dot grid lights up around the cursor; CSS does the drawing.
  const onPointer = (event: PointerEvent) => {
    const rect = stage.current?.getBoundingClientRect();
    if (!rect) return;
    stage.current!.style.setProperty("--mx", `${event.clientX - rect.left}px`);
    stage.current!.style.setProperty("--my", `${event.clientY - rect.top}px`);
  };

  return (
    <section id="top" className="relative" aria-labelledby="hero-title">
      <div ref={stage} onPointerMove={onPointer} className="hero-stage">
        <div aria-hidden="true" className="hero-grid" />
        <div aria-hidden="true" className="hero-grid hero-grid-lit" />
        <FleetField className="hero-field" anchor={room} />
        <div aria-hidden="true" className="hero-grain" />

        <div className="container-page relative flex flex-col items-center pt-32 text-center sm:pt-40">
          <a href="/changelog/" className="hero-rise hero-pill group">
            <span className="hero-pill-tag">v0.4.0</span>
            Skills &amp; plugins for every agent
            <ArrowRight size={13} className="text-ink-3 transition-transform group-hover:translate-x-0.5" />
          </a>

          <h1
            id="hero-title"
            className="hero-rise h-display mt-8 max-w-[14ch] text-[44px] sm:max-w-none sm:text-[72px] lg:text-[92px]"
            style={{ animationDelay: "60ms" }}
          >
            <span className="block">Every coding agent.</span>
            <span className="block text-ink-3">Every machine. One tab.</span>
          </h1>

          <p className="hero-rise lede mt-7 max-w-[58ch] text-[16px] sm:text-[19px]" style={{ animationDelay: "120ms" }}>
            Your own Devin, on your own computers. Run Claude Code, Codex,
            Gemini, Devin and any ACP agent on your laptop, homelab and cloud
            boxes, then steer them all from one browser tab, at your desk or on
            your phone.
          </p>

          <div className="hero-rise mt-10 flex w-full flex-col items-center" style={{ animationDelay: "180ms" }}>
            <HeroInstall />
            <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5">
              <a href="#install" className="btn btn-dark">
                Get started
                <ArrowRight size={15} />
              </a>
              <a href={REPO} target="_blank" rel="noreferrer" className="btn btn-outline">
                <GithubLogo size={16} />
                View on GitHub
              </a>
            </div>
          </div>

          {/* Room for the fleet: the hub and its orbits sit here. */}
          <div ref={room} aria-hidden="true" className="h-[250px] sm:h-[420px]" />
          <p className="hero-caption">
            <span className="hero-caption-dot" /> Live: a hub and the machines that dial in to it
          </p>
        </div>
      </div>

      <div className="hero-rise container-page relative -mt-28 sm:-mt-36" style={{ animationDelay: "260ms" }}>
        <div className="hero-window">
          <AppWindow />
        </div>
      </div>
    </section>
  );
}
