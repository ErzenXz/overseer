interface ActivityItem {
  id: number;
  type: string;
  title: string;
  description: string;
  timestamp: string;
  status?: "success" | "error" | "pending";
}

interface RecentActivityProps {
  items: ActivityItem[];
}

export function RecentActivity({ items }: RecentActivityProps) {
  if (items.length === 0) {
    return (
      <div className="text-center py-8 text-[var(--color-text-muted)]">
        No recent activity
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {items.map((item) => (
        <div
          key={item.id}
          className="flex items-start gap-3 p-3 bg-[var(--color-surface-overlay)] rounded-lg"
        >
          <div
            className={`w-1.5 h-1.5 rounded-full mt-2 ${
              item.status === "success"
                ? "bg-[var(--color-success)]"
                : item.status === "error"
                ? "bg-[var(--color-danger)]"
                : "bg-[var(--color-text-muted)]"
            }`}
          />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-[var(--color-text-primary)]">{item.title}</p>
            <p className="text-xs text-[var(--color-text-secondary)] truncate">{item.description}</p>
          </div>
          <span className="text-xs text-[var(--color-text-muted)] whitespace-nowrap font-[var(--font-mono)]">
            {item.timestamp}
          </span>
        </div>
      ))}
    </div>
  );
}
