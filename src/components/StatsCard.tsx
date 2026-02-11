interface StatsCardProps {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  color?: "accent" | "success" | "warning" | "danger" | "info";
  subtitle?: string;
}

const dotColors = {
  accent: "bg-[var(--color-accent)]",
  success: "bg-[var(--color-success)]",
  warning: "bg-[var(--color-warning)]",
  danger: "bg-[var(--color-danger)]",
  info: "bg-[var(--color-info)]",
};

const iconColors = {
  accent: "text-[var(--color-accent)]",
  success: "text-[var(--color-success)]",
  warning: "text-[var(--color-warning)]",
  danger: "text-[var(--color-danger)]",
  info: "text-[var(--color-info)]",
};

export function StatsCard({ title, value, icon, color = "accent", subtitle }: StatsCardProps) {
  return (
    <div className="bg-[var(--color-surface-raised)] border border-[var(--color-border)] rounded-lg p-5">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className={`w-1.5 h-1.5 rounded-full ${dotColors[color]}`} />
            <p className="text-[11px] font-[var(--font-mono)] uppercase tracking-[0.08em] text-[var(--color-text-muted)]">
              {title}
            </p>
          </div>
          <p className="text-2xl font-semibold text-white font-[var(--font-mono)] mt-2">
            {value}
          </p>
          {subtitle && (
            <p className="text-xs text-[var(--color-text-muted)] mt-1">{subtitle}</p>
          )}
        </div>
        <div className={`p-2 rounded ${iconColors[color]} bg-[var(--color-surface-overlay)]`}>
          {icon}
        </div>
      </div>
    </div>
  );
}
