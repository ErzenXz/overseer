"use client";

import Link from "next/link";
import { Children, isValidElement, type ReactNode, useMemo, useState } from "react";
import {
  AlertTriangle,
  Bot,
  BookOpen,
  Boxes,
  Check,
  Code2,
  Database,
  Dock,
  Rocket,
  Server,
  Terminal,
  Wrench,
  Building2,
  Package,
  Shield,
  Info,
  Lightbulb,
} from "lucide-react";

type CardProps = {
  title: string;
  href?: string;
  icon?: string;
  children?: ReactNode;
};

type ParamFieldProps = {
  body?: string;
  query?: string;
  path?: string;
  header?: string;
  type?: string;
  required?: boolean;
  children?: ReactNode;
};

const iconMap = {
  rocket: Rocket,
  terminal: Terminal,
  building: Building2,
  code: Code2,
  server: Server,
  book: BookOpen,
  "book-open": BookOpen,
  docker: Dock,
  robot: Bot,
  "node-js": Wrench,
  package: Package,
  shield: Shield,
  boxes: Boxes,
  database: Database,
} as const;

function resolveHref(href?: string) {
  if (!href) return undefined;
  if (href.startsWith("http://") || href.startsWith("https://") || href.startsWith("#")) {
    return href;
  }
  if (href.startsWith("/docs")) return href;
  if (href.startsWith("/")) return `/docs${href}`;
  return href;
}

function IconForName({ icon }: { icon?: string }) {
  const Component = icon ? iconMap[icon as keyof typeof iconMap] : undefined;
  if (!Component) return null;
  return <Component className="h-4 w-4" />;
}

export function CardGroup({
  cols = 2,
  children,
}: {
  cols?: number;
  children?: ReactNode;
}) {
  const className =
    cols === 3
      ? "grid gap-4 md:grid-cols-3"
      : cols === 1
        ? "grid gap-4"
        : "grid gap-4 md:grid-cols-2";

  return <div className={className}>{children}</div>;
}

export function Cards({ children }: { children?: ReactNode }) {
  return <div className="grid gap-4 md:grid-cols-2">{children}</div>;
}

export function Card({ title, href, icon, children }: CardProps) {
  const target = resolveHref(href);
  const content = (
    <div className="h-full rounded-2xl border border-black/8 bg-white/85 p-5 shadow-[0_8px_30px_rgba(0,0,0,0.05)] backdrop-blur dark:border-white/10 dark:bg-white/5">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-[color:var(--fd-primary)]/12 text-[color:var(--fd-primary)]">
          <IconForName icon={icon} />
        </span>
        <span>{title}</span>
      </div>
      <div className="text-sm text-fd-muted-foreground">{children}</div>
    </div>
  );

  if (!target) return content;

  const external = target.startsWith("http://") || target.startsWith("https://");
  if (external) {
    return (
      <a href={target} target="_blank" rel="noreferrer" className="block transition-transform hover:-translate-y-0.5">
        {content}
      </a>
    );
  }

  return (
    <Link href={target} className="block transition-transform hover:-translate-y-0.5">
      {content}
    </Link>
  );
}

export function AccordionGroup({ children }: { children?: ReactNode }) {
  return <div className="space-y-3">{children}</div>;
}

export function Accordion({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <details className="group rounded-2xl border border-black/8 bg-white/75 px-4 py-3 dark:border-white/10 dark:bg-white/5">
      <summary className="cursor-pointer list-none font-medium">
        <span className="inline-flex items-center gap-2">
          <span className="text-[color:var(--fd-primary)] transition-transform group-open:rotate-45">+</span>
          {title}
        </span>
      </summary>
      <div className="pt-3 text-sm text-fd-muted-foreground">{children}</div>
    </details>
  );
}

function calloutClasses(type: "tip" | "info" | "warning" | "note" | "check") {
  switch (type) {
    case "tip":
      return "border-emerald-500/20 bg-emerald-500/8";
    case "info":
      return "border-sky-500/20 bg-sky-500/8";
    case "warning":
      return "border-amber-500/20 bg-amber-500/8";
    case "check":
      return "border-emerald-500/20 bg-emerald-500/8";
    case "note":
    default:
      return "border-black/10 bg-black/4 dark:border-white/10 dark:bg-white/5";
  }
}

function Callout({
  type,
  children,
}: {
  type: "tip" | "info" | "warning" | "note" | "check";
  children?: ReactNode;
}) {
  const Icon =
    type === "tip"
      ? Lightbulb
      : type === "info"
        ? Info
        : type === "warning"
          ? AlertTriangle
          : type === "check"
            ? Check
            : BookOpen;

  return (
    <div className={`my-5 rounded-2xl border px-4 py-3 text-sm ${calloutClasses(type)}`}>
      <div className="flex gap-3">
        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--fd-primary)]" />
        <div>{children}</div>
      </div>
    </div>
  );
}

export function Tip({ children }: { children?: ReactNode }) {
  return <Callout type="tip">{children}</Callout>;
}

export function InfoCallout({ children }: { children?: ReactNode }) {
  return <Callout type="info">{children}</Callout>;
}

export function Warning({ children }: { children?: ReactNode }) {
  return <Callout type="warning">{children}</Callout>;
}

export function Note({ children }: { children?: ReactNode }) {
  return <Callout type="note">{children}</Callout>;
}

export function CheckItem({ children }: { children?: ReactNode }) {
  return <Callout type="check">{children}</Callout>;
}

export function Steps({ children }: { children?: ReactNode }) {
  return <div className="space-y-4">{children}</div>;
}

export function Step({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-black/8 bg-white/80 p-4 dark:border-white/10 dark:bg-white/5">
      <div className="mb-2 text-sm font-semibold">{title}</div>
      <div className="text-sm text-fd-muted-foreground">{children}</div>
    </div>
  );
}

export function Tabs({ children }: { children?: ReactNode }) {
  const items = useMemo(
    () =>
      Children.toArray(children).filter(isValidElement) as Array<
        React.ReactElement<{ title?: string; children?: ReactNode }>
      >,
    [children],
  );
  const [active, setActive] = useState(0);

  if (items.length === 0) return null;

  return (
    <div className="my-6 rounded-2xl border border-black/8 bg-white/75 p-2 dark:border-white/10 dark:bg-white/5">
      <div className="mb-2 flex flex-wrap gap-2">
        {items.map((item, index) => (
          <button
            key={`${item.props.title}-${index}`}
            type="button"
            onClick={() => setActive(index)}
            className={`rounded-xl px-3 py-1.5 text-sm transition ${
              index === active
                ? "bg-[color:var(--fd-primary)] text-white"
                : "bg-black/5 text-fd-muted-foreground hover:bg-black/8 dark:bg-white/5 dark:hover:bg-white/8"
            }`}
          >
            {item.props.title || `Tab ${index + 1}`}
          </button>
        ))}
      </div>
      <div className="px-2 py-2 text-sm">{items[active]?.props.children}</div>
    </div>
  );
}

export function Tab({ children }: { title?: string; children?: ReactNode }) {
  return <>{children}</>;
}

export function ParamField({
  body,
  query,
  path,
  header,
  type,
  required,
  children,
}: ParamFieldProps) {
  const name = body || query || path || header || "parameter";
  const location = body
    ? "Body"
    : query
      ? "Query"
      : path
        ? "Path"
        : header
          ? "Header"
          : "Field";

  return (
    <div className="my-4 rounded-2xl border border-black/8 bg-white/80 p-4 dark:border-white/10 dark:bg-white/5">
      <div className="flex flex-wrap items-center gap-2">
        <code className="rounded-md bg-black/5 px-2 py-1 text-sm dark:bg-white/8">{name}</code>
        {type && <span className="text-xs text-fd-muted-foreground">{type}</span>}
        <span className="text-xs text-fd-muted-foreground">{location}</span>
        {required && (
          <span className="rounded-full bg-rose-500/12 px-2 py-0.5 text-[11px] font-medium text-rose-600 dark:text-rose-300">
            Required
          </span>
        )}
      </div>
      {children && <div className="mt-2 text-sm text-fd-muted-foreground">{children}</div>}
    </div>
  );
}
