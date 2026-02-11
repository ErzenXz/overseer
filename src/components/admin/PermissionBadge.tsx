interface PermissionBadgeProps {
  permission: string;
  category?: string;
  granted?: boolean;
  onRevoke?: () => void;
}

const categoryColors: Record<string, string> = {
  system: "bg-red-500/10 text-red-400 border-red-500/30",
  users: "bg-blue-500/10 text-blue-400 border-blue-500/30",
  content: "bg-green-500/10 text-green-400 border-green-500/30",
  settings: "bg-[var(--color-accent-dim)] text-[var(--color-accent)] border-[var(--color-accent-border)]",
  tools: "bg-orange-500/10 text-orange-400 border-orange-500/30",
  default: "bg-[var(--color-surface-overlay)] text-[var(--color-text-secondary)] border-[var(--color-border)]",
};

export function PermissionBadge({ permission, category = "default", granted = true, onRevoke }: PermissionBadgeProps) {
  const colorClass = categoryColors[category] || categoryColors.default;

  return (
    <div
      className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-medium ${colorClass} ${
        !granted ? "opacity-50" : ""
      }`}
    >
      {granted ? (
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      ) : (
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      )}
      <span>{permission}</span>
      {onRevoke && granted && (
        <button
          onClick={onRevoke}
          className="ml-1 hover:text-red-400 transition-colors"
          aria-label="Revoke permission"
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  );
}
