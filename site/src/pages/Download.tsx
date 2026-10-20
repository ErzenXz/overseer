import { ArrowRight, GithubLogo } from "@phosphor-icons/react";
import { CommandLine } from "../components/InstallCommand";
import { mount, PageHeader } from "../components/Layout";
import { Art, Shot } from "../components/Shot";
import { DOCS, INSTALL, OS_ORDER, RELEASES, REPO } from "../lib/site";
import { useDetectedOS } from "../lib/hooks";
import { Reveal } from "../lib/reveal";

function Download() {
  const [os] = useDetectedOS();
  const order = [os, ...OS_ORDER.filter((item) => item !== os)];
  return (
    <>
      <PageHeader label="Download" title={<>Install once. <span className="text-ink-4">Add every machine.</span></>} aside={<Art name="orbit-dark" className="absolute inset-0" />}>
        Free and open source. One binary for the hub, every machine, the CLI and the MCP server. macOS, Linux and Windows, on Intel/AMD or ARM.
      </PageHeader>

      <div className="rule" />
      <section className="frame" aria-labelledby="hub-title">
        <Reveal className="section pb-10">
          <p className="label"><span className="label-index">01</span>Install the hub</p>
          <h2 id="hub-title" className="h-feature mt-4 max-w-[30ch]">On the computer that stays on most.</h2>
        </Reveal>
        <div className="cells">
          {order.map((id) => {
            const item = INSTALL[id];
            return (
              <div key={id} className="cells lg:grid-cols-[240px_1fr]">
                <div className="cell py-7">
                  <div className="flex items-center gap-2">
                    <h3 className="text-[17px] font-semibold">{item.label}</h3>
                    {id === os && <span className="rounded-full bg-hover px-2 py-0.5 font-mono text-[11px] whitespace-nowrap text-ink-3">your system</span>}
                  </div>
                  <p className="mt-1 text-[13.5px] text-ink-3">{item.shell}</p>
                </div>
                <div className="cell py-7">
                  <CommandLine command={item.command} prompt={item.prompt} />
                  <p className="mt-3 text-[14px] leading-relaxed text-ink-3">{item.note}</p>
                </div>
              </div>
            );
          })}
        </div>
        <div className="border-t border-line px-6 py-5 text-[14.5px] leading-relaxed text-ink-2 sm:px-9">
          Then open the link the installer prints and choose a password. The link carries a one-time setup code, so nobody else on your network can claim the hub first.
        </div>
      </section>

      <div className="rule" />
      <section className="frame" aria-labelledby="add-title">
        <div className="cells lg:grid-cols-[1fr_1.4fr]">
          <Reveal className="cell flex flex-col justify-center">
            <p className="label"><span className="label-index">02</span>Add your machines</p>
            <h2 id="add-title" className="h-feature mt-4">Paste one command on each computer.</h2>
            <p className="mt-4 text-[15px] leading-relaxed text-ink-3">In Overseer, open <strong className="font-medium text-ink">Machines → Add machine</strong>, pick the platform and copy the command. The machine installs a background service, dials out to your hub and shows up within seconds. No ports to open, no SSH keys.</p>
            <div className="mt-5 overflow-x-auto rounded-xl border border-dashed border-line-strong px-4 py-3 font-mono text-[12.5px] whitespace-nowrap text-ink-3 [scrollbar-width:none]"><span className="mr-2.5 select-none">$</span>curl -fsSL https://your-hub/install/TOKEN.sh | sh</div>
          </Reveal>
          <div className="field p-4 sm:p-8"><Shot name="machines" alt="The machines list with four computers and their live stats" /></div>
        </div>
      </section>

      <div className="rule" />
      <section className="frame" aria-labelledby="start-title">
        <div className="cells lg:grid-cols-[1.4fr_1fr]">
          <div className="field order-2 p-4 sm:p-8 lg:order-1"><Shot name="agents" alt="Choosing the agent, model and thinking level for a new session" /></div>
          <Reveal className="cell order-1 flex flex-col justify-center lg:order-2">
            <p className="label"><span className="label-index">03</span>Start a session</p>
            <h2 id="start-title" className="h-feature mt-4">Pick a machine, a folder and an agent.</h2>
            <p className="mt-4 text-[15px] leading-relaxed text-ink-3">Every agent installed on that machine is listed with its own models and modes. Install or sign in to more from <strong className="font-medium text-ink">Machines → Setup</strong>.</p>
          </Reveal>
        </div>
      </section>

      <div className="rule" />
      <section className="frame" aria-label="More ways to install">
        <div className="cells sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["Updates itself", "The hub and every machine update to each stable release, checksum-verified, with one-click rollback in Settings."],
            ["Prefer a binary?", "Download overseer_<os>_<arch> from GitHub Releases and run ./overseer serve."],
            ["Build from source", "git clone, then make. Go 1.25 and Node 20."],
            ["Uninstall", "Run the same installer with uninstall. Your data stays unless you ask to remove it."],
          ].map(([title, body]) => (
            <div key={title} className="cell">
              <h3 className="text-[15.5px] font-semibold">{title}</h3>
              <p className="mt-2 text-[14px] leading-relaxed text-ink-3">{body}</p>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-2.5 border-t border-line px-6 py-5 sm:px-9">
          <a href={RELEASES} target="_blank" rel="noreferrer" className="btn btn-sm btn-outline"><GithubLogo size={15} />Releases</a>
          <a href={DOCS} target="_blank" rel="noreferrer" className="btn btn-sm btn-outline">Full install guide<ArrowRight size={14} /></a>
          <a href={REPO} target="_blank" rel="noreferrer" className="btn btn-sm btn-ghost">Source code</a>
        </div>
      </section>
    </>
  );
}

mount("download", <Download />);
