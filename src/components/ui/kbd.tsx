import { cn } from "@/lib/utils";

export function Kbd({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <kbd
      className={cn(
        "pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border border-[var(--color-border)] bg-[var(--color-surface-overlay)] px-1.5 font-mono text-[10px] font-medium text-[var(--color-text-muted)]",
        className
      )}
    >
      {children}
    </kbd>
  );
}
