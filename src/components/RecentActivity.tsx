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
      <div className="text-center py-8 text-zinc-500">
        No recent activity
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {items.map((item) => (
        <div
          key={item.id}
          className="flex items-start gap-4 p-4 bg-zinc-800/30 rounded-lg"
        >
          <div
            className={`w-2 h-2 rounded-full mt-2 ${
              item.status === "success"
                ? "bg-green-500"
                : item.status === "error"
                ? "bg-red-500"
                : "bg-zinc-500"
            }`}
          />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-white">{item.title}</p>
            <p className="text-xs text-zinc-400 truncate">{item.description}</p>
          </div>
          <span className="text-xs text-zinc-500 whitespace-nowrap">
            {item.timestamp}
          </span>
        </div>
      ))}
    </div>
  );
}
