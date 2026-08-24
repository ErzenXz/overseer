import { Reveal } from "../lib/reveal";

const GROUPS = [
  {
    group: "Devices",
    tools: ["list_devices", "run_command"],
  },
  {
    group: "Sessions",
    tools: [
      "list_sessions",
      "create_session",
      "send_input",
      "read_output",
      "kill_session",
    ],
  },
  {
    group: "Files",
    tools: ["list_files", "read_file", "write_file"],
  },
];

export function FleetAgents() {
  return (
    <section id="agents" className="border-t border-line-soft py-24 lg:py-32">
      <div className="mx-auto grid max-w-[1240px] grid-cols-1 gap-14 px-5 lg:grid-cols-12 lg:gap-16 lg:px-8">
        <div className="lg:col-span-5">
          <Reveal>
            <h2 className="text-[2rem] leading-[1.1] font-semibold tracking-tight text-balance sm:text-[2.4rem]">
              Let a coding agent run the fleet.
            </h2>
            <p className="mt-5 max-w-[48ch] text-[16px] leading-relaxed text-fg-muted">
              Claude Code, Codex, and Cursor connect over MCP and treat every
              joined machine as one workspace. The hub also serves the same
              tools over HTTP, so ChatGPT and any other remote connector can
              reach them.
            </p>
          </Reveal>

          <Reveal delay={0.08}>
            <div className="mt-8 overflow-hidden rounded-panel border border-line bg-ink-900">
              <div className="overflow-x-auto p-5 font-mono text-[12.5px] leading-[1.9] whitespace-pre text-fg-muted">
                <div>
                  <span className="mr-2 text-beacon select-none">$</span>
                  overseer fleet login --hub http://YOUR-HUB:4200 --token TOKEN
                </div>
                <div>
                  <span className="mr-2 text-beacon select-none">$</span>
                  claude mcp add overseer -- overseer mcp
                </div>
              </div>
            </div>
          </Reveal>

          <Reveal delay={0.14}>
            <figure className="mt-8 border-l-2 border-beacon/60 pl-5">
              <blockquote className="text-[16px] leading-relaxed text-fg italic">
                &ldquo;Launch claude in ~/projects/api on the homelab box, have
                it fix the failing tests, then report back.&rdquo;
              </blockquote>
              <figcaption className="mt-2.5 text-[13.5px] text-fg-dim">
                The kind of instruction the senior agent turns into work on
                another machine.
              </figcaption>
            </figure>
          </Reveal>
        </div>

        <div className="lg:col-span-7">
          <Reveal delay={0.06}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {GROUPS.map((g) => (
                <div
                  key={g.group}
                  className={`rounded-panel border border-line bg-ink-900 p-5 ${
                    // Sessions carries the most tools, so it takes the tall
                    // right-hand cell and the other two stack beside it.
                    g.group === "Sessions"
                      ? "sm:col-start-2 sm:row-span-2 sm:row-start-1"
                      : ""
                  }`}
                >
                  <h3 className="text-[14.5px] font-semibold tracking-tight">
                    {g.group}
                  </h3>
                  <ul className="mt-4 flex flex-wrap gap-2">
                    {g.tools.map((t) => (
                      <li
                        key={t}
                        className="rounded-control border border-line bg-ink-850 px-2.5 py-1.5 font-mono text-[12px] text-fg-muted"
                      >
                        {t}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}

              <div className="rounded-panel border border-beacon/25 bg-[linear-gradient(160deg,rgba(255,178,36,0.10),transparent_65%)] p-5 sm:col-span-2">
                <h3 className="text-[14.5px] font-semibold tracking-tight">
                  Same tools from the CLI
                </h3>
                <div className="mt-4 overflow-x-auto font-mono text-[12px] leading-[2] whitespace-pre text-fg-muted">
                  <div>overseer fleet devices</div>
                  <div>overseer fleet run homelab -- git status</div>
                  <div>overseer fleet read homelab build</div>
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
