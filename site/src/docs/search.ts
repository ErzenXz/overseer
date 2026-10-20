import { DOC_PAGES, docHref } from "./nav";
import { parseDoc } from "./markdown";

// Every section of every docs page, for the ⌘K box. Loaded on demand, when
// the box first opens, so other pages don't carry the docs text.
const SOURCES = import.meta.glob("../content/docs/*.md", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

export const DOC_SECTIONS = DOC_PAGES.flatMap((page) =>
  parseDoc(SOURCES[`../content/docs/${page.slug || "index"}.md`] ?? "").headings.map((heading) => ({
    label: heading.text.replace(/`/g, ""),
    hint: page.title,
    href: `${docHref(page.slug)}#${heading.id}`,
  })),
);
