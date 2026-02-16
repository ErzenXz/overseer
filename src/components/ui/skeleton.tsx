import { cn } from "@/lib/utils";

function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "animate-pulse rounded bg-[var(--color-surface-overlay)]",
        className
      )}
      {...props}
    />
  );
}

export { Skeleton };
