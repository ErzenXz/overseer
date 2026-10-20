import { Fragment, type ReactNode } from "react";
import source from "../content/CHANGELOG.md?raw";
import { REPO, RELEASES } from "../lib/site";

// The changelog page renders CHANGELOG.md (synced from the repo root; CI
// checks the copy). The file is our own, so a tiny parser for its shape is
// enough: "## vX — date", an intro paragraph, "### Group" and "- " bullets.

interface Release {
  version: string;
  date: string;
  intro: string;
  groups: { title: string; items: string[] }[];
}

function parse(md: string): Release[] {
  const releases: Release[] = [];
  let current: Release | null = null;
  let group: Release["groups"][number] | null = null;
  for (const raw of md.split("\n")) {
    const line = raw.trimEnd();
    const heading = line.match(/^## (\S+)(?:\s+[—-]\s+(.+))?$/);
    if (heading) {
      current = { version: heading[1], date: heading[2] ?? "", intro: "", groups: [] };
      group = null;
      releases.push(current);
      continue;
    }
    if (!current) continue;
    const sub = line.match(/^### (.+)$/);
    if (sub) {
      group = { title: sub[1], items: [] };
      current.groups.push(group);
      continue;
    }
    if (line.startsWith("- ") && group) {
      group.items.push(line.slice(2));
    } else if (/^\s{2,}\S/.test(line) && group?.items.length) {
      group.items[group.items.length - 1] += ` ${line.trim()}`;
    } else if (line && !group) {
      current.intro += (current.intro ? " " : "") + line.trim();
    }
  }
  return releases;
}

// **bold**, `code` and [links](url); relative links point at the repo.
function inline(text: string): ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**"))
      return <strong key={i} className="font-medium text-ink">{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`"))
      return <code key={i} className="rounded bg-hover px-1.5 py-0.5 font-mono text-[0.88em]">{part.slice(1, -1)}</code>;
    const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link) {
      const href = /^https?:/.test(link[2]) ? link[2] : `${REPO}/blob/main/${link[2]}`;
      return <a key={i} href={href} target="_blank" rel="noreferrer" className="text-accent underline-offset-2 hover:underline">{link[1]}</a>;
    }
    return <Fragment key={i}>{part}</Fragment>;
  });
}

const releases = parse(source);
const tone: Record<string, string> = {
  New: "bg-[var(--green-bg)] text-[var(--green)]",
  Improved: "bg-hover text-ink-2",
  Fixed: "bg-[var(--amber-bg)] text-[var(--amber)]",
  Security: "bg-[var(--red-bg)] text-[var(--red)]",
};

export function Changelog() {
  return (
    <>
    <section className="frame">
      <div className="section pb-14">
        <p className="label rise">Changelog</p>
        <h1 className="h-display rise mt-5 text-[42px] sm:text-[60px]">
          What’s new <span className="text-ink-4">in Overseer.</span>
        </h1>
        <p className="lede rise mt-6 max-w-[56ch]">
          Every release, in plain words. Installed hubs and machines update on their own; downloads are on{" "}
          <a href={RELEASES} target="_blank" rel="noreferrer" className="text-accent hover:underline">GitHub</a>.
        </p>
      </div>
    </section>
    <div className="rule" />
    <section className="frame">
      <div className="section mx-auto max-w-[920px] pt-14">
        <ol className="space-y-16">
          {releases.map((release, index) => (
            <li key={release.version} id={release.version} className="grid gap-4 md:grid-cols-[150px_1fr] md:gap-10">
              <div className="md:sticky md:top-24 md:self-start">
                <a href={`#${release.version}`} className="font-mono text-[15px] font-medium text-ink hover:text-accent">{release.version}</a>
                <div className="mt-1 text-[13px] text-ink-3">{release.date}</div>
                {index === 0 && !/unreleased/i.test(release.date) && (
                  <span className="mt-2 inline-block rounded-full bg-inverse px-2 py-0.5 text-[11.5px] font-medium text-on-inverse">Latest</span>
                )}
              </div>
              <div className="min-w-0 border-l border-line pl-6 md:pl-8">
                {release.intro && <p className="text-[17px] leading-relaxed text-ink">{inline(release.intro)}</p>}
                {release.groups.map((group) => (
                  <div key={group.title} className="mt-7">
                    <span className={`inline-block rounded-full px-2.5 py-0.5 text-[12px] font-medium ${tone[group.title] ?? "bg-hover text-ink-2"}`}>{group.title}</span>
                    <ul className="mt-3 space-y-3">
                      {group.items.map((item, i) => (
                        <li key={i} className="relative pl-4 text-[15px] leading-relaxed text-ink-2 before:absolute before:top-[0.7em] before:left-0 before:size-1.5 before:rounded-full before:bg-[var(--line-strong)]">
                          {inline(item)}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
    </>
  );
}
