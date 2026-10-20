import type { DiffLine } from "./data";
import type { ReactNode } from "react";

/* Small building blocks shared by the hero window and the feature vignettes.
   They are drawings of the product, so nothing in here is focusable. */

export function Chrome({ url }: { url: string }) {
  return (
    <div className="m-chrome" aria-hidden="true">
      <div className="m-lights">
        <span />
        <span />
        <span />
      </div>
      <div className="m-url">
        <svg width="11" height="11" viewBox="0 0 16 16" aria-hidden="true">
          <path
            d="M4.5 7V5a3.5 3.5 0 0 1 7 0v2M3.5 7h9v7h-9z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          />
        </svg>
        <span className="truncate">{url}</span>
      </div>
      <div className="w-[47px]" />
    </div>
  );
}

export function Stat({ add, del }: { add: number; del: number }) {
  return (
    <span className="whitespace-nowrap tabular-nums">
      <span className="m-plus">+{add}</span>{" "}
      <span className="m-minus">−{del}</span>
    </span>
  );
}

export function Diff({
  path,
  add,
  del,
  lines,
  className = "",
}: {
  path: string;
  add: number;
  del: number;
  lines: DiffLine[];
  className?: string;
}) {
  return (
    <div className={`m-diff ${className}`}>
      <div className="m-diff-head">
        <span className="min-w-0 truncate">{path}</span>
        <span className="ml-auto">
          <Stat add={add} del={del} />
        </span>
      </div>
      <div className="py-1">
        {lines.map(([kind, text], i) => (
          <div
            key={i}
            className={`m-diff-line ${
              kind === "+"
                ? "m-diff-add"
                : kind === "-"
                  ? "m-diff-del"
                  : kind === "@"
                    ? "m-diff-hunk"
                    : ""
            }`}
          >
            {kind === "@" ? text : `${kind} ${text}`}
          </div>
        ))}
      </div>
    </div>
  );
}

/** A framed vignette: a product surface floating on a soft panel. */
export function Vignette({
  children,
  className = "",
  label,
}: {
  children: ReactNode;
  className?: string;
  label: string;
}) {
  return (
    <figure
      className={`stage-panel relative overflow-hidden rounded-[20px] border border-line p-3 sm:p-5 ${className}`}
    >
      <figcaption className="sr-only">{label}</figcaption>
      <div aria-hidden="true" className="relative">
        {children}
      </div>
    </figure>
  );
}

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`overflow-hidden rounded-[14px] border border-line-strong bg-page text-[13px] shadow-[var(--shadow-pop)] ${className}`}
    >
      {children}
    </div>
  );
}
