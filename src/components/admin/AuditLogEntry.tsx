interface AuditLogEntryProps {
  log: {
    id: number;
    level: string;
    category: string;
    message: string;
    metadata: string | null;
    created_at: string;
  };
  onView?: () => void;
}

const levelColors: Record<string, string> = {
  debug: "bg-zinc-500/10 text-zinc-400",
  info: "bg-blue-500/10 text-blue-400",
  warn: "bg-yellow-500/10 text-yellow-400",
  error: "bg-red-500/10 text-red-400",
};

const levelIcons: Record<string, React.ReactNode> = {
  debug: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  info: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  warn: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
    </svg>
  ),
  error: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
};

export function AuditLogEntry({ log, onView }: AuditLogEntryProps) {
  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleString();
  };

  const metadata = log.metadata ? JSON.parse(log.metadata) : null;

  return (
    <div className="flex items-start gap-4 p-4 bg-zinc-900/30 hover:bg-zinc-900/50 rounded-lg transition-colors group">
      <div className={`flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center ${levelColors[log.level] || levelColors.info}`}>
        {levelIcons[log.level] || levelIcons.info}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-4 mb-1">
          <div className="flex items-center gap-2">
            <span className={`text-xs px-2 py-0.5 rounded font-medium ${levelColors[log.level] || levelColors.info}`}>
              {log.level.toUpperCase()}
            </span>
            <span className="text-xs text-zinc-500">{log.category}</span>
          </div>
          <span className="text-xs text-zinc-500 flex-shrink-0">{formatTime(log.created_at)}</span>
        </div>

        <p className="text-sm text-zinc-300 mb-2">{log.message}</p>

        {metadata && (
          <details className="text-xs">
            <summary className="text-zinc-500 cursor-pointer hover:text-zinc-400 inline-flex items-center gap-1">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              View metadata
            </summary>
            <pre className="mt-2 p-2 bg-zinc-900 rounded text-zinc-400 overflow-x-auto">
              {JSON.stringify(metadata, null, 2)}
            </pre>
          </details>
        )}
      </div>

      {onView && (
        <button
          onClick={onView}
          className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity px-2 py-1 text-xs text-zinc-400 hover:text-white"
          aria-label="View details"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
          </svg>
        </button>
      )}
    </div>
  );
}
