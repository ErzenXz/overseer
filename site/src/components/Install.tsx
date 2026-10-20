import { Reveal } from "../lib/reveal";
import { DOCS, INSTALL, RELEASES } from "../lib/site";
import { CommandLine, OSTabs } from "./InstallCommand";
import { useDetectedOS } from "../lib/hooks";

export function Install() {
  const [os, setOS] = useDetectedOS();
  const item = INSTALL[os];

  return (
    <section
      id="install"
      aria-labelledby="install-title"
      className="border-t border-line bg-page-2 py-24 sm:py-32"
    >
      <div className="container-page">
        <Reveal className="mx-auto max-w-[680px] text-center">
          <p className="eyebrow">Get started</p>
          <h2 id="install-title" className="h-section mt-4">
            Three steps to your own fleet.
          </h2>
          <p className="lede mx-auto mt-5 max-w-[52ch]">
            Install the hub on one machine, join the rest with a pasted command,
            and start your first session.
          </p>
        </Reveal>

        <Reveal delay={0.06} className="mx-auto mt-14 max-w-[820px]">
          <ol className="relative space-y-4">
            <li className="surface p-5 sm:p-7">
              <StepHead n={1} title="Install the hub" />
              <div className="mt-5 flex items-center justify-between gap-3">
                <OSTabs
                  value={os}
                  onChange={setOS}
                  label="Hub install command by operating system"
                  idPrefix="install-os"
                />
                <span className="hidden text-[13px] text-ink-3 sm:inline">
                  {item.shell}
                </span>
              </div>
              <div
                id="install-os-panel"
                role="tabpanel"
                aria-labelledby={`install-os-tab-${os}`}
                className="mt-3"
              >
                <CommandLine command={item.command} prompt={item.prompt} />
                <p className="mt-3 text-[14px] leading-relaxed text-ink-3">
                  {item.note}
                </p>
              </div>
              <p className="mt-4 text-[14px] leading-relaxed text-ink-2">
                Then open the link the installer prints (it carries a one-time
                setup code, so nobody else on your network can claim the hub
                first) and choose an admin password. The hub machine shows up
                as your first device.
              </p>
            </li>

            <li className="surface p-5 sm:p-7">
              <StepHead n={2} title="Add your other machines" />
              <p className="mt-3 text-[14.5px] leading-relaxed text-ink-2">
                Click{" "}
                <strong className="font-medium text-ink">Add device</strong>,
                pick the platform and paste the command it gives you. The device
                installs a background service, dials out to the hub and appears
                within seconds.
              </p>
              <div className="mt-4 overflow-x-auto rounded-xl border border-dashed border-line-strong px-4 py-3 font-mono text-[12.5px] whitespace-nowrap text-ink-3 [scrollbar-width:none]">
                <span className="mr-2.5 select-none">$</span>curl -fsSL
                http://YOUR-HUB:4200/install/TOKEN.sh | sh
              </div>
            </li>

            <li className="surface p-5 sm:p-7">
              <StepHead n={3} title="Start a session" />
              <p className="mt-3 text-[14.5px] leading-relaxed text-ink-2">
                Click{" "}
                <strong className="font-medium text-ink">New session</strong>,
                type what you want, choose the machine, folder and agent, and
                press Enter. Open{" "}
                <strong className="font-medium text-ink">Setup</strong> to
                install or sign in to Claude Code, Codex and Gemini CLI on any
                machine.
              </p>
            </li>
          </ol>

          <p className="mt-8 text-center text-[14px] text-ink-3">
            Prefer a binary?{" "}
            <a
              href={RELEASES}
              target="_blank"
              rel="noreferrer"
              className="text-accent hover:underline"
            >
              Download a release
            </a>
            . HTTPS, uninstall and advanced options are in the{" "}
            <a
              href={DOCS}
              target="_blank"
              rel="noreferrer"
              className="text-accent hover:underline"
            >
              README
            </a>
            .
          </p>
        </Reveal>
      </div>
    </section>
  );
}

function StepHead({ n, title }: { n: number; title: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="grid size-7 place-items-center rounded-full bg-inverse font-mono text-[12.5px] text-on-inverse">
        {n}
      </span>
      <h3 className="text-[18px] font-semibold tracking-[-0.02em]">{title}</h3>
    </div>
  );
}
