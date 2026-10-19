import { Reveal } from "../lib/reveal";
import { AgentMark } from "./AgentMark";

// Every entry is an agent Overseer actually drives today.
const AGENTS: { id: string; name: string; vendor: string; via: string }[] = [
  { id: "claude", name: "Claude Code", vendor: "Anthropic", via: "stream-json" },
  { id: "codex", name: "Codex", vendor: "OpenAI", via: "app-server" },
  { id: "gemini", name: "Gemini CLI", vendor: "Google", via: "ACP" },
  { id: "opencode", name: "OpenCode", vendor: "SST", via: "ACP" },
  { id: "goose", name: "Goose", vendor: "Block", via: "ACP" },
  { id: "copilot", name: "Copilot CLI", vendor: "GitHub", via: "ACP" },
  { id: "cursor", name: "Cursor Agent", vendor: "Cursor", via: "ACP" },
  { id: "acp", name: "Any ACP agent", vendor: "Agent Client Protocol", via: "ACP" },
];

export function Agents() {
  return (
    <section aria-labelledby="agents-title" className="pt-24 pb-8 sm:pt-32">
      <div className="container-page">
        <Reveal className="mx-auto max-w-[640px] text-center">
          <h2
            id="agents-title"
            className="text-[22px] font-semibold tracking-[-0.025em] sm:text-[26px]"
          >
            Works with the agents you already pay for.
          </h2>
          <p className="mt-3 text-[15.5px] leading-relaxed text-ink-3">
            Each agent uses the CLI login already on that machine. Your
            subscriptions, your API keys. Nothing is proxied through a third
            party, and Overseer never stores provider tokens.
          </p>
        </Reveal>

        <Reveal delay={0.06}>
          <ul className="mt-10 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-4">
            {AGENTS.map((a) => (
              <li
                key={a.name}
                className="flex flex-col gap-1 bg-page px-4 py-5 sm:px-6 sm:py-6"
              >
                <span className="flex items-center gap-2.5 text-[16px] font-semibold tracking-[-0.02em] sm:text-[17px]">
                  <AgentMark agent={a.id} size={20} />
                  {a.name}
                </span>
                <span className="flex flex-wrap items-center gap-x-2 text-[12.5px] text-ink-3">
                  {a.vendor}
                  <span className="font-mono text-[11px]">{a.via}</span>
                </span>
              </li>
            ))}
          </ul>
        </Reveal>
      </div>
    </section>
  );
}
