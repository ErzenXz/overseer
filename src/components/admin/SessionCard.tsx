"use client";

interface SessionCardProps {
  session: {
    session_id: string;
    interface_type: string;
    username: string | null;
    user_id: string | null;
    status: string;
    started_at: string;
    last_activity_at: string;
    current_task: string | null;
    step_count: number;
    total_tokens: number;
    estimated_cost: number;
  };
  onTerminate?: () => void;
}

const statusColors: Record<string, string> = {
  active: "bg-green-500",
  idle: "bg-blue-500",
  busy: "bg-yellow-500",
  error: "bg-red-500",
  ended: "bg-zinc-500",
};

const interfaceIcons: Record<string, React.ReactNode> = {
  telegram: (
    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
      <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.562 8.161c-.18 1.897-.962 6.502-1.359 8.627-.168.9-.5 1.201-.82 1.23-.697.064-1.226-.461-1.901-.903-1.056-.693-1.653-1.124-2.678-1.8-1.185-.781-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.015-.15-.056-.212s-.174-.041-.248-.024c-.106.024-1.793 1.139-5.062 3.345-.479.329-.913.489-1.302.481-.428-.008-1.252-.241-1.865-.44-.752-.244-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.831-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635.099-.002.321.023.465.141.121.099.155.232.171.326.016.094.036.308.02.475z"/>
    </svg>
  ),
  discord: (
    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
      <path d="M20.317 4.37a19.791 19.791 0 00-4.885-1.515.074.074 0 00-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 00-5.487 0 12.64 12.64 0 00-.617-1.25.077.077 0 00-.079-.037A19.736 19.736 0 003.677 4.37a.07.07 0 00-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 00.031.057 19.9 19.9 0 005.993 3.03.078.078 0 00.084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 00-.041-.106 13.107 13.107 0 01-1.872-.892.077.077 0 01-.008-.128 10.2 10.2 0 00.372-.292.074.074 0 01.077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 01.078.01c.12.098.246.198.373.292a.077.077 0 01-.006.127 12.299 12.299 0 01-1.873.892.077.077 0 00-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 00.084.028 19.839 19.839 0 006.002-3.03.077.077 0 00.032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 00-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
    </svg>
  ),
  web: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
    </svg>
  ),
  slack: (
    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
      <path d="M5.042 15.165a2.528 2.528 0 01-2.52 2.523A2.528 2.528 0 010 15.165a2.527 2.527 0 012.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 012.521-2.52 2.527 2.527 0 012.521 2.52v6.313A2.528 2.528 0 018.834 24a2.528 2.528 0 01-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 01-2.521-2.52A2.528 2.528 0 018.834 0a2.528 2.528 0 012.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 012.521 2.521 2.528 2.528 0 01-2.521 2.521H2.522A2.528 2.528 0 010 8.834a2.528 2.528 0 012.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 012.522-2.521A2.528 2.528 0 0124 8.834a2.528 2.528 0 01-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 01-2.523 2.521 2.527 2.527 0 01-2.52-2.521V2.522A2.527 2.527 0 0115.165 0a2.528 2.528 0 012.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 012.523 2.522A2.528 2.528 0 0115.165 24a2.527 2.527 0 01-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 01-2.52-2.523 2.526 2.526 0 012.52-2.52h6.313A2.527 2.527 0 0124 15.165a2.528 2.528 0 01-2.522 2.523h-6.313z"/>
    </svg>
  ),
};

export function SessionCard({ session, onTerminate }: SessionCardProps) {
  const formatDuration = () => {
    const started = new Date(session.started_at);
    const now = new Date();
    const diff = Math.floor((now.getTime() - started.getTime()) / 1000);
    
    if (diff < 60) return `${diff}s`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m`;
    return `${Math.floor(diff / 3600)}h ${Math.floor((diff % 3600) / 60)}m`;
  };

  return (
    <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6 hover:border-zinc-700 transition-colors">
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className={`w-3 h-3 rounded-full ${statusColors[session.status] || statusColors.ended}`} />
          <div>
            <div className="flex items-center gap-2">
              <code className="text-sm font-mono text-white">{session.session_id.slice(0, 12)}...</code>
              <span className={`text-xs px-2 py-0.5 rounded ${
                session.status === 'active' ? 'bg-green-500/10 text-green-400' :
                session.status === 'busy' ? 'bg-yellow-500/10 text-yellow-400' :
                session.status === 'idle' ? 'bg-blue-500/10 text-blue-400' :
                'bg-red-500/10 text-red-400'
              }`}>
                {session.status}
              </span>
            </div>
            <div className="flex items-center gap-2 mt-1 text-xs text-zinc-500">
              <span className="flex items-center gap-1">
                {interfaceIcons[session.interface_type] || interfaceIcons.web}
                {session.interface_type}
              </span>
              <span>•</span>
              <span>{session.username || session.user_id || "Unknown"}</span>
            </div>
          </div>
        </div>

        {onTerminate && session.status !== 'ended' && (
          <button
            onClick={onTerminate}
            className="px-3 py-1.5 text-xs text-red-400 hover:text-red-300 bg-red-500/10 hover:bg-red-500/20 rounded-lg transition-colors"
          >
            Terminate
          </button>
        )}
      </div>

      <div className="space-y-2">
        {session.current_task && (
          <div className="p-3 bg-zinc-800/30 rounded-lg">
            <p className="text-xs text-zinc-500 mb-1">Current Task</p>
            <p className="text-sm text-zinc-300 truncate">{session.current_task}</p>
          </div>
        )}

        <div className="grid grid-cols-4 gap-4 pt-3 border-t border-zinc-800">
          <div>
            <p className="text-xs text-zinc-500">Duration</p>
            <p className="text-sm font-medium text-white mt-1">{formatDuration()}</p>
          </div>
          <div>
            <p className="text-xs text-zinc-500">Steps</p>
            <p className="text-sm font-medium text-white mt-1">{session.step_count}</p>
          </div>
          <div>
            <p className="text-xs text-zinc-500">Tokens</p>
            <p className="text-sm font-medium text-white mt-1">{session.total_tokens.toLocaleString()}</p>
          </div>
          <div>
            <p className="text-xs text-zinc-500">Cost</p>
            <p className="text-sm font-medium text-white mt-1">${session.estimated_cost.toFixed(4)}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
