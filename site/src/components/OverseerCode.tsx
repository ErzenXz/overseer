import { useState, type FormEvent } from "react";
import { ArrowRight, BellRinging, CircleNotch, Check } from "@phosphor-icons/react";
import { Reveal } from "../lib/reveal";
import { RELEASES, WAITLIST_ENDPOINT } from "../lib/site";

const INTENT = [
  {
    title: "It starts with more than one machine",
    body: "Most coding agents assume a single working directory on a single laptop. This one is handed a fleet, and plans against it.",
  },
  {
    title: "Work you can walk away from",
    body: "Runs inside a persistent session on the target device, so closing the lid does not end the task. Pick it back up from a phone.",
  },
  {
    title: "Nothing extra to install",
    body: "Same static binary as the hub, the agent, and the CLI. If a device has joined, it is already there.",
  },
];

type State = "idle" | "invalid" | "sending" | "done" | "error";

function Waitlist() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<State>("idle");

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setState("invalid");
      return;
    }
    setState("sending");
    try {
      const res = await fetch(WAITLIST_ENDPOINT as string, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      setState(res.ok ? "done" : "error");
    } catch {
      setState("error");
    }
  }

  if (state === "done") {
    return (
      <div className="flex items-center gap-2.5 rounded-control border border-beacon/35 bg-beacon/10 px-4 py-3.5 text-[14.5px] text-fg">
        <Check size={17} weight="bold" className="text-beacon" />
        You are on the list. We will write once, when it ships.
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="max-w-[420px]">
      <label
        htmlFor="waitlist-email"
        className="block text-[13.5px] font-medium text-fg"
      >
        Email
      </label>
      <div className="mt-2 flex flex-col gap-2.5 sm:flex-row">
        <input
          id="waitlist-email"
          type="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            if (state !== "sending") setState("idle");
          }}
          placeholder="you@example.com"
          aria-invalid={state === "invalid"}
          aria-describedby="waitlist-help"
          className="flex-1 rounded-control border border-line bg-ink-950 px-3.5 py-2.5 text-[14.5px] text-fg placeholder:text-fg-dim focus:border-beacon focus:outline-none"
        />
        <button
          type="submit"
          disabled={state === "sending"}
          className="flex items-center justify-center gap-2 rounded-control bg-beacon px-5 py-2.5 text-[14.5px] font-semibold whitespace-nowrap text-ink-950 transition-all duration-150 hover:bg-[#ffc04d] active:scale-[0.98] disabled:opacity-70"
        >
          {state === "sending" ? (
            <>
              <CircleNotch size={16} weight="bold" className="animate-spin" />
              Sending
            </>
          ) : (
            "Notify me"
          )}
        </button>
      </div>
      <p
        id="waitlist-help"
        className={`mt-2 text-[13px] ${
          state === "invalid" || state === "error"
            ? "text-beacon"
            : "text-fg-dim"
        }`}
      >
        {state === "invalid"
          ? "That address does not look right. Check it and try again."
          : state === "error"
            ? "That did not go through. Try again in a moment."
            : "One email when it ships. Nothing else."}
      </p>
    </form>
  );
}

export function OverseerCode() {
  return (
    <section
      id="code"
      className="relative overflow-hidden border-t border-line-soft py-24 lg:py-32"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-[420px] bg-[radial-gradient(ellipse_60%_100%_at_50%_100%,rgba(255,178,36,0.12),transparent)]"
      />

      <div className="relative mx-auto max-w-[1240px] px-5 lg:px-8">
        <Reveal>
          {/* Status sits beside the title, not stacked above it as a label. */}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
            <h2 className="text-[2.6rem] leading-[1.03] font-semibold tracking-tight sm:text-[3.2rem] lg:text-[3.8rem]">
              Overseer Code
            </h2>
            <span className="rounded-control border border-beacon/40 px-2.5 py-1 font-mono text-[11.5px] text-beacon">
              in development
            </span>
          </div>
          <p className="mt-5 max-w-[54ch] text-[17px] leading-relaxed text-fg-muted">
            Overseer already drives other people&rsquo;s coding agents. The next
            piece is our own: a coding agent that treats your machines as one
            place to work, not one laptop at a time.
          </p>
        </Reveal>

        <Reveal delay={0.08}>
          <div className="mt-14 grid grid-cols-1 gap-px overflow-hidden rounded-panel border border-line bg-line lg:grid-cols-3">
            {INTENT.map((item) => (
              <div key={item.title} className="bg-ink-900 p-6 lg:p-7">
                <h3 className="text-[15.5px] font-semibold tracking-tight text-balance">
                  {item.title}
                </h3>
                <p className="mt-3 text-[14.5px] leading-relaxed text-fg-muted">
                  {item.body}
                </p>
              </div>
            ))}
          </div>
        </Reveal>

        <Reveal delay={0.14}>
          <div className="mt-12">
            {WAITLIST_ENDPOINT ? (
              <Waitlist />
            ) : (
              <div className="flex flex-wrap items-center gap-4">
                <a
                  href={RELEASES}
                  target="_blank"
                  rel="noreferrer"
                  className="group flex items-center gap-2 rounded-control bg-beacon px-5 py-3 text-[14.5px] font-semibold whitespace-nowrap text-ink-950 transition-all duration-150 hover:bg-[#ffc04d] active:scale-[0.98]"
                >
                  <BellRinging size={17} weight="regular" />
                  Watch releases
                  <ArrowRight
                    size={16}
                    weight="bold"
                    className="transition-transform duration-200 group-hover:translate-x-0.5"
                  />
                </a>
                <p className="text-[14px] text-fg-dim">
                  GitHub will tell you the moment it lands.
                </p>
              </div>
            )}
          </div>
        </Reveal>
      </div>
    </section>
  );
}
