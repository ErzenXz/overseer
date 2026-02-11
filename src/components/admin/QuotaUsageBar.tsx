interface QuotaUsageBarProps {
  used: number;
  limit: number;
  label: string;
  color?: "blue" | "green" | "yellow" | "red" | "purple";
}

const colorClasses = {
  blue: {
    bar: "bg-blue-500",
    bg: "bg-blue-500/10",
    text: "text-blue-400",
  },
  green: {
    bar: "bg-green-500",
    bg: "bg-green-500/10",
    text: "text-green-400",
  },
  yellow: {
    bar: "bg-yellow-500",
    bg: "bg-yellow-500/10",
    text: "text-yellow-400",
  },
  red: {
    bar: "bg-red-500",
    bg: "bg-red-500/10",
    text: "text-red-400",
  },
  purple: {
    bar: "bg-purple-500",
    bg: "bg-purple-500/10",
    text: "text-purple-400",
  },
};

export function QuotaUsageBar({ used, limit, label, color = "blue" }: QuotaUsageBarProps) {
  const percentage = Math.min((used / limit) * 100, 100);
  const isNearLimit = percentage >= 80;
  const isOverLimit = used >= limit;
  
  const effectiveColor = isOverLimit ? "red" : isNearLimit ? "yellow" : color;
  const colors = colorClasses[effectiveColor];

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm">
        <span className="text-[var(--color-text-secondary)]">{label}</span>
        <span className={`font-medium ${colors.text}`}>
          {used.toLocaleString()} / {limit.toLocaleString()}
          {isOverLimit && (
            <span className="ml-2 text-xs text-red-400">
              ({Math.floor(percentage)}% - Over limit!)
            </span>
          )}
        </span>
      </div>
      
      <div className={`h-2 rounded-full overflow-hidden ${colors.bg}`}>
        <div
          className={`h-full ${colors.bar} transition-all duration-300`}
          style={{ width: `${Math.min(percentage, 100)}%` }}
        />
      </div>
      
      {isNearLimit && !isOverLimit && (
        <p className="text-xs text-yellow-400 flex items-center gap-1">
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          Approaching limit ({Math.floor(percentage)}%)
        </p>
      )}
    </div>
  );
}
