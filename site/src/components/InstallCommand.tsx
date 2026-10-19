import { Check, Copy } from "@phosphor-icons/react";
import { INSTALL, OS_ORDER, type OS } from "../lib/site";
import { useCopy, useDetectedOS } from "../lib/hooks";

export function CopyButton({
  text,
  label = "Copy command",
  className = "",
}: {
  text: string;
  label?: string;
  className?: string;
}) {
  const { copied, copy } = useCopy();
  return (
    <button
      type="button"
      onClick={() => copy(text)}
      aria-label={copied ? "Copied" : label}
      title={copied ? "Copied" : label}
      className={`inline-grid size-8 shrink-0 place-items-center rounded-lg text-ink-3 transition-colors hover:bg-hover hover:text-ink ${className}`}
    >
      {copied ? (
        <Check size={16} weight="bold" className="text-ok" />
      ) : (
        <Copy size={16} />
      )}
      <span className="sr-only" aria-live="polite">
        {copied ? "Copied to clipboard" : ""}
      </span>
    </button>
  );
}

/** One line of shell with a prompt and a copy button. Scrolls, never wraps. */
export function CommandLine({
  command,
  prompt = "$",
  className = "",
}: {
  command: string;
  prompt?: string;
  className?: string;
}) {
  return (
    <div
      className={`flex min-w-0 items-center gap-2 rounded-xl border border-line bg-elev py-1.5 pr-1.5 pl-4 ${className}`}
    >
      <code className="min-w-0 flex-1 overflow-x-auto py-1.5 font-mono text-[12px] leading-relaxed break-all text-ink [scrollbar-width:none] sm:text-[13px] sm:break-normal sm:whitespace-nowrap">
        <span className="mr-2.5 text-ink-4 select-none">{prompt}</span>
        {command}
      </code>
      <CopyButton text={command} />
    </div>
  );
}

export function OSTabs({
  value,
  onChange,
  label,
  idPrefix,
}: {
  value: OS;
  onChange: (os: OS) => void;
  label: string;
  idPrefix: string;
}) {
  function onKey(e: React.KeyboardEvent) {
    const i = OS_ORDER.indexOf(value);
    let next = i;
    if (e.key === "ArrowRight") next = (i + 1) % OS_ORDER.length;
    else if (e.key === "ArrowLeft")
      next = (i - 1 + OS_ORDER.length) % OS_ORDER.length;
    else return;
    e.preventDefault();
    onChange(OS_ORDER[next]);
    document.getElementById(`${idPrefix}-tab-${OS_ORDER[next]}`)?.focus();
  }
  return (
    <div
      role="tablist"
      aria-label={label}
      onKeyDown={onKey}
      className="inline-flex items-center gap-1 rounded-full border border-line bg-subtle p-1"
    >
      {OS_ORDER.map((os) => {
        const on = os === value;
        return (
          <button
            key={os}
            id={`${idPrefix}-tab-${os}`}
            type="button"
            role="tab"
            aria-selected={on}
            aria-controls={`${idPrefix}-panel`}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(os)}
            className={`h-7 rounded-full px-3 text-[13px] transition-colors ${
              on
                ? "bg-elev text-ink shadow-[var(--shadow-card)] ring-1 ring-line-strong"
                : "text-ink-3 hover:text-ink"
            }`}
          >
            {INSTALL[os].label}
          </button>
        );
      })}
    </div>
  );
}

/** Compact install block used in the hero. */
export function HeroInstall() {
  const [os, setOS] = useDetectedOS();
  const item = INSTALL[os];
  return (
    <div className="w-full max-w-[560px]">
      <div className="mb-2.5 flex items-center justify-center">
        <OSTabs
          value={os}
          onChange={setOS}
          label="Install command by operating system"
          idPrefix="hero-os"
        />
      </div>
      <div
        id="hero-os-panel"
        role="tabpanel"
        aria-labelledby={`hero-os-tab-${os}`}
      >
        <CommandLine
          command={item.command}
          prompt={item.prompt}
          className="shadow-[var(--shadow-card)]"
        />
      </div>
    </div>
  );
}
