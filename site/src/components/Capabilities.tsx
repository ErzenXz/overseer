import {
  ArrowsClockwise,
  Cube,
  FolderOpen,
  Terminal,
  DeviceMobile,
} from "@phosphor-icons/react";
import { Reveal } from "../lib/reveal";
import { Screenshot } from "./Screenshot";

function Cell({
  className = "",
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`rounded-panel border border-line bg-ink-900 transition-colors duration-300 hover:border-fg-dim/40 ${className}`}
    >
      {children}
    </div>
  );
}

function Copy({
  icon: Icon,
  title,
  body,
}: {
  icon: typeof Terminal;
  title: string;
  body: string;
}) {
  return (
    <div className="p-6 lg:p-7">
      <Icon size={20} weight="regular" className="text-beacon" />
      <h3 className="mt-4 text-[17px] font-semibold tracking-tight">{title}</h3>
      <p className="mt-2.5 text-[14.5px] leading-relaxed text-fg-muted">{body}</p>
    </div>
  );
}

function Shot({ src, alt }: { src: string; alt: string }) {
  return (
    <Screenshot
      src={src}
      alt={alt}
      className="h-full w-full object-cover object-left-top"
    />
  );
}

export function Capabilities() {
  return (
    <section className="border-t border-line-soft py-24 lg:py-32">
      <div className="mx-auto max-w-[1240px] px-5 lg:px-8">
        <Reveal className="max-w-[42ch]">
          <h2 className="text-[2rem] leading-[1.1] font-semibold tracking-tight text-balance sm:text-[2.4rem]">
            What you get the moment a device joins.
          </h2>
        </Reveal>

        <Reveal delay={0.08}>
          <div className="mt-12 grid grid-cols-1 gap-4 lg:grid-cols-6">
            <Cell className="lg:col-span-2">
              <Copy
                icon={DeviceMobile}
                title="Sessions survive you"
                body="Terminals run in tmux on the device itself. Shut the laptop, reopen on your phone, the agent is still mid-task."
              />
            </Cell>

            <Cell className="overflow-hidden lg:col-span-4">
              <div className="flex items-center gap-2.5 px-6 pt-6 pb-5">
                <Terminal size={18} weight="regular" className="text-beacon" />
                <h3 className="text-[15.5px] font-semibold tracking-tight">
                  A real terminal in the browser
                </h3>
              </div>
              <div className="h-[260px] overflow-hidden border-t border-line">
                <Shot
                  src="/shots/terminal.png"
                  alt="An Overseer browser terminal attached to a live shell session on a joined device."
                />
              </div>
            </Cell>

            <Cell className="overflow-hidden lg:col-span-4">
              <div className="flex items-center gap-2.5 px-6 pt-6 pb-5">
                <FolderOpen size={18} weight="regular" className="text-beacon" />
                <h3 className="text-[15.5px] font-semibold tracking-tight">
                  Browse and move files across devices
                </h3>
              </div>
              <div className="h-[260px] overflow-hidden border-t border-line">
                <Shot
                  src="/shots/files.png"
                  alt="The Overseer file browser listing directories on a remote device."
                />
              </div>
            </Cell>

            <Cell className="lg:col-span-2">
              <Copy
                icon={Cube}
                title="One binary, nothing else"
                body="Hub, device agent, CLI, and MCP server are the same static executable. The web UI is compiled into it."
              />
            </Cell>

            <Cell className="relative overflow-hidden lg:col-span-6">
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_120%_at_88%_50%,rgba(255,178,36,0.14),transparent)]"
              />
              <div className="relative grid grid-cols-1 items-center gap-8 p-6 lg:grid-cols-2 lg:p-8">
                <div>
                  <ArrowsClockwise
                    size={20}
                    weight="regular"
                    className="text-beacon"
                  />
                  <h3 className="mt-4 text-[17px] font-semibold tracking-tight">
                    Updates that can be undone
                  </h3>
                  <p className="mt-2.5 max-w-[52ch] text-[14.5px] leading-relaxed text-fg-muted">
                    Every download is checked against the release checksums, and
                    the staged binary has to report the version it claims before
                    anything is replaced. The previous binary stays on disk, so
                    one click puts it back.
                  </p>
                </div>
                <div className="rounded-control border border-line bg-ink-950/70 p-5 font-mono text-[12.5px] leading-[2] text-fg-muted">
                  <div>
                    <span className="mr-2 text-beacon select-none">$</span>
                    overseer update --check
                  </div>
                  <div>
                    <span className="mr-2 text-beacon select-none">$</span>
                    overseer update
                  </div>
                  <div>
                    <span className="mr-2 text-beacon select-none">$</span>
                    overseer rollback
                  </div>
                </div>
              </div>
            </Cell>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
